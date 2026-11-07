/* note: Verify viewport layout, particle lifecycle and host animation preservation. */
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
await snapshot({ interactive: true });
await snapshot();
const result = await page.evaluate(async () => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const rect = el => {
    const r = el.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height];
  };
  const fixedLayout = () => JSON.stringify([
    rect(document.querySelector('.sidebar')), rect(document.querySelector('.terminal')),
  ]);
  const editor = document.querySelector('[contenteditable]');
  const selection = getSelection();
  const type = (text, inputType = 'insertText') => {
    editor.focus();
    editor.textContent += text;
    const range = document.createRange();
    range.setStart(editor.lastChild, editor.lastChild.textContent.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType }));
  };
  const pixels = () => [...document.querySelectorAll('html > canvas')].map(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]) count++;
    return count;
  });
  const baseline = fixedLayout();
  editor.style.translate = '30px 20px';
  type('a');
  advance();
  const translated = getComputedStyle(editor).translate.split(' ').map(parseFloat);
  assert(Math.abs(translated[0] - 30) <= 12 && Math.abs(translated[1] - 20) <= 12,
    'Editor shake must preserve its existing translation');
  assert(!document.querySelector('[data-power-mode-underlay]'), 'No canvases injected into editors');
  type('pasted', 'insertFromPaste');
  advance();
  assert(fixedLayout() === baseline, 'Screen shake moved a fixed panel');
  assert(pixels().some(n => n > 0), 'Typing must still draw particles');
  for (let i = 0; i < 60; i++) { type('x'); advance(); }
  assert(fixedLayout() === baseline, 'Sustained typing moved fixed panels');
  PowerTest.updatePowerSettings({ shake: false, screenShake: false });
  assert(editor.style.translate === '30px 20px', 'Shake setting must restore the editor immediately');
  assert(document.body.style.position === '' && document.body.style.left === '' && document.body.style.top === '',
    'Shake setting must restore body styles immediately');
  // Paint a uniform overlay for one frame so mask coverage can be measured
  // independently of random particle positions, on both particle and bloom canvases.
  editor.textContent = '';
  type('mask');
  const caretRange = selection.getRangeAt(0).cloneRange();
  caretRange.collapse(false);
  const caret = caretRange.getBoundingClientRect();
  const contexts = [...document.querySelectorAll('html > canvas')].map(canvas => canvas.getContext('2d'));
  const clears = contexts.map(context => context.clearRect);
  contexts.forEach(context => {
    context.clearRect = function (...args) {
      CanvasRenderingContext2D.prototype.clearRect.apply(this, args);
      this.save();
      this.setTransform(1, 0, 0, 1, 0, 0);
      this.globalAlpha = 1;
      this.globalCompositeOperation = 'source-over';
      this.fillStyle = '#fff';
      this.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.restore();
    };
  });
  advance();
  contexts.forEach((context, index) => {
    context.clearRect = clears[index];
    const scale = context.canvas.width / innerWidth;
    const alpha = (x, y) => context.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data[3];
    const x = caret.right, y = caret.top + caret.height / 2;
    const center = alpha(x, y), edge = alpha(x + 48, y);
    assert(center > 40 && center < 130, `Text protection must gently fade near the caret (canvas ${index}, alpha ${center}, caret ${x},${y}, size ${innerWidth},${innerHeight})`);
    assert(edge > center && edge < 255, 'Caret fade must have a soft edge');
    assert(alpha(x + 100, y) === 255 && alpha(x, y + 50) === 255,
      'Text protection must preserve effects elsewhere in the editor');
  });
  advance();
  for (const theme of ['neon', 'fire', 'matrix', 'sakura', 'cyberpunk', 'retro']) {
    PowerTest.updatePowerSettings({ theme, glow: 0.7 });
    type('theme'); advance(5);
    PowerTest.updatePowerSettings({ glow: 0 });
    assert(pixels().every(n => n === 0), 'Glow change must discard old pixels');
    PowerTest.updatePowerSettings({ glow: 1 });
    advance(300);
    assert(pixels().every(n => n === 0), 'Idle canvases must be completely transparent');
  }
  type('disable'); advance();
  PowerTest.updatePowerSettings({ enabled: false });
  assert(pixels().every(n => n === 0), 'Disable must clear particles immediately');
  PowerTest.updatePowerSettings({ enabled: true, shake: true, screenShake: false });
  advance(300);
  PowerTest.setAgentRunning(true);
  const row = document.querySelector('[data-timeline-row-id]');
  const rowBox = JSON.stringify(rect(row));
  row.textContent += ' streaming';
  await Promise.resolve(); // Deliver the streaming text mutation to the engine.
  advance(6); // Flush its 70 ms batching timer.
  advance();
  assert(pixels().some(n => n > 0), 'Agent output must still draw particles');
  assert(JSON.stringify(rect(row)) === rowBox, 'Agent output moved a virtualized row');
  PowerTest.setAgentRunning(false);
  PowerTest.updatePowerSettings({ screenShake: true });
  type('resize', 'insertFromPaste'); advance();
  return { fixedPanelsStable: true, editorTranslationPreserved: true, themesChecked: 6,
    agentRowStable: true, idleCanvasesClear: true, disableClearsImmediately: true,
    caretFadeSoftAndLocalized: true };
});
await screenshot({ kind: 'proof' });
await page.setViewportSize({ width: 1280, height: 800 });
await page.evaluate(() => {
  window.dispatchEvent(new Event('resize'));
  advance();
  const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
  const terminal = document.querySelector('.terminal').getBoundingClientRect();
  if (Math.abs(sidebar.top) > 0.1 || Math.abs(terminal.bottom - innerHeight) > 0.1)
    throw new Error('Resize during shake moved fixed panels');
  for (const canvas of document.querySelectorAll('html > canvas')) {
    if (Math.abs(canvas.getBoundingClientRect().width - innerWidth) > 0.1)
      throw new Error('Overlay no longer covers the viewport after resizing');
  }
  controller.abort();
  const editor = document.querySelector('[contenteditable]');
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  assert(document.querySelectorAll('html > canvas').length === 0, 'Dispose must remove all canvases');
  assert(editor.style.translate === '30px 20px', 'Dispose must preserve editor translation');
  assert(document.body.style.position === '' && document.body.style.left === '' && document.body.style.top === '',
    'Dispose must restore body styles');

});
await snapshot({ diff: true });
return { ...result, resizeStable: true, disposalRestoresStyles: true };
