/* note: Agent attribution (#12): per-thread word counts, finales and stats. */
// Run against tests/power-engine.html served on port 9146 (see tests/README.md).
await page.addInitScript(() => {
  let now = 10000, sequence = 0;
  const callbacks = new Map();
  const timers = new Map();
  window.audioContexts = 0;
  const RealAudio = window.AudioContext;
  window.AudioContext = class extends RealAudio {
    constructor(...args) { super(...args); window.audioContexts++; }
  };
  Object.defineProperty(performance, 'now', { value: () => now });
  window.requestAnimationFrame = callback => {
    callbacks.set(++sequence, callback);
    return sequence;
  };
  window.cancelAnimationFrame = id => callbacks.delete(id);
  window.setTimeout = (callback, delay = 0) => {
    timers.set(++sequence, { callback, at: now + delay });
    return sequence;
  };
  window.clearTimeout = id => timers.delete(id);
  window.advance = (count = 1) => {
    for (let i = 0; i < count; i++) {
      now += 16.67;
      const renders = [...callbacks.values()].filter(callback => callback.name === 'frame');
      if (renders.length > 1) throw new Error('Effects started duplicate animation loops');
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(now);
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) { timers.delete(id); timer.callback(); }
      }
    }
  };
});
await page.goto('http://127.0.0.1:9146/power-engine.html');
const result = await page.evaluate(async () => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const T = PowerTest;
  const slams = [];
  const root = document.documentElement;
  const append = root.appendChild.bind(root);
  root.appendChild = el => {
    if (el.classList && el.classList.contains('pm-slam')) slams.push(el.firstChild.textContent + ' | ' + (el.querySelector('small')?.textContent ?? ''));
    return append(el);
  };
  const finales = () => slams.filter(s => s.startsWith('TURN COMPLETE'));
  const hudCount = () => Number(document.querySelector('.pm-hud-count').textContent);
  const hudOn = () => document.querySelector('.pm-hud').classList.contains('pm-on');
  const stats = () => T.getPowerStats();
  const tick = async (frames = 8) => { await Promise.resolve(); advance(frames); await Promise.resolve(); };
  const row = document.querySelector('[data-timeline-row-id]');
  let written = 0;
  const stream = async (n, flush = true) => {
    row.textContent += ' ' + Array.from({ length: n }, (_, i) => `w${written++}x${i}`).join(' ');
    if (flush) await tick();
  };
  const A = 'thr_a', B = 'thr_b';
  const th = (id, state) => ({ id, title: id === A ? 'Alpha thread' : 'Beta thread', running: state === 'running', idle: state === 'idle' });
  const sync = (a, b, visible) => T.syncAgentThreads([th(A, a), th(B, b)].filter((t, i) => (i === 0 ? a : b)), visible);
  const reset = async () => {
    sync('idle', 'idle', A); await tick(30);
    row.textContent = 'Agent output'; await tick(30);
  };
  T.resetPowerStats();
  T.updatePowerSettings({ enabled: true, agentMode: true, sound: false });
  advance(100);

  // 1. A background thread finishing leaves the visible count, best and finale alone.
  sync('running', 'running', A); advance(30);
  await stream(30);
  assert(hudCount() === 30 && hudOn(), `Visible words counted (${hudCount()})`);
  const turns0 = stats().agentTurns;
  sync('running', 'idle', A); await tick();
  assert(hudCount() === 30 && hudOn(), `Background finish must not reset the visible count (${hudCount()})`);
  assert(finales().length === 0, `Background finish must not show a finale (${finales()})`);
  assert(stats().bestAgentWords === 0, `Background finish must not set bestAgentWords (${stats().bestAgentWords})`);
  assert(stats().agentTurns === turns0 + 1, 'Background finish still counts as a turn');
  await stream(5);
  assert(hudCount() === 35, `Visible count keeps growing after a background finish (${hudCount()})`);
  sync('idle', 'idle', A); await tick();
  assert(finales().length === 1 && finales()[0].includes('35 WORDS') && finales()[0].includes('Alpha thread'), `Finale carries the visible thread's words and title (${finales()})`);
  assert(stats().bestAgentWords === 35, `Visible finish records its words (${stats().bestAgentWords})`);

  // 2. Two simultaneous finishes show exactly one finale, for the visible thread.
  await reset(); slams.length = 0;
  sync('running', 'running', B); advance(30);
  await stream(40);
  sync('idle', 'idle', B); await tick();
  assert(finales().length === 1, `Exactly one finale for two simultaneous finishes (${finales()})`);
  assert(finales()[0].includes('40 WORDS') && finales()[0].includes('Beta thread'), `Finale is the visible thread's (${finales()})`);

  // 3. Concurrent turns do not mix counts; a new turn starts from zero.
  await reset(); slams.length = 0;
  sync('running', 'running', A); advance(30);
  await stream(25);
  sync('running', 'running', B); await tick(30); // switch the screen to B; its transcript swaps in
  row.textContent = 'Beta transcript'; await tick(30);
  await stream(22);
  assert(hudCount() === 22, `B counts only its own words (${hudCount()})`);
  sync('running', 'idle', B); await tick();
  assert(finales().length === 1 && finales()[0].includes('22 WORDS') && finales()[0].includes('Beta thread'), `B's finale is B's (${finales()})`);
  sync('idle', 'idle', A); await tick(); // A finishes off screen: no finale
  assert(finales().length === 1, 'A finishing off screen shows no finale');
  await reset(); slams.length = 0;
  sync('running', 'idle', A); advance(30);
  await stream(21);
  assert(hudCount() === 21, `A fresh turn starts from zero (${hudCount()})`);
  sync('idle', 'idle', A); await tick();

  // 4. The visible thread changes in the same update that a thread finishes.
  await reset(); slams.length = 0;
  const best4 = stats().bestAgentWords;
  sync('running', 'running', A); advance(30);
  await stream(33, false); // buffered, not yet flushed
  sync('idle', 'running', B); await tick(30);
  assert(finales().length === 0, `No finale for a thread that is no longer on screen (${finales()})`);
  assert(stats().bestAgentWords === Math.max(best4, 33), `Buffered words went to the old thread (${stats().bestAgentWords})`);
  await stream(7);
  assert(!hudOn() || hudCount() <= 7, `New visible thread does not inherit the old count (${hudCount()})`);
  sync('idle', 'idle', B); await tick();

  // 5. Unknown route: credit only when exactly one thread runs.
  await reset(); slams.length = 0;
  const best5 = stats().bestAgentWords;
  sync('running', 'running', null); advance(30);
  await stream(30);
  sync('idle', 'running', null); await tick(); sync('idle', 'idle', null); await tick();
  assert(finales().length === 0 && stats().bestAgentWords === best5, 'Ambiguous attribution shows no finale and no best');
  await reset();
  sync('running', 'idle', null); advance(30);
  await stream(26);
  sync('idle', 'idle', null); await tick();
  assert(finales().length === 1 && finales()[0].includes('26 WORDS'), `A single running thread is credited without a route (${finales()})`);

  // 6. Vanished threads leave nothing behind.
  await reset(); slams.length = 0;
  sync('running', 'idle', A); advance(30);
  await stream(30);
  T.syncAgentThreads([], A); await tick(30);
  sync('running', 'idle', A); advance(30);
  await stream(5);
  assert(hudCount() === 5, `A thread that vanished and returned starts over (${hudCount()})`);
  sync('idle', 'idle', A); await tick();
  return { ok: true };
});
return result;
