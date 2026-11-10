import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentObservation } from "../lib/achievement-agent.ts";
test("canonical cursor suppresses replay; split words count once; partial observations fail closed", () => {
  const out = [],
    a = new AgentObservation((e) => out.push(e), "t");
  let seq = 1;
  const row = (type, data = {}, turnId = "r") => ({
    seq: seq++,
    createdAt: 0,
    scope: { kind: "turn", turnId },
    type,
    data,
  });
  const old = row("turn/started");
  a.seed(old.seq);
  a.accept([old]);
  assert.equal(out.length, 0);
  a.accept([
    row("turn/started"),
    row("item/started", { item: { type: "agentMessage", id: "m", text: "" } }),
    row("item/agentMessage/delta", { itemId: "m", delta: "hel" }),
    row("item/agentMessage/delta", { itemId: "m", delta: "lo world" }),
    row("item/completed", {
      item: { type: "agentMessage", id: "m", text: "hello world" },
    }),
  ]);
  const end = row("turn/completed", { status: "completed" });
  a.accept([end, end]);
  assert.equal(out.filter((e) => e.type === "complete").length, 1);
  assert.equal(out.at(-1).words, 2);
  assert.equal(out.at(-1).fresh, true);
  a.disconnect();
  a.seed(seq);
  a.accept([row("turn/completed", { status: "completed" })]);
  assert.equal(out.at(-1).type, "disconnect");
});

test("an unobserved message makes the whole reply partial", () => {
  for (const missing of ["item/completed", "item/agentMessage/delta"]) {
    const out = [],
      a = new AgentObservation((e) => out.push(e), "t");
    a.seed(0);
    let seq = 0;
    const row = (type, data = {}) => ({
      seq: ++seq,
      createdAt: seq,
      scope: { kind: "turn", turnId: "r" },
      type,
      data,
    });
    a.accept([
      row("turn/started"),
      row("item/started", {
        item: { type: "agentMessage", id: "seen", text: "hello" },
      }),
      row("item/completed", {
        item: { type: "agentMessage", id: "seen", text: "hello" },
      }),
      row(
        missing,
        missing === "item/completed"
          ? {
              item: {
                type: "agentMessage",
                id: "missed",
                text: "unobserved reply",
              },
            }
          : { itemId: "missed", delta: "unobserved reply" },
      ),
      row("turn/completed", { status: "completed" }),
    ]);
    assert.equal(out.at(-1).fresh, false, missing);
  }
});
