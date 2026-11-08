/* note: Stats across multiple windows (#10): shared localStorage, locked merge, reset epoch. */
// Run against tests/power-engine.html served on port 9146 (see tests/README.md).
const URL = 'http://127.0.0.1:9146/power-engine.html';
const KEY = 'bb-plugin-power-mode:power-mode:stats';
const assert = (ok, message) => { if (!ok) throw new Error(message); };
// betterwright exposes one page per script, so the two "windows" are same-origin
// iframes. Each loads its own copy of the engine bundle (a separate module
// instance), shares localStorage and navigator.locks with the other, and gets
// `storage` events for the other's writes, exactly like two windows of a profile.
await page.goto(URL);
await page.evaluate(([url]) => {
  document.body.innerHTML = '<iframe id="fa"></iframe><iframe id="fb"></iframe>';
}, [URL]);
const frame = id => ({
  id,
  evaluate: (fn, arg) => page.evaluate(([id, src, arg]) => document.getElementById(id).contentWindow.eval('(' + src + ')')(arg), [id, fn.toString(), arg]),
  load: (url = URL) => page.evaluate(([id, url]) => new Promise(resolve => {
    const f = document.getElementById(id);
    f.onload = () => resolve();
    f.contentWindow.location.replace(url);
  }), [id, url]),
});
const A = frame('fa'), B = frame('fb');
const boot = async (p, clear = false) => {
  await p.load();
  await p.evaluate(() => {
    // Count notifications per window; the engine's own handler is replaced.
    window.toasts = [];
    PowerTest.setUnlockHandler(a => window.toasts.push(a.id));
  });
};
// Windows are parked on about:blank while storage is prepared, so no live
// engine reacts to the setup. The host page shares the origin and storage.
const prepare = async value => {
  await A.load('about:blank'); await B.load('about:blank');
  await page.evaluate(([k, v]) => v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v), [KEY, value]);
  await boot(A); await boot(B);
};
const both = () => prepare(null);
// Storage events are delivered as queued tasks; poll instead of sleeping.
const until = async (what, read, pred) => {
  let v;
  for (let i = 0; i < 40; i++) { v = await read(); if (pred(v)) return v; await page.waitForTimeout(50); }
  throw new Error('timed out: ' + what + ' ' + JSON.stringify(v));
};
const get = p => p.evaluate(() => PowerTest.getPowerStats());
const stored = p => p.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), KEY);
const toasts = p => p.evaluate(() => window.toasts);
const record = (p, n, extra = {}) => p.evaluate(([n, extra]) => PowerTest.recordStats(s => ({ ...s, chars: s.chars + n, ...extra })), [n, extra]);
const flush = p => p.evaluate(() => PowerTest.flushPowerStats());
 // storage events are queued tasks

// (a) overlapping flushes keep both windows' increments, bests and unlocks;
// a threshold crossed only by the merged total unlocks once, not twice.
await both();
await record(A, 600, { pastes: 3, bestCombo: 12 });
await record(B, 600, { pastes: 4, bestCombo: 60, themesTried: ['neon'] });
await Promise.all([flush(A), flush(B)]);
for (const p of [A, B]) {
  const s = await until('a: merge visible', () => get(p), s => s.chars === 1200);
  assert(s.chars === 1200 && s.pastes === 7 && s.bestCombo === 60, 'a: both windows live merged: ' + JSON.stringify(s));
  assert(s.unlocked['chars-1k'], 'a: chars-1k crossed by merged total');
  assert(s.unlocked['combo-10'] && s.unlocked['combo-50'], 'a: both windows unlocks kept');
}
const all = [...await toasts(A), ...await toasts(B)];
assert(all.filter(id => id === 'chars-1k').length === 1, 'a: chars-1k toasted once across windows: ' + all);
assert(all.filter(id => id === 'first-spark').length === 1, 'a: first-spark toasted once: ' + all);
await boot(A); await boot(B);
const reloaded = await stored(A);
assert(reloaded.chars === 1200 && reloaded.pastes === 7 && reloaded.themesTried.includes('neon'), 'a: persisted after reload');
assert(reloaded.unlocked['chars-1k'] && reloaded.unlocked['combo-50'], 'a: unlocks persisted');

// (b) repeated flushes never double-count a delta.
await both();
await record(A, 10); await flush(A); await flush(A); await flush(B);
assert((await stored(A)).chars === 10, 'b: idempotent flush');
await record(B, 5); await flush(B); await flush(A);
await until('b', () => get(A), s => s.chars === 15);
assert((await stored(A)).chars === 15, 'b: sequential increments');

