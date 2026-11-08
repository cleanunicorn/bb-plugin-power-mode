/* note: Timeline expansion controls must not count as agent output (#24). */
await page.addInitScript(() => {
  let now = 10000, sequence = 0;
  const callbacks = new Map(), timers = new Map();
  Object.defineProperty(performance, 'now', { value: () => now });
  window.requestAnimationFrame = cb => (callbacks.set(++sequence, cb), sequence);
  window.cancelAnimationFrame = id => callbacks.delete(id);
  window.setTimeout = (cb, delay = 0) => (timers.set(++sequence, { cb, at: now + delay }), sequence);
  window.clearTimeout = id => timers.delete(id);
  window.advance = (count = 1) => {
    for (let i = 0; i < count; i++) {
      now += 16.67;
      const pending = [...callbacks.values()]; callbacks.clear();
      for (const cb of pending) cb(now);
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.cb(); }
    }
  };
});
await page.goto('http://127.0.0.1:9146/power-engine.html');
return await page.evaluate(async () => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const tick = async (n = 8) => { await Promise.resolve(); advance(n); await Promise.resolve(); };
  const row = document.querySelector('[data-timeline-row-id]');
  row.textContent = '';
  const content = document.createElement('span');
  content.textContent = 'Existing full text remains in the DOM while clamped';
  row.append(content);
  let expanded = false;
  let controlWrapper;
  const renderControl = () => {
    controlWrapper?.remove();
    const wrapper = document.createElement(expanded ? 'div' : 'span');
    controlWrapper = wrapper;
    const button = document.createElement('button');
    button.setAttribute('aria-expanded', String(expanded));
    button.textContent = expanded ? 'Show less' : 'Show more';
    button.onclick = () => { expanded = !expanded; renderControl(); };
    wrapper.append(button); row.append(wrapper);
  };
  renderControl();
  // BB's approval preview actually replaces the pre's text, unlike CSS clamp.
  const preview = document.createElement('div');
  preview.dataset.testid = 'command-preview';
  const pre = document.createElement('pre');
  const command = Array.from({ length: 12 }, (_, i) => `line${i} existing words`);
  const commandButton = document.createElement('button');
  let commandExpanded = false;
  const renderCommand = () => {
    pre.textContent = '$ ' + (commandExpanded ? command : command.slice(0, 4)).join('\n');
    commandButton.textContent = commandExpanded ? 'Show less' : 'Show 8 more lines';
  };
  commandButton.onclick = () => { commandExpanded = !commandExpanded; renderCommand(); };
  preview.append(pre, commandButton); row.append(preview); renderCommand();
  const otherRow = document.createElement('div');
  otherRow.dataset.timelineRowId = 'other';
  otherRow.textContent = 'Other row';
  row.parentElement.append(otherRow);
  const otherText = otherRow.firstChild;
  const otherButton = document.createElement('button');
  otherButton.textContent = 'Run';
  otherButton.onclick = () => { otherText.data += ' ordinary update'; };
  otherRow.append(otherButton);
  const slams = [];
  const append = document.documentElement.appendChild.bind(document.documentElement);
  document.documentElement.appendChild = el => { if (el.classList?.contains('pm-slam')) slams.push(el.textContent); return append(el); };
  PowerTest.resetPowerStats();
  PowerTest.updatePowerSettings({ enabled: true, agentMode: true, sound: false });
  advance(100);
  const thread = running => [{ id: 'a', title: 'Agent', running, idle: !running }];
  PowerTest.syncAgentThreads(thread(true), 'a');
  advance(30);
  const count = () => Number(document.querySelector('.pm-hud-count').textContent);
  const chars = () => PowerTest.getPowerStats().agentChars;
  const toggle = () => controlWrapper.querySelector('button').click();
  const stream = words => { content.textContent += ' ' + words; };
  stream('one two three'); await tick();
  assert(count() === 3, `Initial streaming counted: ${count()}`);
  const before = chars(), slamCount = slams.length;
  toggle(); await tick();
  assert(count() === 3 && chars() === before && slams.length === slamCount, 'Expansion leaves count, effects stats and milestones unchanged');
  stream('four five'); await tick();
  assert(count() === 5, 'Streaming while expanded counts');
  const after = chars();
  toggle(); await tick();
  assert(count() === 5 && chars() === after && slams.length === slamCount, 'Collapse leaves count, effects stats and milestones unchanged');
  stream('six'); toggle(); stream('seven eight'); await tick();
  assert(count() === 8, `Output interleaved with expansion counts: ${count()}`);
  toggle(); stream('nine'); await tick();
  assert(count() === 9, 'Output interleaved with collapse counts');
  const previewChars = chars(), previewSlams = slams.length;
  commandButton.click(); await tick();
  assert(count() === 9 && chars() === previewChars && slams.length === previewSlams, 'Command expansion does not count revealed lines');
  commandButton.click(); await tick();
  assert(count() === 9 && chars() === previewChars && slams.length === previewSlams, 'Command collapse does not subtract hidden lines');
  stream('ten'); commandButton.click(); stream('eleven'); await tick();
  assert(count() === 11, 'Streaming interleaved with command expansion counts');
  stream('twelve'); commandButton.click(); stream('thirteen'); await tick();
  assert(count() === 13, 'Streaming interleaved with command collapse counts');
  command[0] += ' fourteen'; renderCommand(); await tick();
  assert(count() === 14, 'Changes to the visible command prefix still count');
  commandButton.click(); otherButton.click(); await tick();
  assert(count() === 16, 'Other rows and unrelated controls still count output during a toggle');
  PowerTest.syncAgentThreads(thread(false), 'a'); await tick();
  assert(PowerTest.getPowerStats().bestAgentWords === 16, 'Turn statistics contain only streamed words');
  return { ok: true };
});
