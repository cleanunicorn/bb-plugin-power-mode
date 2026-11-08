import React from "react";
import { createRoot } from "react-dom/client";
import { StatsAndAchievements } from "../app";
import { observeComposer, graphemes } from "../lib/achievement-input";
import { observeAchievement } from "../lib/achievement-observer";
import { AgentObservation } from "../lib/achievement-agent";
import { initPowerStore, updatePowerSettings } from "../lib/power-store";
import {
  getPowerStats,
  getCollection,
  resetPowerStats,
  flushPowerStats,
  setCollectionPreference,
} from "../lib/power-stats";
initPowerStore("achievement-fixture");
updatePowerSettings({ enabled: true });
let time = 1000;
Object.defineProperty(performance, "now", { value: () => time });
const disposers = ["a", "b"].map((id) =>
  observeComposer(
    { key: id, thread: id, marker: document.getElementById(`marker-${id}`)! },
    observeAchievement,
  ),
);
createRoot(document.getElementById("gallery")!).render(
  <StatsAndAchievements />,
);
let seq = 0,
  turn = 0;
export function reply(thread = "a", words = 20, status = "completed") {
  const adapter = new AgentObservation(observeAchievement, thread);
  adapter.seed(seq);
  const turnId = `turn-${++turn}`;
  const row = (type: string, data: unknown) => ({
    seq: ++seq,
    createdAt: Date.now(),
    scope: { kind: "turn", turnId },
    type,
    data,
  });
  const text = Array.from({ length: words }, () => "word").join(" ");
  adapter.accept([
    row("turn/started", {}),
    row("item/started", { item: { type: "agentMessage", id: "m", text: "" } }),
    row("item/agentMessage/delta", { itemId: "m", delta: text.slice(0, 2) }),
    row("item/agentMessage/delta", { itemId: "m", delta: text.slice(2) }),
    row("item/completed", { item: { type: "agentMessage", id: "m", text } }),
    row("turn/completed", { status }),
  ]);
}
export const submit = (thread = "a") =>
  observeAchievement({ type: "submit", editor: thread, thread });
export const advance = (ms: number) => {
  time += ms;
  observeAchievement({ type: "tick" });
};
export {
  getPowerStats,
  getCollection,
  resetPowerStats,
  updatePowerSettings,
  setCollectionPreference,
  flushPowerStats,
  graphemes,
};
export const dispose = () => disposers.forEach((d) => d());

export { ACHIEVEMENTS } from "../lib/power-stats";
export { availableTitles } from "../lib/achievement-presentation";
