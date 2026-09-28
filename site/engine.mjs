/** Tempo's pure tracking model. No DOM, network, or storage dependencies. */
export const VERSION = '2.0.0';
export const DAY = 86400;
export const THEMES = ['midnight', 'paper', 'forest', 'sage', 'violet', 'rose'];
export const COLORS = ['amber', 'mint', 'blue', 'rose', 'violet', 'cyan'];
export const MAX_EVENTS = 100000;
const MAX = 1e9;
const MAX_TIME = 32503680000;
const ID = /^[a-f0-9]{32}$/;

export const uid = () => crypto.randomUUID().replaceAll('-', '');
export const clock = () => Date.now() / 1000;
export class ValidationError extends Error {}
function fail(message) { throw new ValidationError(message); }
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}
function text(value, label, max, empty = false) {
  if (typeof value !== 'string') fail(`${label} must be text.`);
  value = value.trim();
  if ((!empty && !value) || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) {
    fail(`${label} must contain ${empty ? '0' : '1'}–${max} valid characters.`);
  }
  return value;
}
function num(value, label, min = 0, max = MAX) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}
function ident(value, label = 'Identifier') {
  if (typeof value !== 'string' || !ID.test(value)) fail(`${label} is invalid.`);
  return value;
}
function choice(value, values, label) {
  if (!values.includes(value)) fail(`Choose a valid ${label}.`);
  return value;
}
export function dayKey(timestamp) {
  const d = new Date(timestamp * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function dayBounds(timestamp) {
  const d = new Date(timestamp * 1000);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000;
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() / 1000;
  return [start, end];
}
function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Invalid entry date.');
  const d = new Date(value + 'T12:00:00Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) fail('Invalid entry date.');
  return value;
}
export function newProfile(name = 'My space', now = clock()) {
  return {id: uid(), name: text(name, 'Profile name', 60), theme: 'midnight',
    created_at: now, updated_at: now, revision: 0, next_event_id: 1,
    trackers: [], events: [], requests: []};
}
function getTracker(profile, id) {
  const t = profile.trackers.find(t => t.id === id);
  if (!t) fail('This tracker no longer exists. Refresh your space.');
  return t;
}
export function total(profile, t, now) {
  const today = dayKey(now);
  return profile.events.reduce((sum, e) => sum + (e.tracker_id === t.id && !e.undone &&
    (t.cadence === 'total' || e.day === today) ? e.amount : 0), 0);
}
function trackerFields(data, now, old = null) {
  object(data, 'Tracker');
  const kind = choice(data.kind, ['counter', 'timer', 'countdown', 'streak'], 'tracker type');
  let direction = choice(data.direction ?? 'goal', ['limit', 'goal'], 'target style');
  let cadence = choice(data.cadence ?? 'daily', ['daily', 'total'], 'reset period');
  if (old && (kind !== old.kind || cadence !== old.cadence)) fail('Type and reset period are fixed. Create a new tracker to change them.');
  let goal = kind === 'countdown' ? 1 : num(data.goal, 'Target', 0.001);
  const step = ['countdown', 'streak'].includes(kind) ? 1 : num(data.step ?? 1, 'Step', 0.001);
  if (kind === 'counter' && (!Number.isInteger(goal) || !Number.isInteger(step))) fail('Counters use whole numbers.');
  let unit = text(data.unit ?? 'units', 'Unit', 24);
  let start_at = old?.start_at ?? now, target_at = null;
  if (kind === 'countdown') {
    target_at = num(data.target_at, 'Event date', 0, MAX_TIME);
    if ((!old || target_at !== old.target_at) && target_at <= now) fail('Choose a future event date.');
    if (old && target_at !== old.target_at) start_at = now;
    goal = Math.max(1, target_at - start_at);
  }
  if (kind === 'streak') {
    start_at = num(data.start_at ?? start_at, 'Start time', 0, now);
    if (old && Math.abs(start_at - old.start_at) > .001) fail('Use Restart to reset the elapsed time.');
  }
  if (['countdown', 'streak'].includes(kind)) { direction = 'goal'; cadence = 'total'; unit = 'seconds'; }
  if (kind === 'timer') unit = 'seconds';
  return {title: text(data.title, 'Name', 80), kind, direction, cadence, unit, goal, step,
    color: choice(data.color ?? 'amber', COLORS, 'accent'), note: text(data.note ?? '', 'Note', 300, true),
    start_at, target_at};
}
function event(profile, t, amount, at, kind = 'entry', extra = {}) {
  if (profile.events.length >= MAX_EVENTS) fail('This profile has reached 100,000 entries. Export a backup and start a new profile.');
  profile.events.push({id: profile.next_event_id++, tracker_id: t.id, group_id: uid(), amount,
    day: dayKey(at), at, kind, previous_start: null, undone: false, ...extra});
}
export function stopTimer(profile, t, now) {
  if (t.running_since === null) return;
  let cursor = Math.min(t.running_since, now);
  const group_id = uid();
  while (cursor < now) {
    const end = Math.min(dayBounds(cursor)[1], now);
    if (end <= cursor) fail('Could not determine a local midnight boundary.');
    event(profile, t, end - cursor, end, 'session', {group_id, day: dayKey(cursor)});
    cursor = end;
  }
  t.running_since = null;
}
/** Mutates a transaction-local copy. Callers must commit only after success. */
export function applyAction(profile, data, key = uid(), now = clock()) {
  object(data, 'Action'); ident(key, 'Request identifier');
  const fingerprint = JSON.stringify(data);
  const prior = profile.requests.find(r => r.id === key);
  if (prior) {
    if (prior.fingerprint !== fingerprint) fail('A request identifier was reused for a different action.');
    return prior.result;
  }
  let result = {ok: true};
  if (data.op === 'theme') profile.theme = choice(data.theme, THEMES, 'theme');
  else if (data.op === 'rename-profile') profile.name = text(data.name, 'Profile name', 60);
  else if (data.op === 'create') {
    if (profile.trackers.length >= 500) fail('A profile can contain up to 500 trackers.');
    const t = {...trackerFields(data, now), id: uid(), created_at: now, running_since: null, archived: false};
    profile.trackers.push(t); result.id = t.id;
  } else {
    const t = getTracker(profile, data.id); result.id = t.id;
    if (data.op === 'edit') Object.assign(t, trackerFields(data, now, t));
    else if (data.op === 'archive') { stopTimer(profile, t, now); t.archived = !t.archived; }
    else if (data.op === 'delete') {
      if (data.confirm !== t.title) fail('Type the exact tracker name to delete it.');
      profile.trackers = profile.trackers.filter(x => x.id !== t.id);
      profile.events = profile.events.filter(e => e.tracker_id !== t.id);
    } else {
      if (t.archived) fail('Restore this tracker before changing it.');
      switch (data.op) {
        case 'add': {
          if (!['counter', 'timer'].includes(t.kind)) fail('This tracker does not accept entries.');
          const amount = num(data.amount, 'Amount', .001);
          if (t.kind === 'counter' && !Number.isInteger(amount)) fail('Count entries must be whole numbers.');
          const current = total(profile, t, now);
          if (current + amount > MAX) fail('The tracked total is too large.');
          if (t.kind === 'counter' && t.direction === 'limit' && current + amount > t.goal) fail('That would exceed this counter’s limit.');
          event(profile, t, amount, now); break;
        }
        case 'start':
          if (t.kind !== 'timer') fail('Only session timers can start.');
          if (t.running_since === null) t.running_since = now;
          break;
        case 'pause':
          if (t.kind !== 'timer') fail('Only session timers can pause.');
          stopTimer(profile, t, now); break;
        case 'reset':
          if (t.kind !== 'streak') fail('Only time-since trackers can restart.');
          event(profile, t, 0, now, 'restart', {previous_start: t.start_at});
          t.start_at = now; break;
        case 'undo': {
          const latest = profile.events.findLast ? profile.events.findLast(e => e.tracker_id === t.id && !e.undone)
            : [...profile.events].reverse().find(e => e.tracker_id === t.id && !e.undone);
          if (!latest) fail('There is no entry to undo.');
          if (latest.kind === 'restart') t.start_at = latest.previous_start;
          for (const e of profile.events) if (e.group_id === latest.group_id) e.undone = true;
          break;
        }
        default: fail('Unknown action.');
      }
    }
  }
  profile.updated_at = now; profile.revision++;
  profile.requests.push({id: key, fingerprint, result});
  profile.requests = profile.requests.slice(-128);
  return result;
}
export function snapshot(profile, now = clock()) {
  const [day_start, day_end] = dayBounds(now), day = dayKey(now);
  const values = new Map(), undo = new Set(), logged = new Set();
  const active = new Set(profile.trackers.filter(t => !t.archived).map(t => t.id));
  const daily = new Set(profile.trackers.filter(t => t.cadence === 'daily').map(t => t.id));
  for (const e of profile.events) {
    if (e.undone) continue;
    undo.add(e.tracker_id);
    if (!daily.has(e.tracker_id) || e.day === day) values.set(e.tracker_id, (values.get(e.tracker_id) ?? 0) + e.amount);
    if (e.day === day && active.has(e.tracker_id)) logged.add(e.group_id);
  }
  return {trackers: profile.trackers.map(t => ({...t, value: values.get(t.id) ?? 0, can_undo: undo.has(t.id)})),
    theme: profile.theme, now, day, day_start, day_end, logged_today: logged.size, version: VERSION,
    profile: {id: profile.id, name: profile.name, revision: profile.revision},
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone};
}
export function history(profile, id, now = clock()) {
  const t = getTracker(profile, id), current = new Date(now * 1000);
  const sums = new Map(), groups = new Map();
  for (const e of profile.events) {
    if (e.tracker_id !== id) continue;
    if (!e.undone) sums.set(e.day, (sums.get(e.day) ?? 0) + e.amount);
    const group = groups.get(e.group_id) ?? {...e, amount: 0, last_id: 0};
    group.amount += e.amount; group.at = Math.max(group.at, e.at); group.last_id = Math.max(group.last_id, e.id);
    groups.set(e.group_id, group);
  }
  const days = Array.from({length: 14}, (_, i) => {
    const d = new Date(current.getFullYear(), current.getMonth(), current.getDate() - 13 + i);
    const timestamp = d.getTime() / 1000, [left, right] = dayBounds(timestamp), day = dayKey(timestamp);
    let value = sums.get(day) ?? 0;
    if (t.running_since !== null) value += Math.max(0, Math.min(now, right) - Math.max(t.running_since, left));
    return {day, value};
  });
  return {tracker: {...t}, days, entries: [...groups.values()].sort((a, b) => b.last_id - a.last_id).slice(0, 80)};
}
/** Snapshot timers as paused without changing the live profile. */
export function exportProfile(profile, now = clock()) {
  const copy = structuredClone(profile);
  for (const t of copy.trackers) stopTimer(copy, t, now);
  copy.requests = [];
  return {app: 'tempo-browser', schema: 1, exported_at: new Date(now * 1000).toISOString(), profile: copy};
}
/** Strict allow-list validation: never merge arbitrary imported keys into live state. */
export function importProfile(backup, now = clock()) {
  object(backup, 'Backup');
  if (backup.app !== 'tempo-browser' || backup.schema !== 1) fail('This is not a supported Tempo browser backup (schema 1).');
  const exportedAt = Date.parse(backup.exported_at) / 1000;
  num(exportedAt, 'Export timestamp', 0, now + 300);
  const src = object(backup.profile, 'Profile');
  if (!Array.isArray(src.trackers) || src.trackers.length > 500) fail('Invalid tracker list (maximum 500).');
  if (!Array.isArray(src.events) || src.events.length > MAX_EVENTS) fail('Invalid entry list (maximum 100,000).');
  const profile = newProfile(text(src.name, 'Profile name', 60), now);
  profile.theme = choice(src.theme, THEMES, 'theme');
  const ids = new Set(), eventIds = new Set(), groups = new Map();
  profile.trackers = src.trackers.map(raw => {
    object(raw, 'Tracker'); const id = ident(raw.id);
    if (ids.has(id)) fail('Duplicate tracker identifier.'); ids.add(id);
    const kind = choice(raw.kind, ['counter', 'timer', 'countdown', 'streak'], 'tracker type');
    const t = {id, title: text(raw.title, 'Name', 80), kind,
      direction: choice(raw.direction, ['goal', 'limit'], 'target style'),
      cadence: choice(raw.cadence, ['daily', 'total'], 'reset period'),
      unit: text(raw.unit, 'Unit', 24), goal: num(raw.goal, 'Target', .001, kind === 'countdown' ? MAX_TIME : MAX),
      step: num(raw.step, 'Step', .001), color: choice(raw.color, COLORS, 'accent'),
      note: text(raw.note ?? '', 'Note', 300, true),
      created_at: num(raw.created_at, 'Creation time', 0, now + 300),
      start_at: num(raw.start_at, 'Start time', 0, now + 300),
      target_at: raw.target_at === null ? null : num(raw.target_at, 'Event date', 0, MAX_TIME),
      running_since: raw.running_since === null ? null : num(raw.running_since, 'Timer start', 0, exportedAt),
      archived: raw.archived === true || raw.archived === 1};
    if (![true, false, 0, 1].includes(raw.archived)) fail('Invalid archived flag.');
    if (kind === 'counter' && (!Number.isInteger(t.goal) || !Number.isInteger(t.step))) fail('Counters must use whole numbers.');
    if (kind === 'countdown' && (t.target_at === null || t.target_at <= t.start_at)) fail('Invalid countdown interval.');
    if (kind !== 'countdown' && t.target_at !== null) fail('Only countdowns can have an event date.');
    if (kind !== 'timer' && t.running_since !== null) fail('Only timers can be running.');
    if (['countdown', 'streak'].includes(kind) && (t.cadence !== 'total' || t.direction !== 'goal')) fail('Invalid time-tracker settings.');
    if (kind !== 'counter' && t.unit !== 'seconds') fail('Time trackers must use seconds internally.');
    return t;
  });
  const trackerMap = new Map(profile.trackers.map(t => [t.id, t]));
  profile.events = src.events.map(raw => {
    object(raw, 'Entry'); const id = num(raw.id, 'Entry identifier', 1, Number.MAX_SAFE_INTEGER - 1);
    if (!Number.isInteger(id) || eventIds.has(id)) fail('Duplicate or invalid entry identifier.'); eventIds.add(id);
    const tracker_id = ident(raw.tracker_id), t = trackerMap.get(tracker_id);
    if (!t) fail('An entry points to a missing tracker.');
    const e = {id, tracker_id, group_id: ident(raw.group_id), amount: num(raw.amount, 'Entry amount'),
      day: validDay(raw.day), at: num(raw.at, 'Entry timestamp', 0, now + 300),
      kind: choice(raw.kind, ['entry', 'session', 'restart'], 'entry type'),
      previous_start: raw.previous_start === null ? null : num(raw.previous_start, 'Previous start', 0, now + 300),
      undone: raw.undone === true || raw.undone === 1};
    if (![true, false, 0, 1].includes(raw.undone)) fail('Invalid undo flag.');
    if (e.kind === 'restart') {
      if (t.kind !== 'streak' || e.amount !== 0 || e.previous_start === null || e.previous_start > e.at) fail('Invalid restart entry.');
    } else {
      if (!['counter', 'timer'].includes(t.kind) || e.amount <= 0 || e.previous_start !== null) fail('Invalid amount entry.');
      if (e.kind === 'session' && t.kind !== 'timer') fail('Only timers can have sessions.');
      if (t.kind === 'counter' && !Number.isInteger(e.amount)) fail('Counter entries must be whole numbers.');
    }
    const identity = `${e.tracker_id}:${e.kind}:${e.undone}`;
    if (groups.has(e.group_id) && (groups.get(e.group_id) !== identity || e.kind !== 'session')) fail('Invalid grouped entries.');
    groups.set(e.group_id, identity);
    return e;
  }).sort((a, b) => a.id - b.id);
  profile.next_event_id = profile.events.reduce((max, e) => Math.max(max, e.id), 0) + 1;
  // Old/migrated backups may contain active sessions. Freeze them at export time.
  for (const t of profile.trackers) stopTimer(profile, t, exportedAt);
  return profile;
}
export function csvExport(profile, now = clock()) {
  const copy = exportProfile(profile, now).profile;
  const trackers = new Map(copy.trackers.map(t => [t.id, t]));
  function field(value) {
    let str = String(value);
    if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
    return '"' + str.replaceAll('"', '""') + '"';
  }
  const rows = [['profile', 'tracker', 'type', 'local_day', 'timestamp_utc', 'amount', 'unit', 'entry_type', 'undone']];
  for (const e of copy.events) {
    const t = trackers.get(e.tracker_id);
    rows.push([copy.name, t.title, t.kind, e.day, new Date(e.at * 1000).toISOString(), e.amount, t.unit, e.kind, e.undone]);
  }
  return '\ufeff' + rows.map(row => row.map(field).join(',')).join('\r\n') + '\r\n';
}
