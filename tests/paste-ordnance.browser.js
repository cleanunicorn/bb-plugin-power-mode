/* note: Paste ordnance (#8): tiers, caps, skins, paste capture and safety. */
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
  const debug = () => T.ordnanceDebug();
  const editor = document.querySelector('[contenteditable]');
  const field = document.querySelector('textarea.field');
  const line = document.querySelector('input.line');
  const terminal = document.querySelector('.xterm-helper-textarea');
  const selection = getSelection();
  const pixels = () => [...document.querySelectorAll('html > canvas')].map(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]) count++;
    return count;
  });
  const combo = () => Number(document.querySelector('.pm-hud-count').textContent);
  const bodyStill = () => document.body.style.position === '' && document.body.style.left === '' && document.body.style.top === '';
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
  const typeInto = (el, n) => {
    el.focus();
    for (let i = 0; i < n; i++) {
      el.value = (el.value ?? '') + 'a';
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'a' }));
    }
  };

  T.setOrdnanceRandom(() => 1); // no lucky drops unless a test asks for one
  T.updatePowerSettings({ sound: false, theme: 'neon', screenShake: true, lightning: true });
  settle();

  // ---- pickOrdnance / milestoneCrossed (pure)
  const table = [[10, 1], [100, 2], [400, 3], [1000, 4], [3000, 5], [10000, 6], [30000, 7], [100000, 8], [300000, 9]];
  for (const [chars, tier] of table) {
    const pick = T.pickOrdnance(chars, () => 1);
    assert(pick.tier === tier && !pick.lucky, `${chars} chars must be tier ${tier}, got ${pick.tier}`);
    assert(pick.combo === T.ORDNANCE_COMBO[tier - 1], 'Combo bump follows the tier');
    assert(pick.count >= 1, 'Every tier drops something');
  }
  for (const bad of [NaN, 0, -5, Infinity]) assert(T.pickOrdnance(bad, () => 1).tier === 1, `${bad} chars must be tier 1`);
  assert(T.pickOrdnance(10, () => 0).tier === 2 && T.pickOrdnance(10, () => 0).lucky, 'Lucky drop upgrades one tier');
  assert(T.pickOrdnance(10000, () => 0).tier === 7, 'Lucky drop may reach tier 7');
  assert(T.pickOrdnance(30000, () => 0).tier === 7, 'Lucky drop never upgrades into tier 8');
  assert(T.pickOrdnance(100000, () => 0).tier === 8, 'Lucky drop never upgrades into tier 9');
  assert(T.pickOrdnance(10, () => 0.5).tier === 1, 'Unlucky rolls keep the tier');
  assert(T.milestoneCrossed(20, 30).title === 'ON FIRE!', 'A jump past 25 counts');
  assert(T.milestoneCrossed(0, 100).title === 'GODLIKE!', 'The highest crossed milestone wins');
  assert(T.milestoneCrossed(740, 760).at === 750, '∞ POWER milestones are crossed too');
  assert(T.milestoneCrossed(5, 6) === null && T.milestoneCrossed(10, 10) === null, 'No milestone, no slam');

  // ---- length capture: textarea / input (data: null) and contenteditable
  paste(field, 20);
  assert(debug().lastTier === 1, `Short textarea paste drops a firecracker (tier ${debug().lastTier})`);
  const armed = debug().pending;
  assert(armed >= 4 && armed <= 6, 'Firecracker: 4–6 pops');
  // Staggered: detonations land on different frames, not all at once.
  let frames = 0;
  for (let i = 0; i < 60 && debug().pending > 0; i++) {
    const before = debug().pending;
    advance();
    if (debug().pending < before) frames++;
    assert(before - debug().pending < armed || armed === 1, 'All detonations fired on one frame');
  }
  assert(frames >= 3, `Detonations must be staggered (spread over ${frames} frames)`);
  assert(pixels().some(n => n > 0), 'Pops must draw');
  settle();
  for (const [chars, tier] of [[100, 2], [400, 3], [1000, 4], [3000, 5]]) {
    paste(tier % 2 ? field : line, chars);
    assert(debug().lastTier === tier, `${chars}-char paste must drop tier ${tier}, got ${debug().lastTier}`);
    settle();
  }
  editor.textContent = '';
  paste(editor, 400);
  assert(debug().lastTier === 3, 'Contenteditable paste reads the clipboard length');
  settle();
  // Contenteditable without a paste event: InputEvent.dataTransfer.
  editor.focus();
  editor.textContent += 'y'.repeat(1000);
  caretToEnd();
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: null, dataTransfer: clipboard('y'.repeat(1000)) }));
  assert(debug().lastTier === 4, 'Contenteditable falls back to InputEvent.dataTransfer');
  settle();
  // Drop follows the same path.
  field.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: clipboard('z'.repeat(400)) }));
  field.value = 'z'.repeat(400);
  field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromDrop', data: null }));
  assert(debug().lastTier === 3, 'Drops drop ordnance too');
  settle();

  // ---- editors that cancel the native paste fire exactly once
  T.setOrdnanceRandom(() => 1);
  const before = debug().lastArmed;
  editor.textContent = '';
  paste(editor, 100, { cancel: true });
  assert(debug().pending === 0, 'Nothing fires before the fallback runs');
  advance();
  assert(debug().lastTier === 2 && debug().pending > 0, 'A cancelled paste fires through the fallback');
  const pendingAfter = debug().pending;
  advance();
  assert(debug().pending <= pendingAfter, 'The fallback fires only once');
  settle();
  // Not cancelled and no input event (e.g. read-only): nothing.
  paste(line, 100, { input: false });
  advance(2);
  assert(debug().pending === 0, 'An uncancelled paste without input fires nothing');
  settle();
  // A stale slot can't fire on a later unrelated input.
  paste(field, 5000, { input: false });
  advance(2);
  typeInto(field, 1);
  assert(debug().pending === 0, 'Typing after an ignored paste drops nothing');
  settle();

  // ---- empty (image/file) pastes keep the plain burst
  paste(field, 0, { text: '' });
  assert(debug().pending === 0 && debug().ordnance === 0, 'Empty paste drops no ordnance');
  advance();
  assert(pixels().some(n => n > 0), 'Empty paste still bursts');
  settle();

  // ---- terminal paste stays inert
  terminal.focus({ preventScroll: true });
  terminal.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard('x'.repeat(5000)) }));
  terminal.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: null }));
  advance(2);
  assert(debug().pending === 0 && pixels().every(n => n === 0), 'Terminal paste must stay inert');
  settle();

  // ---- combo: a +10 paste at combo 20 triggers ON FIRE! exactly once
  typeInto(field, 20);
  assert(combo() === 20, `Typing counts 1 per key (${combo()})`);
  slams.length = 0;
  paste(field, 100);
  assert(combo() === 30, 'A tier-2 paste adds 10');
  advance(120);
  assert(slams.filter(s => s === 'ON FIRE!').length === 1, `ON FIRE! must slam once (${slams.join(', ')})`);
  settle();

  // ---- every theme × tier: its own slam title, pixels, clean canvases after
  const chars = [10, 100, 400, 1000, 3000, 10000, 30000, 100000, 300000];
  let combos = 0;
  for (const theme of ['neon', 'fire', 'matrix', 'sakura', 'cyberpunk', 'retro']) {
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

  // ---- theme switch mid-flight keeps the captured skin
  T.updatePowerSettings({ theme: 'neon' });
  settle();
  slams.length = 0;
  paste(field, 3000);
  advance(2);
  T.updatePowerSettings({ theme: 'retro' });
  advance(150);
  assert(slams.includes('LIGHT SHOW'), `Carpet bombing keeps the Neon skin (${slams.join(' | ')})`);
  settle();
  T.updatePowerSettings({ theme: 'neon' });
  settle();

  // ---- caps: ten rapid 300k pastes → one singularity, ≤ 24 pending
  const big = 'w'.repeat(300000);
  let singularities = 0;
  let maxPending = 0;
  const t0 = Date.now();
  for (let i = 0; i < 10; i++) {
    paste(field, 300000, { text: big });
    if (debug().lastTier === 9 && debug().lastArmed > 0) singularities++;
    maxPending = Math.max(maxPending, debug().pending);
    advance();
  }
  const pasteMs = Date.now() - t0;
  assert(singularities === 1, `Only one event at a time (${singularities} singularities)`);
  assert(maxPending <= 24, `At most 24 pending ordnance (${maxPending})`);
  for (let i = 0; i < 200; i++) {
    advance();
    assert(debug().particles <= debug().maxParticles, 'Particles stay bounded during a barrage');
    maxPending = Math.max(maxPending, debug().pending);
  }
  assert(maxPending <= 24, `At most 24 pending ordnance (${maxPending})`);
  settle();

  // ---- the singularity pulls live particles in
  typeInto(field, 30);
  advance(2);
  paste(field, 300000, { text: big });
  advance(3);
  const d0 = debug().pullDistance;
  advance(40);
  const d1 = debug().pullDistance;
  assert(d0 !== null && d1 !== null && d1 < d0, `Singularity must pull particles in (${d0} → ${d1})`);
  settle();

  // ---- lightning / screenShake / sound
  T.updatePowerSettings({ lightning: false, screenShake: false });
  settle();
  paste(field, 100000);
  let bolts = 0;
  for (let i = 0; i < 200; i++) {
    advance();
    bolts += debug().kinds.bolt ?? 0;
    assert(bodyStill(), 'screenShake: false keeps the body still');
  }
  assert(bolts === 0, 'lightning: false draws no bolts');
  T.updatePowerSettings({ lightning: true, screenShake: true });
  settle();
  paste(field, 100000);
  bolts = 0;
  for (let i = 0; i < 200; i++) { advance(); bolts += debug().kinds.bolt ?? 0; }
  assert(bolts > 0, 'The nuke strikes lightning when enabled');
  settle();
  assert(window.audioContexts === 0, 'No AudioContext while sound is off');

  // ---- disable mid-event, then re-enable inside the fuse window
  paste(field, 30000);
  advance(10);
  assert(debug().dimmed && debug().event, 'The meteor shower dims the edges');
  T.updatePowerSettings({ enabled: false });
  assert(pixels().every(n => n === 0), 'Disable clears the canvases');
  assert(!debug().dimmed && !debug().event && debug().pending === 0, 'Disable drops ordnance, dim and lock');
  assert(bodyStill(), 'Disable restores the body');
  advance(5);
  T.updatePowerSettings({ enabled: true });
  advance(100); // past every old impact; the power-on burst has faded by now
  assert(debug().particles === 0, `Stale detonations must not fire after re-enabling (${JSON.stringify(debug().kinds)})`);
  paste(field, 100000);
  assert(debug().lastTier === 8, 'The event lock was released by disable');
  settle();

  return { pickTable: true, staggered: frames, combos, singularities, maxPending, pasteMs10x300k: pasteMs };
});
await screenshot({ kind: 'proof' });
return result;
