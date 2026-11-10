/* note: Count pasted and bulk-inserted text once, without typing-speed credit. */
await page.goto('http://127.0.0.1:9146/power-engine.html');
const result = await page.evaluate(async () => {
  const T = PowerTest;
  T.updatePowerSettings({ sound: false, shake: false, screenShake: false });
  const field = document.querySelector('textarea.field');
  const editor = document.querySelector('[contenteditable]');
  const terminal = document.querySelector('.xterm-helper-textarea');
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const text = 'A dictated sentence with several words. '.repeat(30);
  const read = el => 'value' in el ? el.value : el.textContent;
  const write = (el, value) => {
    if ('value' in el) { el.value = value; el.setSelectionRange(value.length, value.length); }
    else {
      el.textContent = value;
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    }
  };
  const insert = (el, { type = 'insertFromPaste', data = null, clipboard = false, cancel = false, input = true, beforeinput = true } = {}) => {
    el.focus();
    if (clipboard) {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      if (cancel) el.addEventListener('paste', e => e.preventDefault(), { once: true });
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    }
    if (input && beforeinput) el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: type, data }));
    write(el, read(el) + text);
    if (input) el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: type, data }));
  };
  let checks = 0;
  for (const el of [field, editor]) {
    for (const options of [
      { clipboard: true },
      {}, // OS paste with no ClipboardEvent and null input data
      { type: 'insertFromDrop' },
      { type: 'insertText' }, // dictation/accessibility bulk insertion, null data
      { type: 'insertText', beforeinput: false },
      { type: 'insertText', data: text },
      { type: 'insertReplacementText' },
      { type: 'insertReplacementText', data: text },
      { clipboard: true, cancel: true, input: false },
      { clipboard: true, cancel: true, type: 'insertText', data: text },
    ]) {
      const before = { ...T.getPowerStats() };
      insert(el, options);
      // Allow the cancelled-paste fallback to run.
      await new Promise(resolve => setTimeout(resolve, 10));
      const after = T.getPowerStats();
      assert(after.chars - before.chars === text.length,
        `${el.tagName} ${JSON.stringify(options)}: expected ${text.length} characters, got ${after.chars - before.chars}`);
      const pasted = options.clipboard || !options.type || options.type === 'insertFromDrop';
      assert(after.pastes - before.pastes === (pasted ? 1 : 0), 'Paste counted exactly once');
      assert(after.bestWpm === before.bestWpm, 'Bulk insertion cannot set a typing speed record');
      checks++;
    }
  }
  const before = T.getPowerStats().chars;
  insert(terminal, { clipboard: true });
  assert(T.getPowerStats().chars === before, 'Terminal input stays excluded');
  field.focus();
  field.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'historyRedo' }));
  write(field, read(field) + text);
  field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'historyRedo' }));
  assert(T.getPowerStats().chars === before, 'History stays excluded');
  // A null-data replacement can shrink the draft while inserting new text.
  write(field, 'before OLD TEXT after');
  field.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertReplacementText' }));
  write(field, 'before new after');
  field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
  assert(T.getPowerStats().chars === before + 3, 'Count inserted span, not net draft growth');
  field.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: 'x' }));
  write(field, read(field) + 'x');
  field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'x' }));
  assert(T.getPowerStats().chars === before + 4, 'Ordinary typing still counts');
  field.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'deleteContentBackward' }));
  write(field, read(field).slice(0, -1));
  field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
  assert(T.getPowerStats().chars === before + 4, 'Deletion does not add characters');
  editor.focus();
  editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertParagraph' }));
  editor.appendChild(document.createElement('br'));
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertParagraph' }));
  assert(T.getPowerStats().chars === before + 5, 'Paragraph input still counts a newline');
  return { checks };
});
return result;
