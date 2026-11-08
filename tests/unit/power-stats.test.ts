import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installWindow } from "./window-stub";

const STATS_KEY = "bb-plugin-power-mode:power-mode:stats";

async function freshStats() {
  vi.resetModules();
  return import("../../lib/power-stats");
}

let win: ReturnType<typeof installWindow>;

beforeEach(() => {
  vi.useFakeTimers();
  // Noon, so the Night Owl achievement is only unlocked when a test asks for it.
  vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
  win = installWindow();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("power-stats", () => {
  it("starts empty", async () => {
    const stats = await freshStats();
    expect(stats.getPowerStats()).toEqual(stats.EMPTY_STATS);
  });

  it("accumulates recorded events", async () => {
    const stats = await freshStats();
    stats.recordStats((s) => ({ ...s, chars: s.chars + 3 }));
    stats.recordStats((s) => ({ ...s, chars: s.chars + 2, deletes: s.deletes + 1 }));
    expect(stats.getPowerStats()).toMatchObject({ chars: 5, deletes: 1 });
  });

  it("debounces persistence to one write per 2 seconds", async () => {
    const stats = await freshStats();
    const saved = () => win.data.get(STATS_KEY);
    // Pastes below the achievement threshold, so nothing unlocks and flushes early.
    stats.recordStats((s) => ({ ...s, pastes: 1 }));
    stats.recordStats((s) => ({ ...s, pastes: 2 }));
    expect(saved()).toBeUndefined();
    vi.advanceTimersByTime(1999);
    expect(saved()).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(JSON.parse(saved()!).pastes).toBe(2);
  });

  it("flushPowerStats persists immediately and notifies subscribers", async () => {
    const stats = await freshStats();
    stats.recordStats((s) => ({ ...s, pastes: 4 }));
    const listener = vi.fn();
    stats.subscribePowerStats(listener);
    stats.flushPowerStats();
    expect(JSON.parse(win.data.get(STATS_KEY)!).pastes).toBe(4);
    expect(listener).toHaveBeenCalledTimes(1);
    stats.flushPowerStats(); // nothing dirty: no second notification
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reloads persisted stats and sanitizes untrusted values", async () => {
    win.data.set(
      STATS_KEY,
      JSON.stringify({
        chars: 12.7,
        deletes: -3,
        pastes: "many",
        bestCombo: 40,
        themesTried: ["fire", "bogus", "neon"],
        unlocked: { "first-spark": 123, "not-real": 456, "combo-10": "yesterday" },
      }),
    );
    const stats = await freshStats();
    expect(stats.getPowerStats()).toMatchObject({
      chars: 12,
      deletes: 0,
      pastes: 0,
      bestCombo: 40,
      themesTried: ["neon", "fire"],
      unlocked: { "first-spark": 123 },
    });
  });

  it.each([["{oops"], ["null"], [""]])("treats corrupt storage %j as empty", async (raw) => {
    win.data.set(STATS_KEY, raw);
    const stats = await freshStats();
    expect(stats.getPowerStats()).toEqual(stats.EMPTY_STATS);
  });

  it("unlocks achievements once, persists them right away, and calls the unlock handler", async () => {
    const stats = await freshStats();
    const handler = vi.fn();
    stats.setUnlockHandler(handler);
    stats.recordStats((s) => ({ ...s, chars: 1, bestCombo: 10 }));
    const ids = handler.mock.calls.map(([a]) => a.id).sort();
    expect(ids).toEqual(["combo-10", "first-spark"]);
    const saved = JSON.parse(win.data.get(STATS_KEY)!);
    expect(Object.keys(saved.unlocked).sort()).toEqual(ids);
    expect(saved.unlocked["combo-10"]).toBe(Date.now());

    handler.mockClear();
    stats.recordStats((s) => ({ ...s, chars: s.chars + 1, bestCombo: 20 }));
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not call a cleared unlock handler", async () => {
    const stats = await freshStats();
    const handler = vi.fn();
    stats.setUnlockHandler(handler);
    stats.setUnlockHandler(null);
    stats.recordStats((s) => ({ ...s, chars: 1 }));
    expect(handler).not.toHaveBeenCalled();
    expect(stats.getPowerStats().unlocked["first-spark"]).toBeDefined();
  });

  it("unlocks Night Owl only when typing between midnight and 4 AM", async () => {
    let stats = await freshStats();
    stats.recordStats((s) => ({ ...s, chars: 1 }));
    expect(stats.getPowerStats().unlocked["night-owl"]).toBeUndefined();

    vi.setSystemTime(new Date(2026, 0, 2, 3, 30, 0));
    win = installWindow();
    stats = await freshStats();
    stats.recordStats((s) => ({ ...s, chars: 1 }));
    expect(stats.getPowerStats().unlocked["night-owl"]).toBeUndefined();
    stats.recordStats((s) => ({ ...s, chars: 2 }), { typed: true });
    expect(stats.getPowerStats().unlocked["night-owl"]).toBeDefined();
  });

  it("unlocks Theme Tourist only after every theme was tried", async () => {
    const stats = await freshStats();
    const { THEME_IDS } = await import("../../lib/power-store");
    stats.recordStats((s) => ({ ...s, themesTried: THEME_IDS.slice(1) }));
    expect(stats.getPowerStats().unlocked["theme-tourist"]).toBeUndefined();
    stats.recordStats((s) => ({ ...s, themesTried: [...THEME_IDS] }));
    expect(stats.getPowerStats().unlocked["theme-tourist"]).toBeDefined();
  });

  it("resetPowerStats clears stats and achievements in memory and in storage", async () => {
    const stats = await freshStats();
    stats.recordStats((s) => ({ ...s, chars: 2000, bestCombo: 60 }));
    expect(Object.keys(stats.getPowerStats().unlocked).length).toBeGreaterThan(0);
    stats.resetPowerStats();
    expect(stats.getPowerStats()).toEqual(stats.EMPTY_STATS);
    expect(JSON.parse(win.data.get(STATS_KEY)!)).toEqual(stats.EMPTY_STATS);
    vi.advanceTimersByTime(5000); // a pending debounced save must not resurrect old stats
    expect(JSON.parse(win.data.get(STATS_KEY)!)).toEqual(stats.EMPTY_STATS);
  });

  it("keeps stats in memory when storage writes fail", async () => {
    win = installWindow({ failWrites: true, failReads: true });
    const stats = await freshStats();
    expect(() => stats.recordStats((s) => ({ ...s, chars: 7 }))).not.toThrow();
    expect(stats.getPowerStats().chars).toBe(7);
  });
});
