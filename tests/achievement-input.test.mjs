import { test } from "node:test";
import assert from "node:assert/strict";
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
  dispose();
});
