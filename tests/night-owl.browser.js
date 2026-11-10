/* note: Night Owl (#11): unlocks only when typing at night, local time 00:00 inclusive to 04:00 exclusive. */
// Run against tests/power-engine.html served on port 9146 (see tests/README.md).
await page.addInitScript(() => {
  let now = 10000, sequence = 0;
  const callbacks = new Map();
  const timers = new Map();
  Object.defineProperty(performance, 'now', { value: () => now });
  window.requestAnimationFrame = callback => { callbacks.set(++sequence, callback); return sequence; };
  window.cancelAnimationFrame = id => callbacks.delete(id);
  window.setTimeout = (callback, delay = 0) => { timers.set(++sequence, { callback, at: now + delay }); return sequence; };
  window.clearTimeout = id => timers.delete(id);
  window.advance = (count = 1) => {
    for (let i = 0; i < count; i++) {
      now += 16.67;
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(now);
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    }
  };
  // Controllable local clock: Date.now() and new Date() agree; getHours() is local time.
  const RealDate = Date;
  let clock = new RealDate(2026, 0, 15, 12, 0, 0).getTime();
  window.setClock = (hour, minute = 0, second = 0, ms = 0) => { clock = new RealDate(2026, 0, 15, hour, minute, second, ms).getTime(); };
  window.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  };
});
await page.goto('http://127.0.0.1:9146/power-engine.html');
const result = await page.evaluate(async () => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const T = PowerTest;
  const owl = () => !!T.getPowerStats().unlocked['night-owl'];
  const field = document.querySelector('.field');
  const key = (inputType = 'insertText', data = 'a') => {
    field.focus();
    if (inputType === 'insertText') field.value += data;
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data: inputType === 'insertText' ? data : null }));
    advance(3);
  };
  const fresh = (hour, minute = 0, second = 0, ms = 0) => {
    T.resetPowerStats();
    field.value = '';
    setClock(hour, minute, second, ms);
  };
  T.updatePowerSettings({ enabled: true, sound: false });
  advance(50);

  // Time boundaries: 00:00 inclusive to 04:00 exclusive.
  const cases = [[0, 0, 0, 0, true], [3, 59, 59, 999, true], [2, 30, 0, 0, true], [4, 0, 0, 0, false], [23, 59, 59, 999, false], [12, 0, 0, 0, false]];
  for (const [h, m, s, ms, expected] of cases) {
    fresh(h, m, s, ms);
    key();
    assert(owl() === expected, `Typing at ${h}:${m}:${s}.${ms} should ${expected ? '' : 'not '}unlock Night Owl`);
  }

  // Daytime typing, then only nighttime agent activity and theme changes.
  fresh(14);
  key();
  assert(T.getPowerStats().chars > 0 && !owl(), 'Daytime typing alone does not unlock it');
  setClock(1, 30);
  T.updatePowerSettings({ theme: 'retro' });
  T.updatePowerSettings({ theme: 'neon' });
  for (const id of T.THEME_IDS) T.updatePowerSettings({ theme: id });
  T.syncAgentThreads([{ id: 'thr_a', title: 'A', running: true, idle: false }], 'thr_a');
  advance(30);
  document.querySelector('[data-timeline-row-id]').textContent += ' ' + Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ');
  await Promise.resolve(); advance(8);
  T.syncAgentThreads([{ id: 'thr_a', title: 'A', running: false, idle: true }], 'thr_a');
  await Promise.resolve(); advance(30);
  const s = T.getPowerStats();
  assert(s.agentTurns > 0 || s.agentChars > 0 || s.themesTried.length > 1, 'Nighttime agent/theme events were recorded');
  assert(!owl(), 'Nighttime agent activity and theme changes after daytime typing must not unlock Night Owl');
  T.recordStats(x => ({ ...x, milestones: x.milestones + 1 }));
  assert(!owl(), 'A stats mutation without typing must not unlock Night Owl');

  // Nighttime deletion and paste do not count as typing.
  fresh(1);
  key('deleteContentBackward');
  assert(!owl(), 'A nighttime deletion does not unlock it');
  key('insertFromPaste');
  assert(!owl(), 'A nighttime paste does not unlock it');
  key();
  assert(owl(), 'A nighttime character insert unlocks it');

  // Existing unlocks survive later daytime activity.
  const at = T.getPowerStats().unlocked['night-owl'];
  setClock(15);
  key();
  assert(T.getPowerStats().unlocked['night-owl'] === at, 'An existing unlock is preserved');
  return { boundaries: cases.length, unlockedAt: at };
});
return result;
