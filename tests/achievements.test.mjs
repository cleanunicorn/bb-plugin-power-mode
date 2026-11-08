import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCollection,
  reduceCollection,
  CATALOG,
  parseCollection,
  progress,
  publicCard,
} from "../lib/achievement-rules.ts";
const base = {
  now: 0,
  wall: Date.UTC(2026, 0, 1, 12),
  editor: "e",
  thread: "t",
  theme: "neon",
  quiet: false,
  silent: false,
};
const exercised = new Set();
function harness(saved) {
  const state = createCollection(saved);
  let serial = 0,
    now = 0;
  const send = (type, patch = {}) => {
    now = patch.now ?? now;
    const earned = reduceCollection(state, {
      ...base,
      now,
      wall: base.wall + now,
      seq: ++serial,
      type,
      ...patch,
    });
    for (const id of earned) exercised.add(id);
    return earned;
  };
  const input = (count = 1, patch = {}) =>
    send("edit", {
      inserted: count,
      removed: 0,
      from: 0,
      length: count,
      provenance: "direct",
      ...patch,
    });
  const reply = (words = 20, patch = {}) => {
    const turn = `r${++serial}`;
    send("start", { turn, ...patch });
    send("complete", {
      turn,
      words,
      status: "completed",
      fresh: true,
      ...patch,
    });
  };
  return {
    state,
    send,
    input,
    reply,
    has: (id) => Object.hasOwn(state.saved.unlocked, id),
  };
}
test("catalog has all 32 stable additions and hides every locked secret", () => {
  assert.equal(CATALOG.length, 32);
  assert.equal(new Set(CATALOG.map((x) => x.id)).size, 32);
  for (const a of CATALOG.filter((x) => x.hidden)) {
    const c = publicCard(a, {});
    assert.equal(c.title, "Undiscovered");
    assert.ok(!JSON.stringify(c).includes(a.title));
  }
});
test("six biomes requires entered characters, validates saved counters", () => {
  const h = harness();
  for (const theme of [
    "neon",
    "fire",
    "matrix",
    "sakura",
    "cyberpunk",
    "retro",
  ])
    h.input(99, { theme, provenance: "ime" });
  assert.equal(h.has("six-biomes"), false);
  h.input(100, { theme: "retro", provenance: "paste" });
  assert.equal(h.has("six-biomes"), false);
  for (const theme of [
    "neon",
    "fire",
    "matrix",
    "sakura",
    "cyberpunk",
    "retro",
  ])
    h.input(1, { theme, provenance: "ime" });
  assert.ok(h.has("six-biomes"));
  assert.equal(progress("six-biomes", h.state).value, 6);
  assert.equal(
    parseCollection({ best: Infinity, biomes: { neon: -1 } }).best,
    0,
  );
});
test("complete reply requires start, success, new output and deduplicates", () => {
  const h = harness();
  h.send("complete", {
    turn: "old",
    words: 30,
    status: "completed",
    fresh: true,
  });
  assert.equal(h.has("hello-copilot"), false);
  for (const status of ["failed", "interrupted", "unknown"]) {
    h.send("start", { turn: status });
    h.send("complete", { turn: status, status, words: 30, fresh: true });
  }
  assert.equal(h.has("hello-copilot"), false);
  h.reply(20);
  assert.ok(h.has("hello-copilot"));
  assert.ok(h.has("bento-box"));
  const n = h.state.saved.replies;
  h.send("complete", {
    turn: "old",
    words: 30,
    status: "completed",
    fresh: true,
  });
  assert.equal(h.state.saved.replies, n);
});
test("submit then clear preserves one pending handoff; settings cannot supply it", () => {
  const h = harness();
  h.input(40, { thread: null });
  h.reply();
  assert.equal(h.has("pass-baton"), false);
  h.input(40);
  h.send("submit");
  h.send("clear");
  h.reply();
  assert.ok(h.has("pass-baton"));
  assert.equal(h.state.session.rallies.t, 1);
  h.reply();
  assert.equal(h.state.session.rallies.t, 1);
});
function windowOf(h, start, chars, patch = {}) {
  for (let i = 0; i < chars; i++)
    h.input(1, { now: start + (i * 29_000) / chars, ...patch });
  h.send("tick", { now: start + 30_000, ...patch });
}
test("speed uses complete half-open windows, direct provenance, and idle tails", () => {
  for (const chars of [99, 100, 199, 200]) {
    const h = harness();
    windowOf(h, 0, chars);
    assert.equal(h.has("cruise-control"), chars >= 100);
    assert.equal(h.has("afterburner"), chars >= 200);
    assert.equal(h.state.saved.best, chars >= 100 ? chars / 2.5 : 0);
  }
  for (const provenance of ["ime", "paste", "unknown"]) {
    const h = harness();
    windowOf(h, 0, 200, { provenance });
    assert.equal(h.has("cruise-control"), false);
  }
  const h = harness();
  h.input(200);
  h.send("tick", { now: 30_000 });
  assert.equal(h.has("afterburner"), false);
  const g = harness();
  for (let n = 0; n < 6; n++) g.input(20, { now: n * 5000 });
  g.send("tick", { now: 30000 });
  assert.ok(g.has("cruise-control"));
  const x = harness();
  for (let n = 0; n < 6; n++) x.input(20, { now: n * 5001 });
  x.send("tick", { now: 30000 });
  assert.equal(x.has("cruise-control"), false);
});
test("personal improvement, stairs, rhythm and themed windows", () => {
  const h = harness();
  [100, 113, 126, 139].forEach((n, i) =>
    windowOf(h, i * 30000, n, { theme: "sakura" }),
  );
  assert.ok(h.has("ghost-chaser"));
  assert.ok(h.has("stairway-flow"));
  assert.ok(h.has("pocket-drummer"));
  assert.equal(h.has("petal-metal"), false);
  windowOf(h, 120000, 200, { theme: "sakura" });
  assert.ok(h.has("petal-metal"));
  const n = harness();
  [120, 120, 120, 120].forEach((c, i) => windowOf(n, i * 30000, c));
  assert.equal(n.has("ghost-chaser"), false);
  assert.equal(n.has("stairway-flow"), false);
  const r = harness();
  for (let b = 0; b < 3; b++)
    for (let i = 0; i < 20; i++) r.input(1, { now: b * 10000 + i * 400 });
  r.send("tick", { now: 30000 });
  assert.ok(r.has("pocket-drummer"));
});
test("idle return starts after ten minutes; reload does not invent idle history", () => {
  const h = harness();
  h.input();
  h.send("tick", { now: 600000 });
  h.input(99, { now: 600001, provenance: "ime" });
  assert.equal(h.has("back-bloom"), false);
  h.input(1, { now: 600002, provenance: "ime" });
  assert.ok(h.has("back-bloom"));
  const n = harness(h.state.saved);
  n.state.saved.unlocked = {};
  n.input(100, { now: 900000, provenance: "ime" });
  assert.equal(n.has("back-bloom"), false);
});
test("revision ranges remain disjoint, remap, and drafts are distinct", () => {
  const h = harness();
  h.input(200, { length: 200, provenance: "ime" });
  for (const from of [0, 20]) h.input(2, { removed: 2, from, length: 200 });
  assert.equal(h.has("seamster"), false);
  h.input(2, { removed: 2, from: 40, length: 200 });
  assert.ok(h.has("seamster"));
  const n = harness();
  n.input(200, { length: 200, provenance: "ime" });
  for (let i = 0; i < 5; i++) n.input(2, { removed: 2, from: 0, length: 200 });
  assert.equal(n.has("seamster"), false);
  assert.equal(n.state.saved.revisions, 1);
  for (let i = 0; i < 4; i++) {
    n.send("clear");
    n.input(100, { length: 100, provenance: "ime" });
    n.input(1, { removed: 1, length: 100 });
  }
  assert.ok(n.has("revision-superpower"));
});
test("trim needs later insertion; history is not new text", () => {
  const h = harness();
  h.input(300, { length: 300, provenance: "ime" });
  h.input(0, { removed: 30, length: 270 });
  assert.equal(h.has("less-better"), false);
  h.input(1, { length: 271 });
  assert.ok(h.has("less-better"));
  const n = harness();
  n.input(300, { length: 300, provenance: "ime" });
  n.input(0, { removed: 91, length: 209 });
  n.input(1, { length: 210 });
  assert.equal(n.has("less-better"), false);
  h.send("history", { history: "undo" });
  h.send("history", { history: "redo" });
  h.input(39);
  assert.equal(h.has("plot-twist"), false);
  h.input(1);
  assert.ok(h.has("plot-twist"));
});
test("exact combos require timeout; paste and navigation invalidate", () => {
  for (const [count, theme, id] of [
    [42, "neon", "dont-panic"],
    [101, "matrix", "no-spoon"],
    [77, "retro", "lucky-seven"],
  ]) {
    for (const delta of [-1, 0, 1]) {
      const h = harness();
      h.input(count + delta, { theme });
      assert.equal(h.has(id), false);
      h.send("tick", { now: 3000, theme });
      assert.equal(h.has(id), delta === 0);
    }
    const h = harness();
    h.input(count, { theme });
    h.send("context");
    h.send("tick", { now: 3000, theme });
    assert.equal(h.has(id), false);
  }
  const h = harness();
  h.input(100, { silent: true });
  assert.ok(h.has("silent-disco"));
  const n = harness();
  n.input(41);
  n.input(1, { provenance: "paste" });
  n.send("tick", { now: 3000 });
  assert.equal(n.has("dont-panic"), false);
});
test("agent counts word boundaries and category progress across sessions", () => {
  for (const words of [19, 20, 80, 81]) {
    const h = harness();
    h.reply(words);
    assert.equal(h.has("bento-box"), words >= 20 && words <= 80);
  }
  const h = harness();
  for (let i = 0; i < 10; i++) h.reply(20);
  assert.ok(h.has("long-thread"));
  assert.ok(h.has("symphony-three"));
  assert.ok(h.has("perfect-landing"));
  for (const theme of [
    "neon",
    "fire",
    "matrix",
    "sakura",
    "cyberpunk",
    "retro",
  ])
    h.reply(20, { theme, thread: theme });
  assert.ok(h.has("mission-control"));
  assert.ok(h.has("lantern-keeper"));
  h.reply(20, { quiet: true });
  assert.ok(h.has("quiet-finale"));
});
test("weave, rally, jackets, twin engines and duck require ordered fresh exchanges", () => {
  const h = harness();
  h.reply();
  for (const theme of [
    "neon",
    "fire",
    "matrix",
    "sakura",
    "cyberpunk",
    "retro",
  ]) {
    h.input(80, { theme, duck: true, length: 80 });
    h.input(1, { theme, removed: 1, length: 80 });
    h.send("submit", { theme });
    h.send("clear", { theme });
    h.reply(20, { theme });
  }
  for (const id of [
    "weave-together",
    "rally-race",
    "matching-jackets",
    "rubber-duck",
  ])
    assert.ok(h.has(id), id);
  windowOf(h, 0, 100);
  h.input(40, { now: 30001 });
  h.send("submit");
  h.reply();
  assert.ok(h.has("twin-engines"));
  const n = harness();
  n.input(40);
  n.send("submit");
  n.send("settings", { theme: "fire" });
  n.send("settings", { theme: "neon" });
  n.reply();
  assert.equal(n.state.saved.jackets.length, 0);
  const p = harness();
  p.input(40, { duck: true, provenance: "paste" });
  p.send("submit");
  p.reply();
  assert.equal(p.has("rubber-duck"), false);
  assert.equal(p.has("pass-baton"), false);
});
test("hour boundary uses wall time but rejects clock jumps; five discoveries unlock Dragons once", () => {
  const h = harness();
  const edge = new Date(2026, 0, 1, 13).getTime();
  h.input(1, { now: 0, wall: edge - 30000 });
  h.input(1, { now: 60000, wall: edge + 30000 });
  assert.ok(h.has("temporal-pincer"));
  const n = harness();
  n.input(1, { now: 0, wall: edge - 30000 });
  n.input(1, { now: 1, wall: edge + 30000 });
  assert.equal(n.has("temporal-pincer"), false);
  const x = harness({
    unlocked: Object.fromEntries(
      [
        "dont-panic",
        "no-spoon",
        "petal-metal",
        "silent-disco",
        "plot-twist",
      ].map((id) => [id, 1]),
    ),
  });
  assert.deepEqual(x.send("tick"), ["here-dragons"]);
  assert.deepEqual(x.send("tick"), []);
});
test("near misses cannot earn full-reply, weave, themed, or timing rewards", () => {
  const h = harness();
  h.send("start", { turn: "empty" });
  h.send("complete", {
    turn: "empty",
    status: "completed",
    words: 20,
    fresh: false,
  });
  assert.equal(h.has("hello-copilot"), false);
  h.reply();
  h.input(1, { removed: 1, length: 1 });
  h.input(79);
  h.send("submit");
  h.reply();
  assert.equal(h.has("weave-together"), false);
  const q = harness();
  q.send("start", { turn: "q", quiet: true });
  q.send("settings", { quiet: false });
  q.send("complete", {
    turn: "q",
    status: "completed",
    words: 20,
    fresh: true,
    quiet: true,
  });
  assert.equal(q.has("quiet-finale"), false);
  const s = harness();
  s.input(99, { silent: true });
  s.send("settings", { silent: false });
  s.input(1, { silent: true });
  assert.equal(s.has("silent-disco"), false);
  const t = harness();
  windowOf(t, 0, 200, { theme: "neon" });
  assert.equal(t.has("petal-metal"), false);
  const r = harness();
  r.input(100);
  r.send("history", { history: "redo" });
  r.input(40);
  assert.equal(r.has("plot-twist"), false);
});
test("replay sequence, reload, session expiry and unknown edits cannot complete local sequences", () => {
  const h = harness();
  h.input(40);
  const e = {
    ...base,
    seq: h.state.lastSeq,
    type: "edit",
    inserted: 100,
    provenance: "direct",
  };
  reduceCollection(h.state, e);
  assert.equal(h.state.draft.entered, 40);
  h.send("submit");
  h.send("tick", { now: 600000 });
  h.reply();
  assert.equal(h.has("pass-baton"), false);
  const restored = harness(h.state.saved);
  assert.equal(restored.state.draft, undefined);
  assert.deepEqual(restored.state.session.discoveries, []);
  const n = harness();
  n.input(200, { length: 200 });
  n.input(1, { length: 201, provenance: "unknown" });
  n.send("tick", { now: 3000 });
  assert.equal(n.has("silent-disco"), false);
});
test("delayed start delivery cannot attach input entered after the actual start", () => {
  const h = harness();
  h.input(40, { wall: base.wall + 100 });
  h.send("submit", { wall: base.wall + 100 });
  h.send("start", { turn: "r", wall: base.wall + 50 });
  h.send("complete", {
    turn: "r",
    status: "completed",
    words: 20,
    fresh: true,
  });
  assert.equal(h.has("pass-baton"), false);
});
test("late local submit acknowledgement preserves an eligible input-before-start exchange", () => {
  const h = harness();
  h.input(40);
  h.send("start", { turn: "r", wall: base.wall + 50 });
  h.send("submit", { wall: base.wall + 100 });
  h.send("clear");
  h.send("complete", {
    turn: "r",
    status: "completed",
    fresh: true,
    words: 20,
  });
  assert.ok(h.has("pass-baton"));
});

test("every one of the 32 additions has an exercised positive path", () => {
  assert.deepEqual(
    CATALOG.map((a) => a.id).filter((id) => !exercised.has(id)),
    [],
  );
});
