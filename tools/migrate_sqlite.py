#!/usr/bin/env python3
"""Optional one-time conversion from Tempo 1.x SQLite to a browser JSON backup.

python tools/migrate_sqlite.py ~/.tempo/tempo.sqlite3 --output my-tempo.json --name Heath

No dependencies. The source is opened read-only; the destination must be new.
This utility is not needed or deployed by the browser app.
"""
import argparse
import datetime as dt
import json
from pathlib import Path
import sqlite3
import time
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('database', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--name', default='Imported from Python')
    args = parser.parse_args()
    source = args.database.expanduser().resolve()
    if not source.is_file():
        parser.error('The database file does not exist.')
    if not args.name.strip() or len(args.name.strip()) > 60:
        parser.error('The profile name must contain 1–60 characters.')
    connection = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute('BEGIN')
        version = connection.execute('PRAGMA user_version').fetchone()[0]
        if version != 1:
            parser.error('Expected a Tempo 1.x database with schema version 1.')
        trackers = [dict(r) for r in connection.execute('SELECT * FROM trackers ORDER BY created_at,id')]
        events = [dict(r) for r in connection.execute('SELECT * FROM events ORDER BY id')]
        settings = dict(connection.execute('SELECT key,value FROM settings'))
    finally:
        connection.close()
    now = time.time()
    for t in trackers:
        t['archived'] = bool(t['archived'])
    for e in events:
        e['undone'] = bool(e['undone'])
    profile = dict(id=uuid.uuid4().hex, name=args.name.strip(), theme=settings.get('theme', 'midnight'),
                   created_at=now, updated_at=now, revision=0,
                   next_event_id=max((e['id'] for e in events), default=0) + 1,
                   trackers=trackers, events=events, requests=[])
    backup = dict(app='tempo-browser', schema=1,
                  exported_at=dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat(), profile=profile)
    try:
        with args.output.expanduser().open('x', encoding='utf-8') as output:
            json.dump(backup, output, ensure_ascii=False, indent=2, allow_nan=False)
            output.write('\n')
    except FileExistsError:
        parser.error('The output file already exists. Choose a new filename.')
    print(f'Exported {len(trackers)} trackers and {len(events)} entries to {args.output}.')
    print('In Tempo browser, select Import backup. Any running timers are paused at this export timestamp.')


if __name__ == '__main__':
    main()
