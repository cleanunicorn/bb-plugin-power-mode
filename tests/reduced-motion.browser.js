/* note: Reduced motion (#13): OS preference, explicit override, no shake or flash. */
// Run against tests/power-engine.html served on port 9146 (see tests/README.md).
await page.addInitScript(() => {
  // Controllable prefers-reduced-motion: window.setOsReduced(true) fires `change`.
  let osReduced = false;
  const mqls = new Set();
  window.matchMedia = query => {
    const listeners = new Set();
    const mql = {
      media: query,
      get matches() { return /prefers-reduced-motion:\s*reduce/.test(query) && osReduced; },
      addEventListener: (type, fn, opts) => {
        if (type !== 'change') return;
        listeners.add(fn);
        if (opts && opts.signal) opts.signal.addEventListener('abort', () => listeners.delete(fn));
      },
      removeEventListener: (type, fn) => listeners.delete(fn),
      fire: () => { for (const fn of [...listeners]) fn({ matches: mql.matches, media: query }); },
    };
    mqls.add(mql);
    return mql;
  };
  window.setOsReduced = value => { osReduced = value; for (const m of mqls) m.fire(); };
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
  const editor = document.querySelector('[contenteditable]');
  const field = document.querySelector('textarea.field');
  const selection = getSelection();
  const root = document.documentElement;
  // Count flashes (and big ones) as they are added.
  const seen = { flash: 0, big: 0 };
  const append = root.appendChild.bind(root);
  root.appendChild = el => {
    if (el.classList && el.classList.contains('pm-flash')) { seen.flash++; if (el.classList.contains('pm-big')) seen.big++; }
    return append(el);
  };
  const clipboard = text => { const dt = new DataTransfer(); dt.setData('text/plain', text); return dt; };
  const paste = (el, chars) => {
    const value = 'x'.repeat(chars);
    el.focus();
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard(value) }));
    el.value = value; el.setSelectionRange(value.length, value.length);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: null }));
  };
  const type = (el, n) => {
    el.focus();
    for (let i = 0; i < n; i++) {
      el.value = (el.value ?? '') + 'a';
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'a' }));
    }
  };
  // Run `fn`, advancing frames, and report whether anything moved or flashed.
  const watch = (fn, frames = 200) => {
    seen.flash = 0; seen.big = 0;
    let moved = false;
    const probe = () => {
      const b = document.body.style;
      if (b.left !== '' || b.top !== '' || b.position !== '') moved = true;
      if (editor.style.translate !== '' || field.style.translate !== '') moved = true;
    };
    fn(); probe();
    for (let i = 0; i < frames; i++) { advance(); probe(); }
    advance(260);
    return { moved, flash: seen.flash, big: seen.big };
  };
  const calm = r => !r.moved && r.flash === 0;
  const base = { enabled: true, intensity: 'godlike', shake: true, screenShake: true, lightning: true, sound: false, protectText: false, theme: 'neon' };
  const tiers = [[30000, 7], [100000, 8], [300000, 9]];
  const bodyStill = () => document.body.style.position === '' && document.body.style.left === '' && document.body.style.top === '';

  T.setOrdnanceRandom(() => 1);
  advance(260);

  // ---- parse / precedence (store)
  assert(T.getPowerSettings().reduceMotion === null, 'Settings without the field follow the OS (null)');
  assert(T.DEFAULT_SETTINGS.reduceMotion === null, 'Default is null');
  assert(T.getSystemReducedMotion() === false && T.getReducedMotion() === false, 'OS off: effective off');

  // ---- baseline: OS off, motion on. Shake and flash happen (current behavior).
  T.updatePowerSettings(base);
  advance(260);
  let r = watch(() => paste(field, 100000));
  assert(r.moved, 'Baseline: tier 8 paste shakes the screen');
  assert(r.flash > 0, 'Baseline: tier 8 paste flashes');
  r = watch(() => paste(field, 30000));
  assert(r.big > 0, 'Baseline: tier 7 paste white-out flash (pm-big)');
  r = watch(() => type(field, 60));
  assert(r.moved, 'Baseline: typing shakes the editor');
  assert(bodyStill(), 'Body restored after baseline');

  // ---- OS flips on: follows OS (no override), all motion gone
  setOsReduced(true);
  assert(T.getSystemReducedMotion() && T.getReducedMotion(), 'OS on: effective on');
  assert(T.getPowerSettings().reduceMotion === null, 'OS flip does not write an override');
  for (const [chars, tier] of tiers) {
    r = watch(() => paste(field, chars));
    assert(calm(r), `Tier ${tier} paste with reduced motion: moved=${r.moved} flashes=${r.flash} big=${r.big}`);
  }
  r = watch(() => { field.value = ''; type(field, 110); });
  assert(calm(r), `Typing through combo milestones with reduced motion: moved=${r.moved} flashes=${r.flash}`);
  assert(bodyStill(), 'Body untouched under reduced motion');
  // Power-on slam path (disable then enable) must not shake either.
  r = watch(() => { T.updatePowerSettings({ enabled: false }); advance(5); T.updatePowerSettings({ enabled: true }); });
  assert(calm(r), 'Power-on under reduced motion does not shake or flash');

  // ---- an OS flip mid-event releases shakes/flashes immediately
  setOsReduced(false);
  paste(field, 300000);
  advance(5);
  assert(seen.big > 0 || document.querySelector('.pm-flash'), 'Mid-event setup: ordnance running with motion on');
  type(field, 3);
  setOsReduced(true);
  assert(bodyStill() && editor.style.translate === '' && field.style.translate === '', 'OS flip mid-event releases shake offsets');
  assert(!document.querySelector('.pm-flash'), 'OS flip mid-event removes live flashes');
  advance(300);

  // ---- explicit override false beats OS true; persisted across OS changes and reload
  T.updatePowerSettings({ reduceMotion: false });
  assert(T.getReducedMotion() === false, 'Explicit false wins over OS true');
  r = watch(() => paste(field, 100000));
  assert(r.moved && r.flash > 0, 'Turning reduce motion off restores shake and flash');
  setOsReduced(false); setOsReduced(true);
  assert(T.getReducedMotion() === false, 'Override survives OS changes');
  const saved = JSON.parse(localStorage.getItem('bb-plugin-power-mode:power-mode:settings'));
  assert(saved.reduceMotion === false, 'Override persisted');

  // ---- explicit override true beats OS false
  setOsReduced(false);
  T.updatePowerSettings({ reduceMotion: true });
  assert(T.getReducedMotion() === true, 'Explicit true wins over OS false');
  for (const [chars, tier] of tiers) {
    r = watch(() => paste(field, chars));
    assert(calm(r), `Override true, tier ${tier}: moved=${r.moved} flashes=${r.flash}`);
  }
  // Editor-level shake toggle off + reduced stays calm; back to null follows OS (off => motion).
  T.updatePowerSettings({ reduceMotion: null });
  assert(T.getReducedMotion() === false, 'null follows the OS again');
  r = watch(() => paste(field, 100000));
  assert(r.moved && r.flash > 0, 'Following the OS (off) restores effects');

  // ---- legacy / untrusted persisted values parse to null
  for (const raw of ['{"enabled":true}', '{"reduceMotion":"yes"}', '{"reduceMotion":1}']) {
    localStorage.setItem('bb-plugin-power-mode:power-mode:settings', raw);
    window.dispatchEvent(new StorageEvent('storage', { key: 'bb-plugin-power-mode:power-mode:settings', newValue: raw }));
    assert(T.getPowerSettings().reduceMotion === null, `${raw} follows the OS`);
  }
  window.dispatchEvent(new StorageEvent('storage', { key: 'bb-plugin-power-mode:power-mode:settings', newValue: '{"enabled":true,"reduceMotion":true}' }));
  assert(T.getPowerSettings().reduceMotion === true && T.getReducedMotion(), 'Stored true is read back');

  // ---- dispose removes the OS listener (no leak, no throw on later flips)
  controller.abort();
  setOsReduced(false);
  return 'ok';
});
console.log(result);
