/* note: Paste ordnance (#8): theme × tier sweep, part B (sakura, cyberpunk, retro). */
// Run against tests/power-engine.html served on port 9146 (see tests/README.md).
// Split from paste-ordnance.browser.js to stay well under BetterWright's 30 s
// per-snippet limit; the harness and helpers below are copies of that fixture's.
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
  const debug = () => T.ordnanceDebug();
  const editor = document.querySelector('[contenteditable]');
  const field = document.querySelector('textarea.field');
  const selection = getSelection();
  const pixels = () => [...document.querySelectorAll('html > canvas')].map(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]) count++;
    return count;
  });
  const combo = () => Number(document.querySelector('.pm-hud-count').textContent);
  // Record every slam title as it is added.
  const slams = [];
  const root = document.documentElement;
  const append = root.appendChild.bind(root);
  root.appendChild = el => {
    if (el.classList && el.classList.contains('pm-slam')) slams.push(el.firstChild.textContent);
    return append(el);
  };
  // Long enough for the combo to time out (3 s) and any event (≤ 3 s) to end.
  const settle = () => advance(260);
  const caretToEnd = () => {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  const clipboard = text => { const dt = new DataTransfer(); dt.setData('text/plain', text); return dt; };
  /** Paste `chars` characters: paste event, then the browser's input event (data: null in fields). */
  const paste = (el, chars, { cancel = false, input = true, text } = {}) => {
    const value = text ?? 'x'.repeat(chars);
    el.focus();
    if (cancel) el.addEventListener('paste', e => e.preventDefault(), { once: true });
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard(value) }));
    if (cancel) { if (el === editor) { editor.textContent += value; caretToEnd(); } return; }
    if (!input) return;
    if (el === editor) { editor.textContent += value; caretToEnd(); }
    else { el.value = value; el.setSelectionRange(value.length, value.length); }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: null }));
  };

  T.setOrdnanceRandom(() => 1); // no lucky drops
  T.updatePowerSettings({ sound: false, theme: 'neon', screenShake: true, lightning: true });
  settle();

  // ---- every theme × tier (this fixture's themes): its own slam title, pixels, clean canvases after
  const chars = [10, 100, 400, 1000, 3000, 10000, 30000, 100000, 300000];
  let combos = 0;
  for (const theme of ['sakura', 'cyberpunk', 'retro']) {
    T.updatePowerSettings({ theme });
    settle();
    for (let tier = 1; tier <= 9; tier++) {
      slams.length = 0;
      const prev = combo();
      paste(field, chars[tier - 1], { text: 'q'.repeat(chars[tier - 1]) });
      assert(debug().lastTier === tier, `${theme} tier ${tier} picked ${debug().lastTier}`);
      assert(debug().lastArmed <= 16, `${theme} tier ${tier} armed ${debug().lastArmed} timers (cap 16)`);
      const milestone = T.milestoneCrossed(prev, combo());
      let drew = false;
      for (let i = 0; i < 200 && (debug().pending > 0 || !drew); i++) {
        advance();
        if (!drew && i % 10 === 5) drew = pixels().some(n => n > 0);
        assert(debug().particles <= debug().maxParticles, 'Particles stay within maxParticles()');
      }
      assert(drew, `${theme} tier ${tier} must draw`);
      const expected = T.ORDNANCE_SKINS[theme].titles[tier - 1];
      assert(slams.some(s => s && s === expected) || (milestone && tier <= 2),
        `${theme} tier ${tier} must slam "${expected}" (got ${slams.join(' | ')})`);
      settle();
      assert(pixels().every(n => n === 0), `${theme} tier ${tier}: canvases must clear after idling`);
      assert(!debug().dimmed && !debug().event, 'Events release the dim and the lock');
      combos++;
    }
  }

  assert(window.audioContexts === 0, 'No AudioContext while sound is off');
  return { themes: ['sakura', 'cyberpunk', 'retro'], combos };
});
await screenshot({ kind: 'proof' });
return result;
