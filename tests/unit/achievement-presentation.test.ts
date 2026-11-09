import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installWindow } from "./window-stub";

async function fresh() {
  vi.resetModules();
  const stats = await import("../../lib/power-stats");
  const presentation = await import("../../lib/achievement-presentation");
  return { ...stats, ...presentation };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
  installWindow();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("challengeProgressRatio", () => {
  it("is null for unlocked, moment-based and locked hidden badges", async () => {
    const m = await fresh();
    m.recordStats((s) => ({ ...s, chars: 5 }));
    const stats = m.getPowerStats();
    expect(stats.unlocked["first-spark"]).toBeTruthy();
    expect(m.challengeProgressRatio("first-spark", stats)).toBeNull();
    expect(m.challengeProgressRatio("night-owl", stats)).toBeNull();
    expect(m.challengeProgressRatio("doomsday", stats)).toBeNull();
    expect(m.challengeProgress("doomsday", stats)).toBe("");
  });

  it("tracks legacy and ordnance counters as a clamped 0–1 fraction", async () => {
    const m = await fresh();
    m.recordStats((s) => ({ ...s, bestCombo: 25, bestPasteTier: 4, milestones: 250 }));
    const stats = m.getPowerStats();
    expect(m.challengeProgressRatio("combo-50", stats)).toBeCloseTo(0.5);
    expect(m.challengeProgressRatio("bombardier", stats)).toBeCloseTo(0.8);
    expect(m.challengeProgress("bombardier", stats)).toBe("4 / 5 best paste tier");
    // Pyrotechnician is unlocked at 250 milestones, so it no longer reports progress.
    expect(stats.unlocked.pyrotechnician).toBeTruthy();
    expect(m.challengeProgressRatio("pyrotechnician", stats)).toBeNull();
    expect(m.challengeProgress("lucky-drop", stats)).toBe("0 / 1 lucky drops");
  });
});
