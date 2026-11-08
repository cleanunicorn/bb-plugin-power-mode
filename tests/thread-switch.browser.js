/* note: Thread switching with agent activity must not leave particle or bloom pixels (#17). */
// Run against tests/power-engine.html served on port 9146 (see tests/README.md).
await page.addInitScript(() => {
  let now = 10000, sequence = 0;
  const callbacks = new Map();
  const timers = new Map();
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
  const pixels = () => [...document.querySelectorAll('html > canvas')].map(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]) count++;
    return count;
  });
  const items = document.querySelector('[data-timeline-items]');
  const flush = async () => { await Promise.resolve(); advance(6); advance(); };
  // Replace the transcript as the host does when navigating between threads.
  const swapThread = async n => {
    items.replaceChildren(...[0, 1, 2].map(i => {
      const row = document.createElement('div');
      row.dataset.timelineRowId = `t${n}-${i}`;
      row.textContent = `Thread ${n} row ${i} with a good amount of agent output to count`;
      return row;
    }));
    await flush();
  };
  const idleReport = () => ({
    pixels: pixels(), vignette: document.querySelector('.pm-vignette').style.opacity,
    hud: document.querySelector('.pm-on') !== null,
  });
  const assertQuiet = (label) => {
    advance(400);
    const r = idleReport();
    assert(r.pixels.every(n => n === 0), `${label}: canvases keep pixels ${JSON.stringify(r.pixels)}`);
    assert(r.vignette === '0' || r.vignette === '', `${label}: vignette stays at ${r.vignette}`);
    assert(!r.hud, `${label}: HUD stays visible`);
  };
  advance(300);
  const setAgentRunning = running => PowerTest.syncAgentThreads(
    [{ id: 'thread', title: 'Thread', running, idle: !running }], 'thread');

  // 1. Repeated thread switches while the agent runs, then it stops.
  setAgentRunning(true);
  for (let n = 0; n < 12; n++) {
    await swapThread(n);
    items.lastChild.textContent += ' streaming more text';
    await flush();
    setAgentRunning(n % 3 !== 2);
    setAgentRunning(true);
  }
  setAgentRunning(false);
  assertQuiet('after switching threads');

  // 2. A frame that throws must not freeze the last frame on screen.
  setAgentRunning(true);
  items.firstChild.textContent += ' glow';
  await flush();
  assert(pixels().some(n => n > 0), 'Control: agent text must draw particles');
  const proto = CanvasRenderingContext2D.prototype;
  const original = proto.drawImage;
  let thrown = 0;
  proto.drawImage = function (...args) {
    // Let a few sprites land first so the aborted frame leaves pixels behind.
    if (++thrown > 3) throw new Error('simulated canvas failure');
    return original.apply(this, args);
  };
  const errors = [];
  const onError = e => { errors.push(e.message); e.preventDefault(); };
  window.addEventListener('error', onError);
  try { advance(3); } catch (e) { errors.push(e.message); }
  proto.drawImage = original;
  window.removeEventListener('error', onError);
  setAgentRunning(false);
  assert(thrown > 3, 'Control: the failure must actually be injected');
  assertQuiet('after a throwing frame');

  // 3. Negative control: active animation survives a thread switch.
  setAgentRunning(true);
  await swapThread(99);
  items.firstChild.textContent += ' still streaming';
  await flush();
  assert(pixels().some(n => n > 0), 'Active animation must survive a thread switch');
  setAgentRunning(false);
  assertQuiet('final');
  return { threadSwitchClears: true, throwingFrameClears: true, activeAnimationSurvives: true };
});
return result;
