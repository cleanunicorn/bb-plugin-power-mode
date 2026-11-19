/* note: IME composition counts the committed text once (Chrome, Firefox and Safari event orders); updates only drive effects. */
await page.goto('http://127.0.0.1:9146/power-engine.html');
const result = await page.evaluate(async () => {
  const T = PowerTest;
  T.updatePowerSettings({ enabled: true, sound: false, shake: false, screenShake: false, ghostLetters: true, intensity: 'epic' });
  T.resetPowerStats();
  const field = document.querySelector('textarea.field');
  const editor = document.querySelector('[contenteditable]');
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const tick = () => new Promise(resolve => setTimeout(resolve, 10));
  const stats = () => ({ ...T.getPowerStats() });
  const combo = () => Number(document.querySelector('.pm-hud-count').textContent);
  const hudWpm = () => document.querySelector('.pm-hud-wpm:not(.pm-hud-challenge)').textContent;
  const glyphs = () => T.ordnanceDebug().glyphs;
  const read = el => 'value' in el ? el.value : el.textContent;
  // Synthetic InputEvents do not edit the DOM, so each step writes the text first.
  const write = (el, value, selectFrom = value.length, selectTo = selectFrom) => {
    if ('value' in el) { el.value = value; el.setSelectionRange(selectFrom, selectTo); }
    else {
      el.textContent = value;
      const node = el.firstChild ?? el;
      const range = document.createRange();
      range.setStart(node, node === el ? 0 : selectFrom);
      range.setEnd(node, node === el ? 0 : selectTo);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    }
  };
  const input = (el, inputType, data, isComposing) => {
    el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType, data, isComposing }));
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data, isComposing }));
  };
  const composition = (el, type, data) => el.dispatchEvent(new CompositionEvent(type, { bubbles: true, data }));
  const STEPS = ['n', 'に', 'にh', 'にほ', 'にほn', 'にほん', 'にほんg', 'にほんご'];
  const WORD = 'にほんご';

  /** Replays one composition; `order` picks the browser's event sequence. */
  async function compose(el, { order = 'chrome', prefix = '', suffix = '', steps = STEPS, commit = WORD, onUpdate } = {}) {
    el.focus();
    write(el, prefix + suffix, prefix.length);
    composition(el, 'compositionstart', '');
    for (const step of steps) {
      composition(el, 'compositionupdate', step);
      write(el, prefix + step + suffix, prefix.length + step.length);
      input(el, 'insertCompositionText', step, true);
      onUpdate?.(step);
    }
    const final = prefix + commit + suffix;
    if (order === 'safari') {
      write(el, prefix + suffix, prefix.length);
      input(el, 'deleteCompositionText', null, true);
      write(el, final, prefix.length + commit.length);
      input(el, 'insertFromComposition', commit, true);
    }
    write(el, final, prefix.length + commit.length);
    composition(el, 'compositionend', commit);
    if (order === 'firefox') input(el, 'insertCompositionText', commit, false);
    await tick();
  }

  let checks = 0;

  // WPM and best WPM come from committed characters only (fresh window).
  {
    write(field, '');
    for (let i = 0; i < 3; i++) await compose(field, { prefix: read(field) });
    // 12 committed characters within the 3 s span floor: 12 / 5 / 0.05 min.
    assert(hudWpm() === '48 WPM', `WPM from commits only: got "${hudWpm()}"`);
    assert(T.getPowerStats().bestWpm === 0, 'Under 15 characters in the window sets no best WPM');
    await compose(field, { prefix: read(field) });
    assert(hudWpm() === '64 WPM', `WPM after 16 committed characters: got "${hudWpm()}"`);
    assert(T.getPowerStats().bestWpm === 64, `Commits totalling 15+ characters set best WPM, got ${T.getPowerStats().bestWpm}`);
    checks++;
  }

  for (const el of [field, editor]) {
    const name = el.tagName;
    for (const order of ['chrome', 'firefox', 'safari']) {
      const before = stats();
      const comboBefore = combo();
      let during = null;
      await compose(el, { order, onUpdate: () => { during = stats(); } });
      const after = stats();
      assert(during.chars === before.chars, `${name} ${order}: updates add 0 characters, got ${during.chars - before.chars}`);
      assert(after.chars - before.chars === 4, `${name} ${order}: commit adds 4, got ${after.chars - before.chars}`);
      assert(after.deletes === before.deletes, `${name} ${order}: no delete counted`);
      assert(combo() - comboBefore === STEPS.length, `${name} ${order}: combo rises once per update, got ${combo() - comboBefore}`);
      checks++;
    }

    // Cancelled composition: text returns to its base.
    {
      const before = stats().chars;
      el.focus();
      write(el, 'abc');
      composition(el, 'compositionstart', '');
      write(el, 'abcn');
      input(el, 'insertCompositionText', 'n', true);
      write(el, 'abc');
      input(el, 'insertCompositionText', '', true);
      composition(el, 'compositionend', '');
      await tick();
      assert(stats().chars === before, `${name}: cancelled composition adds 0`);
      checks++;
    }

    // Composing over a selection counts only the inserted span.
    {
      const before = stats().chars;
      el.focus();
      write(el, 'hello world', 6, 11); // "world" selected
      composition(el, 'compositionstart', '');
      write(el, 'hello に', 7);
      input(el, 'insertCompositionText', 'に', true);
      write(el, 'hello 日本', 8);
      input(el, 'insertCompositionText', '日本', true);
      composition(el, 'compositionend', '日本');
      await tick();
      assert(stats().chars - before === 2, `${name}: replacing a selection counts the inserted span, got ${stats().chars - before}`);
      checks++;
    }

    // Flying letters launch only the newly added character(s).
    {
      await new Promise(resolve => setTimeout(resolve, 1200)); // let earlier glyphs expire
      write(el, '');
      el.focus();
      composition(el, 'compositionstart', '');
      const launched = [];
      for (const step of STEPS) {
        const was = glyphs().length;
        write(el, step);
        input(el, 'insertCompositionText', step, true);
        launched.push([...new Set(glyphs().slice(was))].join(''));
      }
      write(el, WORD);
      composition(el, 'compositionend', WORD);
      await tick();
      const expected = ['n', 'に', 'h', 'ほ', 'n', 'ん', 'g', 'ご'];
      assert(JSON.stringify(launched) === JSON.stringify(expected), `${name}: glyphs ${JSON.stringify(launched)}`);
      checks++;
    }

    // Control: plain typing, paste and deletion are unchanged.
    {
      write(el, '');
      el.focus();
      const before = stats();
      write(el, 'ab');
      input(el, 'insertText', 'ab', false);
      write(el, 'abx');
      input(el, 'insertText', 'x', false);
      const text = 'pasted text';
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
      write(el, 'abx' + text);
      input(el, 'insertFromPaste', null, false);
      write(el, 'abx' + text.slice(0, -1));
      input(el, 'deleteContentBackward', null, false);
      await tick();
      const after = stats();
      assert(after.chars - before.chars === 3 + text.length, `${name}: control chars, got ${after.chars - before.chars}`);
      assert(after.pastes - before.pastes === 1, `${name}: control paste counted once`);
      assert(after.deletes - before.deletes === 1, `${name}: control delete counted once`);
      checks++;
    }
  }
  return { checks };
});
return result;
