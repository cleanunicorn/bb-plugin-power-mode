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

describe("combo and chain badges", () => {
  it("unlock from the clutch and paste-chain counters and report progress", async () => {
    const m = await fresh();
    m.recordStats((s) => ({ ...s, clutches: 7, bestPasteChain: 2 }));
    let stats = m.getPowerStats();
    expect(stats.unlocked["clutch-player"]).toBeUndefined();
    expect(m.challengeProgress("clutch-player", stats)).toBe("7 / 10 clutch saves");
    expect(m.challengeProgressRatio("chain-reaction", stats)).toBeCloseTo(2 / 3);
    m.recordStats((s) => ({ ...s, clutches: 10, bestPasteChain: 3 }));
    stats = m.getPowerStats();
    expect(stats.unlocked["clutch-player"]).toBeTruthy();
    expect(stats.unlocked["chain-reaction"]).toBeTruthy();
  });
});

describe("rarityOf", () => {
  it("ranks secrets apart and defaults to common", async () => {
    const m = await fresh();
    const of = (id: string) => m.rarityOf(m.ACHIEVEMENTS.find((a) => a.id === id)!);
    expect(of("first-spark")).toBe("common");
    expect(of("combo-100")).toBe("rare");
    expect(of("combo-250")).toBe("epic");
    expect(of("combo-500")).toBe("legendary");
    expect(of("doomsday")).toBe("secret");
    // Every hidden badge is a secret, whatever its id.
    for (const a of m.ACHIEVEMENTS.filter((a) => a.hidden)) expect(m.rarityOf(a)).toBe("secret");
  });
});

describe("closestChallenges", () => {
  it("lists started, locked, visible badges by progress and never a secret", async () => {
    const m = await fresh();
    expect(m.closestChallenges(m.getPowerStats())).toEqual([]);
    m.recordStats((s) => ({ ...s, bestCombo: 45, deletes: 100, bestPasteTier: 7 }));
    const stats = m.getPowerStats();
    const closest = m.closestChallenges(stats, 3);
    expect(closest.map((c) => c.a.id)).toEqual(["combo-50", "combo-100", "deletes-500"]);
    expect(closest[0].ratio).toBeCloseTo(0.9);
    expect(m.closestChallenges(stats, 50).some((c) => c.a.hidden || stats.unlocked[c.a.id])).toBe(false);
  });
});