// (c) reset propagates; a stale window with unsent activity cannot restore it.
await both();
await record(A, 100); await flush(A);
await until('c: B sees A', () => get(B), s => s.chars === 100);
await record(B, 7); // B holds 107 locally, unsent
await A.evaluate(() => PowerTest.resetPowerStats());
await flush(A);
await until('c: reset reached B through the storage event', () => get(B), s => s.chars === 0);
await flush(B);
let s = await stored(A);
assert(s.chars === 0 && Object.keys(s.unlocked).length === 0, 'c: stale window did not restore: ' + JSON.stringify(s));
await boot(B);
assert((await get(B)).chars === 0, 'c: still empty after reload');

// (c2) a flush that races the reset (no waiting for the event) also drops its stale delta.
await both();
await record(A, 100); await flush(A);
await until('c2: B sees A', () => get(B), s => s.chars === 100);
await record(B, 7);
await A.evaluate(() => PowerTest.resetPowerStats());
await Promise.all([flush(B), flush(A)]);
s = await stored(A);
assert(s.chars === 0, 'c2: flush racing a reset leaves empty stats: ' + s.chars);
await until('c2: B adopted the reset', () => get(B), s => s.chars === 0);

// (d) a flush queued before the reset must not re-merge old data; later activity still counts.
await both();
await record(A, 50);
const result = await A.evaluate(async () => {
  const queued = PowerTest.flushPowerStats();
  PowerTest.resetPowerStats();
  PowerTest.recordStats(s => ({ ...s, chars: s.chars + 3 }));
  await queued; await PowerTest.flushPowerStats();
  return JSON.parse(localStorage.getItem('bb-plugin-power-mode:power-mode:stats'));
});
assert(result.chars === 3 && result.epoch, 'd: queued flush + reset keeps only post-reset activity: ' + JSON.stringify(result));
await until('d: B sees reset', () => get(B), s => s.chars === 3);
await record(B, 4); await flush(B);
await until('d', () => get(A), s => s.chars === 7);
assert((await stored(A)).chars === 7, 'd: activity after reset recorded from both windows');

// (e) legacy documents (no epoch) keep their numbers; loading alone writes nothing.
const legacy = JSON.stringify({ chars: 1234, deletes: 5, pastes: 2, milestones: 1, bestCombo: 40, bestWpm: 70, agentChars: 9, bestAgentWords: 3, agentTurns: 1, themesTried: ['neon'], unlocked: { 'first-spark': 111 } });
await prepare(legacy);
assert((await A.evaluate(k => localStorage.getItem(k), KEY)) === legacy, 'e: load did not rewrite the legacy doc');
assert((await get(B)).chars === 1234 && (await get(B)).unlocked['first-spark'] === 111, 'e: legacy numbers kept');
await record(A, 1); await record(B, 2); await Promise.all([flush(A), flush(B)]);
s = await stored(A);
assert(s.chars === 1237 && s.deletes === 5 && s.bestCombo === 40 && s.unlocked['first-spark'] === 111, 'e: legacy merge: ' + JSON.stringify(s));
assert(!(await toasts(A)).includes('first-spark') && !(await toasts(B)).includes('first-spark'), 'e: no duplicate notification for stored unlock');

// (g) typing that crosses no threshold never touches storage; a queued flush's promise resolves after the write.
await both();
await record(A, 1); await flush(A); // first-spark already claimed
const probe = await A.evaluate(async () => {
  let reads = 0;
  const get = Storage.prototype.getItem;
  Storage.prototype.getItem = function (...a) { reads++; return get.apply(this, a); };
  for (let i = 0; i < 50; i++) PowerTest.recordStats(s => ({ ...s, chars: s.chars + 1 }));
  const during = reads;
  const p1 = PowerTest.flushPowerStats(), p2 = PowerTest.flushPowerStats();
  await p2;
  Storage.prototype.getItem = get;
  return { during, written: JSON.parse(localStorage.getItem('bb-plugin-power-mode:power-mode:stats')).chars, same: p1 === p2 };
});
assert(probe.during === 0, 'g: recordStats read storage ' + probe.during + ' times');
assert(probe.written === 51, 'g: second flushPowerStats resolved before the write: ' + probe.written);

// (f) cleared storage is an empty document with a new epoch for other windows.
await A.evaluate(k => localStorage.removeItem(k), KEY);
await until('f: storage clear reached B', () => get(B), s => s.chars === 0);

return 'ok';
