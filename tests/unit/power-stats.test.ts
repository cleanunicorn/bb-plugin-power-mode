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

  it("unlocks the ordnance badges from paste counters", async () => {
    const stats = await freshStats();
    stats.recordStats((s) => ({ ...s, bestPasteTier: 4, luckyDrops: 0 }));
    expect(stats.getPowerStats().unlocked.bombardier).toBeUndefined();
    stats.recordStats((s) => ({ ...s, bestPasteTier: 5, luckyDrops: 1 }));
    const unlocked = stats.getPowerStats().unlocked;
    expect(unlocked.bombardier).toBeTruthy();
    expect(unlocked["lucky-drop"]).toBeTruthy();
    expect(unlocked.doomsday).toBeUndefined();
    stats.recordStats((s) => ({ ...s, bestPasteTier: 8 }));
    expect(stats.getPowerStats().unlocked.doomsday).toBeTruthy();
    const doomsday = stats.ACHIEVEMENTS.find((a) => a.id === "doomsday")!;
    expect(doomsday.hidden).toBe(true);
    expect(doomsday.requires).toEqual(["ordnance-stats"]);
    expect(stats.ACHIEVEMENTS.filter((a) => a.requires.includes("legacy-stats"))).toHaveLength(19);
  });

  it("sanitizes the paste counters from storage", async () => {
    win.data.set(STATS_KEY, JSON.stringify({ bestPasteTier: 42, luckyDrops: -2 }));
    const stats = await freshStats();
    expect(stats.getPowerStats()).toMatchObject({ bestPasteTier: 9, luckyDrops: 0 });
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
    expect(JSON.parse(win.data.get(STATS_KEY)!)).toEqual({ ...stats.EMPTY_STATS, epoch: expect.any(String) });
    vi.advanceTimersByTime(5000); // a pending debounced save must not resurrect old stats
    expect(JSON.parse(win.data.get(STATS_KEY)!)).toEqual({ ...stats.EMPTY_STATS, epoch: expect.any(String) });
  });

  it("keeps stats in memory when storage writes fail", async () => {
    win = installWindow({ failWrites: true, failReads: true });
    const stats = await freshStats();
    expect(() => stats.recordStats((s) => ({ ...s, chars: 7 }))).not.toThrow();
    expect(stats.getPowerStats().chars).toBe(7);
  });
  it("merges collection deltas and new ordnance fields without mutating the baseline", async () => {
    const { mergeStats, EMPTY_STATS } = await freshStats();
    const base = structuredClone(EMPTY_STATS);
    base.collection.replies = 2;
    const local = structuredClone(base), remote = structuredClone(base);
    local.luckyDrops = 2; local.clutches = 3; local.bestPasteTier = 5; local.bestPasteChain = 3;
    remote.luckyDrops = 1; remote.clutches = 2; remote.bestPasteTier = 8;
    local.collection.replies += 3; remote.collection.replies += 4;
    local.collection.biomes.neon = 60; remote.collection.biomes.neon = 50;
    local.collection.threads.one = 2; remote.collection.threads.two = 3;
    local.collection.lanterns = ["neon"]; remote.collection.lanterns = ["fire"];
    remote.collection.pin = "first-spark";
    local.unlocked["hello-copilot"] = 200; remote.unlocked["hello-copilot"] = 100;
    const merged = mergeStats(remote, local, base);
    expect(merged).toMatchObject({ luckyDrops: 3, clutches: 5, bestPasteTier: 8, bestPasteChain: 3 });
    expect(merged.collection).toMatchObject({ replies: 9, biomes: { neon: 100 }, threads: { one: 2, two: 3 },
      lanterns: ["neon", "fire"], pin: "first-spark", unlocked: { "hello-copilot": 100 } });
    expect(base.collection.replies).toBe(2);
    expect(mergeStats(merged, merged, merged)).toEqual(merged);
  });

  it("preserves reducer activity after repeated flushes and remote adoption", async () => {
    const stats = await freshStats();
    const event = (n: number) => stats.recordAchievementEvent({ type: "edit", now: n, wall: Date.now(),
      inserted: 10, provenance: "direct", theme: "neon", editor: "one", thread: null, quiet: false, silent: false });
    event(1);
    await stats.flushPowerStats();
    event(2);
    await stats.flushPowerStats();
    expect(JSON.parse(win.data.get(STATS_KEY)!).collection.biomes.neon).toBe(20);
    const remote = JSON.parse(win.data.get(STATS_KEY)!);
    remote.collection.biomes.fire = 15;
    remote.collection.pin = "first-spark";
    win.data.set(STATS_KEY, JSON.stringify(remote));
    win.dispatchStorage(STATS_KEY, JSON.stringify(remote));
    expect(stats.getCollection().saved.pin).toBe("first-spark");
    event(3);
    await stats.flushPowerStats();
    expect(JSON.parse(win.data.get(STATS_KEY)!).collection.biomes).toEqual({ neon: 30, fire: 15 });
  });

  it("does not resurrect a cleared legacy document, even without a storage event", async () => {
    win.data.set(STATS_KEY, JSON.stringify({ chars: 50, unlocked: { "first-spark": 1 } }));
    const stats = await freshStats();
    stats.recordStats(s => ({ ...s, chars: s.chars + 5 }));
    win.data.delete(STATS_KEY);
    await stats.flushPowerStats();
    expect(stats.getPowerStats().chars).toBe(0);
    expect(JSON.parse(win.data.get(STATS_KEY)!).chars).toBe(0);
  });

  it("continues flushing when a lock is granted synchronously", async () => {
    vi.stubGlobal("navigator", { locks: { request: (_: string, run: () => void) => { run(); return Promise.resolve(); } } });
    const stats = await freshStats();
    stats.recordStats(s => ({ ...s, pastes: 1 }));
    await stats.flushPowerStats();
    stats.resetPowerStats();
    await stats.flushPowerStats();
    expect(JSON.parse(win.data.get(STATS_KEY)!).pastes).toBe(0);
  });

  it("retries a failed write without losing or double-counting activity", async () => {
    vi.stubGlobal("navigator", {});
    const stats = await freshStats();
    stats.recordStats(s => ({ ...s, pastes: 2 }));
    const setItem = window.localStorage.setItem;
    window.localStorage.setItem = () => { throw new Error("temporary quota failure"); };
    await stats.flushPowerStats();
    expect(stats.getPowerStats().pastes).toBe(2);
    window.localStorage.setItem = setItem;
    await stats.flushPowerStats();
    expect(JSON.parse(win.data.get(STATS_KEY)!).pastes).toBe(2);
    stats.recordStats(s => ({ ...s, pastes: s.pastes + 1 }));
    await stats.flushPowerStats();
    expect(JSON.parse(win.data.get(STATS_KEY)!).pastes).toBe(3);
  });

  it("only announces a claimed unlock after a successful write and retries reset", async () => {
    vi.stubGlobal("navigator", {});
    const stats = await freshStats();
    const handler = vi.fn();
    stats.setUnlockHandler(handler);
    const setItem = window.localStorage.setItem;
    window.localStorage.setItem = () => { throw new Error("temporary quota failure"); };
    stats.recordStats(s => ({ ...s, chars: 1 }));
    expect(handler).not.toHaveBeenCalled();
    window.localStorage.setItem = setItem;
    await stats.flushPowerStats();
    expect(handler.mock.calls.map(([a]) => a.id)).toEqual(["first-spark"]);
    await stats.flushPowerStats();
    expect(handler).toHaveBeenCalledTimes(1);
    window.localStorage.setItem = () => { throw new Error("temporary quota failure"); };
    stats.resetPowerStats();
    window.localStorage.setItem = setItem;
    await stats.flushPowerStats();
    expect(JSON.parse(win.data.get(STATS_KEY)!).chars).toBe(0);
  });

});
