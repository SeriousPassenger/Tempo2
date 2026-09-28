import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAction, newProfile, snapshot, history, exportProfile, importProfile, csvExport, dayBounds, uid, DAY} from '../site/engine.mjs';

const NOW = new Date(2026, 8, 28, 12, 0).getTime() / 1000;
function action(p, op, data = {}, now = NOW, key = uid()) {
  // Match IndexedDB's commit-on-success semantics; failures discard the copy.
  const copy = structuredClone(p), result = applyAction(copy, {op, ...data}, key, now);
  Object.assign(p, copy); return result;
}
function create(p, extra = {}) {
  return action(p, 'create', {title: 'My tracker', kind: 'counter', direction: 'limit', cadence: 'daily',
    goal: 10, step: 1, unit: 'units', color: 'mint', ...extra}).id;
}
const tracker = (p, id, now = NOW) => snapshot(p, now).trackers.find(t => t.id === id);

test('daily limit counts 10 → 9, stops at zero, and undo restores one', () => {
  const p = newProfile('One', NOW), id = create(p);
  action(p, 'add', {id, amount: 1}); assert.equal(10 - tracker(p, id).value, 9);
  action(p, 'add', {id, amount: 9});
  assert.throws(() => action(p, 'add', {id, amount: 1}), /limit/);
  action(p, 'undo', {id}); assert.equal(tracker(p, id).value, 1);
});
test('goals can pass their target', () => {
  const p = newProfile(), id = create(p, {direction: 'goal'});
  action(p, 'add', {id, amount: 12}); assert.equal(tracker(p, id).value, 12);
});
test('daily reset retains yesterday; ongoing totals persist', () => {
  const p = newProfile(), daily = create(p), total = create(p, {cadence: 'total'});
  action(p, 'add', {id: daily, amount: 4}); action(p, 'add', {id: total, amount: 4});
  const tomorrow = dayBounds(NOW)[1] + 2;
  assert.equal(tracker(p, daily, tomorrow).value, 0);
  assert.equal(tracker(p, total, tomorrow).value, 4);
  assert.equal(history(p, daily, tomorrow).days.at(-2).value, 4);
});
test('saved session start survives reload; duplicate start and pause are safe', () => {
  let p = newProfile(); const id = create(p, {kind: 'timer', goal: 1200});
  action(p, 'start', {id}); p = JSON.parse(JSON.stringify(p));
  action(p, 'start', {id}, NOW + 10); assert.equal(tracker(p, id).running_since, NOW);
  action(p, 'pause', {id}, NOW + 65); action(p, 'pause', {id}, NOW + 90);
  assert.equal(tracker(p, id).value, 65);
});
test('midnight sessions split into local dates and undo as one group', () => {
  const p = newProfile(), id = create(p, {kind: 'timer'}), midnight = dayBounds(NOW)[1];
  action(p, 'start', {id}, midnight - 30);
  assert.deepEqual(history(p, id, midnight + 45).days.slice(-2).map(d => d.value), [30, 45]);
  action(p, 'pause', {id}, midnight + 45);
  assert.equal(tracker(p, id, midnight + 45).value, 45);
  assert.equal(history(p, id, midnight + 45).entries[0].amount, 75);
  action(p, 'undo', {id}, midnight + 46);
  assert.equal(history(p, id, midnight + 46).days.reduce((sum, d) => sum + d.value, 0), 0);
});
test('time budgets preserve overruns', () => {
  const p = newProfile(), id = create(p, {kind: 'timer', goal: 60});
  action(p, 'add', {id, amount: 70}); assert.equal(tracker(p, id).value, 70);
});
test('DST boundaries use 23/25-hour local days', () => {
  const old = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    for (const [month, date, hours] of [[2, 8, 23], [10, 1, 25]]) {
      const [a, b] = dayBounds(new Date(2026, month, date, 12).getTime() / 1000);
      assert.equal(b - a, hours * 3600);
      const p = newProfile(), id = create(p, {kind: 'timer'});
      action(p, 'start', {id}, a - 20); action(p, 'pause', {id}, b + 20);
      assert.deepEqual(p.events.map(e => e.amount), [20, hours * 3600, 20]);
    }
  } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
});
test('countdown accepts 30 days and preserves the event through editing', () => {
  const p = newProfile(), id = create(p, {kind: 'countdown', target_at: NOW + 30 * DAY});
  const t = tracker(p, id); assert.equal(t.goal, 30 * DAY); assert.equal(t.cadence, 'total');
  action(p, 'edit', {...t, title: 'Later title'}, NOW + 31 * DAY);
  assert.equal(tracker(p, id).target_at, NOW + 30 * DAY);
});
test('time since can restart and undo sequentially', () => {
  const p = newProfile(), id = create(p, {kind: 'streak', start_at: NOW - 5 * DAY, goal: 30 * DAY});
  action(p, 'reset', {id}); action(p, 'reset', {id}, NOW + 10);
  action(p, 'undo', {id}, NOW + 11); assert.equal(tracker(p, id).start_at, NOW);
  action(p, 'undo', {id}, NOW + 12); assert.equal(tracker(p, id).start_at, NOW - 5 * DAY);
});
test('idempotency keys prevent duplicated clicks', () => {
  const p = newProfile(), id = create(p), key = uid();
  action(p, 'add', {id, amount: 1}, NOW, key); action(p, 'add', {id, amount: 1}, NOW, key);
  assert.equal(tracker(p, id).value, 1);
  assert.throws(() => action(p, 'add', {id, amount: 2}, NOW, key), /reused/);
});
test('invalid values do not partially mutate the committed profile', () => {
  const p = newProfile(), id = create(p), before = JSON.stringify(p);
  for (const amount of [NaN, Infinity, -1, 0, '1', true, .5, 1e20]) {
    assert.throws(() => action(p, 'add', {id, amount})); assert.equal(JSON.stringify(p), before);
  }
});
test('archiving pauses time; restore keeps history', () => {
  const p = newProfile(), id = create(p, {kind: 'timer'});
  action(p, 'start', {id}); action(p, 'archive', {id}, NOW + 30);
  assert.equal(tracker(p, id).value, 30); assert.equal(tracker(p, id).running_since, null);
  assert.throws(() => action(p, 'add', {id, amount: 1}), /Restore/);
  action(p, 'archive', {id}); assert.equal(tracker(p, id).archived, false);
});
test('deletion requires exact name and removes only matching history', () => {
  const p = newProfile(), one = create(p, {title: 'Çetele'}), two = create(p);
  action(p, 'add', {id: one, amount: 1}); action(p, 'add', {id: two, amount: 2});
  assert.throws(() => action(p, 'delete', {id: one, confirm: 'wrong'}));
  action(p, 'delete', {id: one, confirm: 'Çetele'});
  assert.equal(p.trackers.length, 1); assert.equal(p.events.length, 1); assert.equal(p.events[0].tracker_id, two);
});
test('type/cadence editing is blocked but title and goal are editable', () => {
  const p = newProfile(), id = create(p), t = tracker(p, id);
  action(p, 'edit', {...t, title: 'Renamed', goal: 12}); assert.equal(tracker(p, id).title, 'Renamed');
  assert.throws(() => action(p, 'edit', {...t, cadence: 'total'}));
});
test('all six themes persist and profiles remain isolated', () => {
  const a = newProfile('A'), b = newProfile('B'), id = create(a);
  action(a, 'add', {id, amount: 2});
  for (const theme of ['midnight','paper','forest','sage','violet','rose']) {
    action(a, 'theme', {theme}); assert.equal(snapshot(a).theme, theme);
  }
  assert.equal(b.trackers.length, 0); assert.equal(b.theme, 'midnight');
});
test('JSON round-trip preserves Unicode, history, undo and theme', () => {
  const p = newProfile('Heath · çetele', NOW), id = create(p, {title: 'Günlük çetele'});
  action(p, 'add', {id, amount: 3}); action(p, 'theme', {theme: 'sage'});
  const restored = importProfile(JSON.parse(JSON.stringify(exportProfile(p, NOW))), NOW);
  assert.notEqual(restored.id, p.id); assert.equal(restored.name, p.name);
  assert.equal(tracker(restored, id).value, 3); assert.equal(restored.theme, 'sage');
  action(restored, 'undo', {id}); assert.equal(tracker(restored, id).value, 0);
  assert.equal(tracker(p, id).value, 3);
});
test('export snapshots active timers as paused without changing the live session', () => {
  const p = newProfile(), id = create(p, {kind: 'timer'}); action(p, 'start', {id});
  const backup = exportProfile(p, NOW + 65), restored = importProfile(backup, NOW + 100);
  assert.equal(tracker(p, id).running_since, NOW); assert.equal(p.events.length, 0);
  assert.equal(tracker(restored, id).running_since, null); assert.equal(tracker(restored, id).value, 65);
});
test('malformed schema, duplicate IDs, dates and dangling entries are rejected', () => {
  const p = newProfile(), id = create(p); action(p, 'add', {id, amount: 1});
  const baseline = exportProfile(p, NOW);
  for (const corrupt of [
    b => { b.schema = 999; }, b => { b.profile.trackers.push(b.profile.trackers[0]); },
    b => { b.profile.events[0].tracker_id = 'a'.repeat(32); },
    b => { b.profile.events[0].day = '2026-02-31'; },
    b => { b.profile.events[0].amount = -1; }, b => { b.profile.events[0].kind = 'restart'; },
    b => { b.profile.trackers[0].color = 'red;bad'; }, b => { b.profile.trackers[0].id = '<script>'; },
  ]) { const b = structuredClone(baseline); corrupt(b); assert.throws(() => importProfile(b, NOW)); }
});
test('prototype-shaped keys are ignored rather than assigned', () => {
  const p = newProfile(), backup = exportProfile(p, NOW);
  const poisoned = JSON.parse(JSON.stringify(backup).replace('"profile":{', '"profile":{"__proto__":{"polluted":true},'));
  const restored = importProfile(poisoned, NOW);
  assert.equal(restored.polluted, undefined); assert.equal({}.polluted, undefined);
});
test('CSV neutralizes formulas and has the correct event type', () => {
  const p = newProfile('=evil'), id = create(p, {kind: 'timer', title: '=1+1'});
  action(p, 'start', {id}); action(p, 'pause', {id}, NOW + 10);
  const csv = csvExport(p, NOW + 11);
  assert.match(csv, /"'=1\+1"/); assert.match(csv, /"timer"/); assert.match(csv, /"session"/);
});
