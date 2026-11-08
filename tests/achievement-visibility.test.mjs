import { test } from "node:test";
import assert from "node:assert/strict";
import { ObservationVisibility } from "../lib/achievement-visibility.ts";
import { AgentObservation } from "../lib/achievement-agent.ts";

class Page extends EventTarget {
  visibilityState = "visible";
  show(value) {
    this.visibilityState = value;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}
for (const returnBeforeResponse of [false, true]) {
  test(`hidden tab invalidates an in-flight reply (returned: ${returnBeforeResponse})`, async () => {
    const page = new Page(),
      events = [];
    const adapter = new AgentObservation((e) => events.push(e), "t");
    const guard = new ObservationVisibility(page, () => adapter.disconnect());
    adapter.seed(0);
    const row = (seq, type, data = {}) => ({
      seq,
      type,
      data,
      createdAt: seq,
      scope: { kind: "turn", turnId: "r" },
    });
    adapter.accept([row(1, "turn/started")]);
    let resolve;
    const pending = guard.run(
      () => new Promise((r) => (resolve = r)),
      (rows) => adapter.accept(rows),
    );
    page.show("hidden");
    assert.equal(adapter.afterSeq, null);
    if (returnBeforeResponse) page.show("visible");
    resolve([
      row(2, "item/started", {
        item: { id: "m", type: "agentMessage", text: "hello" },
      }),
      row(3, "item/completed", {
        item: { id: "m", type: "agentMessage", text: "hello" },
      }),
      row(4, "turn/completed", { status: "completed" }),
    ]);
    await pending;
    assert.equal(
      events.some((e) => e.type === "complete"),
      false,
    );
    assert.equal(adapter.afterSeq, null);
    if (!returnBeforeResponse) page.show("visible");
    await guard.run(
      async () => 4,
      (seq) => adapter.seed(seq),
    );
    assert.equal(adapter.afterSeq, 4);
    guard.dispose();
  });
}
test("brief hide between polls resets cursor; hidden requests and disposed responses are ignored", async () => {
  const page = new Page();
  let resets = 0,
    accepted = 0,
    requests = 0;
  const guard = new ObservationVisibility(page, () => resets++);
  page.show("hidden");
  await guard.run(
    async () => {
      requests++;
    },
    () => accepted++,
  );
  assert.equal(requests, 0);
  page.show("visible");
  assert.ok(resets >= 2);
  await guard.run(
    async () => 1,
    () => accepted++,
  );
  assert.equal(accepted, 1);
  let resolve;
  const pending = guard.run(
    () => new Promise((r) => (resolve = r)),
    () => accepted++,
  );
  guard.dispose();
  resolve(2);
  await pending;
  assert.equal(accepted, 1);
  const disposedResets = resets;
  page.show("hidden");
  assert.equal(resets, disposedResets);
});

test("hidden intervals also discard stale cursor seeds and request failures", async () => {
  const page = new Page();
  let resets = 0,
    cursor = null,
    resolve,
    reject;
  const guard = new ObservationVisibility(page, () => {
    resets++;
    cursor = null;
  });
  const seed = guard.run(
    () => new Promise((r) => (resolve = r)),
    (value) => (cursor = value),
  );
  page.show("hidden");
  page.show("visible");
  resolve(10);
  await seed;
  assert.equal(cursor, null);
  const obsolete = guard.run(
    () => new Promise((_, r) => (reject = r)),
    () => {},
  );
  guard.reset();
  await guard.run(
    async () => 20,
    (value) => (cursor = value),
  );
  const before = resets;
  reject(new Error("old request failed"));
  await obsolete;
  assert.equal(cursor, 20);
  assert.equal(resets, before);
  guard.dispose();
});
