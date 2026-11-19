/* note: Scrolling a chat must not count as agent output (rows mounted by history paging or virtualization). */
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
  const items = document.querySelector('[data-timeline-items]');
  const scroller = items.parentElement;
  scroller.style.overflowY = 'auto';
  const tick = async (frames = 8) => { await Promise.resolve(); advance(frames); await Promise.resolve(); };
  const chars = () => T.getPowerStats().agentChars;
  const words = n => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  const makeRow = (id, text) => {
    const row = document.createElement('div');
    row.dataset.timelineRowId = id;
    row.textContent = text;
    return row;
  };
  const rowById = id => items.querySelector(`[data-timeline-row-id="${id}"]`);
  const spacer = () => {
    const el = document.createElement('div');
    el.dataset.timelineWindowSpacer = '';
    el.style.height = '400px';
    return el;
  };
  const thread = running => [{ id: 'a', title: 'Agent', running, idle: !running }];
  // Each case starts a fresh observation over a known transcript r0..r4.
  const begin = async () => {
    T.syncAgentThreads(thread(false), 'a'); await tick(30);
    items.replaceChildren(...[0, 1, 2, 3, 4].map(i => makeRow(`r${i}`, `Known row ${i} ${words(20)}`)));
    T.syncAgentThreads(thread(true), 'a'); await tick(30);
  };
  const wheel = () => scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));

  T.resetPowerStats();
  T.updatePowerSettings({ enabled: true, agentMode: true, sound: false });
  advance(100);

  // 1. An older page prepended above the known rows (no gesture: the page can
  // arrive long after the wheel) is history, not output.
  await begin();
  let before = chars();
  items.prepend(...[0, 1, 2].map(i => makeRow(`old${i}`, `Older history ${i} ${words(40)}`)));
  await tick();
  assert(chars() === before, `Prepended history counted as agent output (${chars() - before} chars)`);

  // 2. A virtualized row remounting as a new element with the same id adds nothing.
  await begin();
  before = chars();
  const old = rowById('r1');
  const twin = makeRow('r1', old.textContent);
  old.replaceWith(twin);
  await tick();
  assert(chars() === before, `Remounted row counted as agent output (${chars() - before} chars)`);
  // ...and its later growth still counts once.
  twin.textContent += ' streamed';
  await tick();
  assert(chars() === before + ' streamed'.length, `Growth after a remount counts exactly (${chars() - before})`);

  // 3. Rows above the last known row and rows followed by an end spacer
  // (more rows below the window) are baselines, even without a gesture.
  await begin();
  before = chars();
  rowById('r4').remove();
  rowById('r3').remove();
  items.prepend(makeRow('up0', `Scrolled up ${words(30)}`));
  await tick();
  items.append(makeRow('below', `Below the window ${words(25)}`), spacer());
  await tick();
  assert(chars() === before, `Rows mounted while scrolling without a gesture counted (${chars() - before})`);

  // 4. A far jump that replaces every known row has no anchor: baseline only.
  await begin();
  before = chars();
  items.replaceChildren(...[0, 1, 2].map(i => makeRow(`far${i}`, `Far away ${i} ${words(30)}`)));
  await tick();
  assert(chars() === before, `A far jump counted as agent output (${chars() - before})`);

  // 5. A new reply row appended after the known tail is output, with no gesture.
  await begin();
  before = chars();
  const reply = makeRow('reply', 'Fresh reply text');
  items.append(reply);
  await tick();
  assert(chars() === before + 'Fresh reply text'.length, `A new tail row earns first-mount credit (${chars() - before})`);

  // 6. During a wheel window, streaming into a known row still counts, but a
  // new tail row mounted inside the window (scrolling back down after starting
  // mid-history) only sets a baseline; its later growth counts.
  await begin();
  before = chars();
  wheel();
  rowById('r4').textContent += ' more';
  const tail = makeRow('tail', `Unseen tail ${words(30)}`);
  items.append(tail);
  await tick();
  assert(chars() === before + ' more'.length, `Wheel window: only the known row's growth counts (${chars() - before})`);
  tail.textContent += ' grown';
  await tick();
  assert(chars() === before + ' more'.length + ' grown'.length, `Wheel window: growth after the baseline counts (${chars() - before})`);

  // 7. Scroll events alone (bb's auto-follow) neither open nor extend the window.
  await tick(60);
  before = chars();
  wheel(); await tick(2);
  for (let i = 0; i < 60; i++) { scroller.dispatchEvent(new Event('scroll')); advance(1); }
  items.append(makeRow('after', 'After the window'));
  await tick();
  assert(chars() === before + 'After the window'.length, `Scroll events must not keep the gesture window open (${chars() - before})`);

  // 8. Scroll keys open the window; keys typed into an editor do not.
  await begin();
  before = chars();
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
  items.append(makeRow('key', `Paged in ${words(30)}`));
  await tick();
  assert(chars() === before, `Rows mounted after PageDown counted (${chars() - before})`);
  await tick(60);
  before = chars();
  document.querySelector('[contenteditable]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  items.append(makeRow('typed', 'Reply while editing'));
  await tick();
  assert(chars() === before + 'Reply while editing'.length, `Editor arrow keys must not open the window (${chars() - before})`);

  // 9. A scrollbar drag holds the window open until the pointer is released.
  await begin();
  before = chars();
  scroller.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  await tick(60);
  items.append(makeRow('drag', `Dragged in ${words(30)}`));
  await tick();
  assert(chars() === before, `Rows mounted during a scrollbar drag counted (${chars() - before})`);
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  await tick(60);
  items.append(makeRow('released', 'After release'));
  await tick();
  assert(chars() === before + 'After release'.length, `Credit resumes after the drag (${chars() - before})`);

  // 10. Each timeline list has its own tail: a second list later in the page
  // (a side chat) neither hides new replies here nor credits its own history.
  await begin();
  const side = document.createElement('div');
  side.dataset.timelineItems = '';
  document.body.append(side);
  before = chars();
  side.append(makeRow('s0', `Side chat history ${words(30)}`));
  await tick();
  assert(chars() === before, `Side list history counted (${chars() - before})`);
  items.append(makeRow('main-reply', 'Main reply'));
  await tick();
  assert(chars() === before + 'Main reply'.length, `A later list must not hide new replies (${chars() - before})`);
  side.remove(); await tick();

  T.syncAgentThreads(thread(false), 'a'); await tick(30);
  return { ok: true };
});
return result;
