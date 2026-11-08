import type { AchievementEvent } from "./achievement-rules";
export type InputObservation = Partial<AchievementEvent> &
  Pick<AchievementEvent, "type">;
export interface ComposerBinding {
  key: string;
  thread: string | null;
  marker: HTMLElement;
}
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export const graphemes = (text: string) =>
  Array.from(segmenter.segment(text), (x) => x.segment);
const textOf = (el: HTMLElement) =>
  el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement
    ? el.value
    : (el.textContent ?? "");
/** Verified BB layout boundary; no route, text matching or guessed thread identity. */
export function composerEditor(
  binding: ComposerBinding,
  target: Element,
): HTMLElement | null {
  const root = binding.marker.closest("[data-app-composer]");
  if (!root || target.closest("[data-app-composer]") !== root) return null;
  const box = target.closest("[data-composer-box]");
  if (!box) return null;
  const anchor = root.querySelector("[data-follow-up-composer-anchor]");
  if (anchor && !anchor.contains(box)) return null; // queued editors do not borrow the main composer
  const boxes = Array.from(
    (anchor ?? root).querySelectorAll("[data-composer-box]"),
  ).filter((b) => b.closest("[data-app-composer]") === root);
  if (boxes.length !== 1 || boxes[0] !== box) return null;
  const editor = target.closest<HTMLElement>(
    'textarea, input[type="text"], input:not([type]), [contenteditable="true"]',
  );
  if (
    !editor ||
    !box.contains(editor) ||
    editor.closest(".xterm, [data-terminal]")
  )
    return null;
  return editor;
}
export function observeComposer(
  binding: ComposerBinding,
  emit: (event: InputObservation) => void,
): () => void {
  const controller = new AbortController(),
    options = { capture: true, signal: controller.signal };
  let key:
    | { value: string; repeat: boolean; at: number; target: EventTarget | null }
    | undefined;
  let before:
    | {
        text: string;
        editor: HTMLElement;
        type: string;
        data: string | null;
        direct: boolean;
        range?: [number, number];
      }
    | undefined;
  let composing = false,
    compositionCommit: string | null = null,
    compositionBase: string | null = null;
  let lastEditor: HTMLElement | null = null,
    lastLength = 0;
  const resolve = (target: EventTarget | null) =>
    target instanceof Element ? composerEditor(binding, target) : null;
  const send = (
    type: AchievementEvent["type"],
    patch: Partial<AchievementEvent> = {},
  ) => emit({ type, editor: binding.key, thread: binding.thread, ...patch });
  document.addEventListener(
    "focusin",
    (event) => {
      const target = event.target;
      if (
        lastEditor &&
        target instanceof Element &&
        target !== lastEditor &&
        target.closest('textarea, input, [contenteditable="true"]')
      ) {
        send("context");
        before = undefined;
        key = undefined;
        compositionBase = null;
        compositionCommit = null;
      }
    },
    options,
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (resolve(e.target))
        key = {
          value: e.key,
          repeat: e.repeat,
          at: performance.now(),
          target: e.target,
        };
    },
    options,
  );
  document.addEventListener(
    "compositionstart",
    (e) => {
      const el = resolve(e.target);
      if (el && e.isTrusted) {
        composing = true;
        compositionCommit = null;
        compositionBase = textOf(el);
      }
    },
    options,
  );
  document.addEventListener(
    "compositionend",
    (e) => {
      const el = resolve(e.target);
      if (!el || !e.isTrusted) return;
      composing = false;
      compositionCommit = e.data;
      queueMicrotask(() => {
        if (
          controller.signal.aborted ||
          compositionBase === null ||
          compositionCommit === null
        )
          return;
        const a = graphemes(compositionBase),
          b = graphemes(textOf(el));
        let from = 0,
          endA = a.length,
          endB = b.length;
        while (from < endA && from < endB && a[from] === b[from]) from++;
        while (endA > from && endB > from && a[endA - 1] === b[endB - 1]) {
          endA--;
          endB--;
        }
        if (endA !== from || endB !== from)
          send("edit", {
            inserted: endB - from,
            removed: endA - from,
            from,
            length: b.length,
            provenance: "ime",
            duck: b.slice(from, endB).join("").includes("🦆"),
          });
        lastLength = textOf(el).length;
        compositionBase = null;
        compositionCommit = null;
      });
    },
    options,
  );
  document.addEventListener(
    "beforeinput",
    (event) => {
      const e = event as InputEvent,
        el = resolve(e.target);
      if (!el) return;
      if (lastEditor && lastEditor !== el) send("context");
      lastEditor = el;
      const text = textOf(el);
      if (text.length > 100_000) {
        before = undefined;
        send("context");
        return;
      }
      if (text.length === 0 && lastLength > 0 && !composing) send("clear");
      const direct =
        e.isTrusted &&
        !!key &&
        !key.repeat &&
        key.target === e.target &&
        performance.now() - key.at < 1000 &&
        ((e.inputType === "insertText" &&
          e.data === key.value &&
          graphemes(e.data ?? "").length === 1) ||
          (e.inputType === "insertParagraph" && key.value === "Enter") ||
          (e.inputType.startsWith("delete") &&
            ["Backspace", "Delete"].includes(key.value)));
      let range: [number, number] | undefined;
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        if (
          el.selectionStart !== null &&
          el.selectionEnd !== null &&
          el.selectionStart !== el.selectionEnd
        )
          range = [
            graphemes(text.slice(0, el.selectionStart)).length,
            graphemes(text.slice(0, el.selectionEnd)).length,
          ];
      } else {
        const selected = e.getTargetRanges?.()[0];
        if (
          selected &&
          el.contains(selected.startContainer) &&
          el.contains(selected.endContainer)
        ) {
          const prefix = document.createRange();
          prefix.selectNodeContents(el);
          prefix.setEnd(selected.startContainer, selected.startOffset);
          const end = document.createRange();
          end.selectNodeContents(el);
          end.setEnd(selected.endContainer, selected.endOffset);
          range = [
            graphemes(prefix.toString()).length,
            graphemes(end.toString()).length,
          ];
        }
      }
      before = {
        text,
        editor: el,
        type: e.inputType,
        data: e.data,
        direct,
        range,
      };
      key = undefined;
    },
    options,
  );
  document.addEventListener(
    "input",
    (event) => {
      const e = event as InputEvent,
        el = resolve(e.target);
      if (!el) return;
      const old = before;
      before = undefined;
      if (e.isComposing || composing) return;
      if (e.inputType === "historyUndo" || e.inputType === "historyRedo") {
        if (e.isTrusted)
          send("history", {
            history: e.inputType === "historyUndo" ? "undo" : "redo",
          });
        lastLength = textOf(el).length;
        return;
      }
      const current = textOf(el);
      const ime =
        e.isTrusted && compositionCommit !== null && compositionBase !== null;
      const previous = ime ? compositionBase : old?.text;
      if (
        previous === undefined ||
        previous === null ||
        (!ime && old?.editor !== el) ||
        current.length > 100_000
      ) {
        send("context");
        lastLength = current.length;
        return;
      }
      if (current === previous) {
        compositionBase = null;
        compositionCommit = null;
        return;
      }
      const a = graphemes(previous),
        b = graphemes(current);
      let from = 0,
        endA = a.length,
        endB = b.length;
      while (from < endA && from < endB && a[from] === b[from]) from++;
      while (endA > from && endB > from && a[endA - 1] === b[endB - 1]) {
        endA--;
        endB--;
      }
      if (!ime && old?.range) {
        const [start, end] = old.range,
          newEnd = b.length - (a.length - end);
        if (
          newEnd < start ||
          a.slice(0, start).join("") !== b.slice(0, start).join("") ||
          a.slice(end).join("") !== b.slice(newEnd).join("")
        ) {
          send("context");
          return;
        }
        from = start;
        endA = end;
        endB = newEnd;
      }
      const data = b.slice(from, endB).join("");
      const provenance = ime
        ? "ime"
        : old?.direct && e.isTrusted
          ? "direct"
          : /Paste|Drop/.test(e.inputType)
            ? "paste"
            : "unknown";
      send("edit", {
        inserted: endB - from,
        removed: endA - from,
        from,
        length: b.length,
        provenance,
        duck:
          (provenance === "direct" || provenance === "ime") &&
          data.includes("🦆"),
      });
      compositionCommit = null;
      compositionBase = null;
      lastLength = current.length;
    },
    options,
  );
  return () => {
    controller.abort();
    before = undefined;
    compositionBase = null;
    compositionCommit = null;
  };
}
