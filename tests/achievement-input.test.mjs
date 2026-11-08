import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCollection,
  reduceCollection,
} from "../lib/achievement-rules.ts";
import { observeComposer, graphemes } from "../lib/achievement-input.ts";
test("trusted IME updates commit once; history and synthetic changes are not new typing", async () => {
  const handlers = new Map(),
    out = [];
  class Element {}
  class Textarea extends Element {
    value = "";
    selectionStart = 0;
    selectionEnd = 0;
    closest(selector) {
      if (selector === "[data-app-composer]") return root;
      if (selector === "[data-composer-box]") return box;
      if (selector.includes("textarea")) return this;
      return null;
    }
  }
  const el = new Textarea(),
    box = { contains: (target) => target === el, closest: () => root };
  const root = { querySelector: () => null, querySelectorAll: () => [box] };
  globalThis.Element = Element;
  globalThis.HTMLTextAreaElement = Textarea;
  globalThis.HTMLInputElement = class extends Element {};
  globalThis.document = {
    addEventListener: (name, fn) => handlers.set(name, fn),
  };
  const dispose = observeComposer(
    { key: "e", thread: "t", marker: { closest: () => root } },
    (e) => out.push(e),
  );
  const event = (name, data = {}) =>
    handlers.get(name)?.({
      target: el,
      isTrusted: true,
      inputType: "insertCompositionText",
      isComposing: false,
      ...data,
    });
  event("compositionstart");
  event("beforeinput", { isComposing: true });
  el.value = "🦆";
  event("input", { isComposing: true });
  event("compositionend", { data: "🦆" });
  await Promise.resolve();
  assert.equal(out.length, 1);
  assert.equal(out[0].inserted, 1);
  assert.equal(out[0].provenance, "ime");
  assert.equal(out[0].duck, true);
  event("beforeinput", { inputType: "insertText", data: "🦆" });
  event("input", { inputType: "insertText", data: "🦆" });
  assert.equal(out.length, 1);
  event("input", { inputType: "historyUndo" });
  assert.equal(out.at(-1).type, "history");
  event("keydown", { key: "a", repeat: false });
  event("beforeinput", {
    inputType: "insertText",
    data: "a",
    isTrusted: false,
  });
  el.value += "a";
  event("input", { inputType: "insertText", data: "a", isTrusted: false });
  assert.equal(out.at(-1).provenance, "unknown");
  assert.equal(graphemes("👨‍👩‍👧‍👦e\u0301").length, 2);
  // Native deletion must mark a draft boundary without losing submit handoffs.
  const state = createCollection();
  let seq = 0;
  const apply = (e) =>
    reduceCollection(state, {
      now: ++seq,
      wall: 1000 + seq,
      seq,
      theme: "neon",
      thread: "t",
      editor: "e",
      ...e,
    });
  const edit = (key, inputType, data, value) => {
    event("keydown", { key, repeat: false });
    event("beforeinput", { inputType, data });
    el.value = value;
    event("input", { inputType, data });
  };
  out.length = 0;
  el.value = "";
  edit("a", "insertText", "a", "a");
  apply({
    type: "edit",
    inserted: 100,
    removed: 0,
    from: 0,
    length: 100,
    provenance: "direct",
    duck: true,
  });
  out.length = 0;
  edit("Backspace", "deleteContentBackward", null, "");
  assert.equal(
    out.some((e) => e.type === "clear"),
    false,
  );
  edit("b", "insertText", "b", "b");
  assert.deepEqual(
    out.map((e) => e.type),
    ["edit", "clear", "edit"],
  );
  out.forEach(apply);
  assert.equal(state.draft.entered, 1);
  assert.equal(state.draft.duck, false);

  // Confirmed submission happens before the programmatic clear/fresh input.
  apply({
    type: "edit",
    inserted: 40,
    removed: 0,
    from: 1,
    length: 41,
    provenance: "direct",
  });
  apply({ type: "submit" });
  el.value = "";
  out.length = 0;
  edit("c", "insertText", "c", "c");
  out.forEach(apply);
  assert.equal(state.pending.t.entered, 41);
  assert.equal(state.draft.entered, 1);

  // Undo/redo restoring text is history, not fresh input or a new draft.
  out.length = 0;
  edit("Backspace", "deleteContentBackward", null, "");
  event("beforeinput", { inputType: "historyUndo" });
  el.value = "c";
  event("input", { inputType: "historyUndo" });
  edit("d", "insertText", "d", "cd");
  assert.equal(
    out.some((e) => e.type === "clear"),
    false,
  );
  dispose();
});
