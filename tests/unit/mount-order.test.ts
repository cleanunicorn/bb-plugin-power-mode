// Regression tests for issue #38: a UI slot may read or record stats and
// settings before the content script calls `initPowerStore`. Nothing may touch
// storage under the placeholder key, and initialising must leave the stored
// document intact and visible in memory, whichever side mounts first.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installWindow } from "./window-stub";

const ID = "my-plugin-id";
const STATS_KEY = `${ID}:power-mode:stats`;
const SETTINGS_KEY = `${ID}:power-mode:settings`;
const PLACEHOLDER = "bb-plugin-power-mode:";
const STORED = { chars: 12345, bestCombo: 99, unlocked: { "first-spark": 1_700_000_000_000 } };

let win: ReturnType<typeof installWindow>;

async function freshModules() {
  vi.resetModules();
  const store = await import("../../lib/power-store");
  const stats = await import("../../lib/power-stats");
  const sync = await import("../../lib/settings-sync");
  return { store, stats, ...sync };
}

/** Runs queued microtasks (deferred listener notifications). */
const microtasks = () => Promise.resolve().then(() => Promise.resolve());

const placeholderKeys = () => [...win.data.keys()].filter((k) => k.startsWith(PLACEHOLDER));
const storedStats = () => JSON.parse(win.data.get(STATS_KEY)!);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
  win = installWindow();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const STORED_STATES = [
  ["a legacy document", () => win.data.set(STATS_KEY, JSON.stringify(STORED))],
  ["a document with an epoch", () => win.data.set(STATS_KEY, JSON.stringify({ ...STORED, epoch: "e1" }))],
  ["no document", () => {}],
] as const;

describe("stats mount order", () => {
  describe.each(STORED_STATES)("with %s", (name, seed) => {
    const expected = name === "no document" ? { chars: 5, bestCombo: 0 } : { chars: 12350, bestCombo: 99 };

    it("slot first: pre-init activity merges into the stored document at init", async () => {
      seed();
      const { store, stats } = await freshModules();
      const resets = vi.fn();
      stats.onCollectionReset(resets);
      const toasts = vi.fn();
      stats.setUnlockHandler(toasts);

      // A slot reads and records before the content script mounts.
      stats.getPowerStats();
      stats.getCollection();
      stats.recordAchievementEvent({ type: "context", now: 1, wall: Date.now(), thread: null, theme: "neon", quiet: false, silent: false });
      stats.recordStats((s) => ({ ...s, chars: s.chars + 5 }));
      void stats.flushPowerStats();
      stats.flushPowerStatsSync();
      expect(placeholderKeys()).toEqual([]);
      if (name !== "no document") expect(storedStats().chars).toBe(12345);
      else expect(win.data.has(STATS_KEY)).toBe(false);

      store.initPowerStore(ID);
      // Visible in memory at once, without waiting for a flush.
      expect(stats.getPowerStats()).toMatchObject(expected);
      if (name !== "no document") expect(stats.getPowerStats().unlocked["first-spark"]).toBe(STORED.unlocked["first-spark"]);

      await microtasks();
      vi.advanceTimersByTime(2500);
      await microtasks();
      expect(storedStats()).toMatchObject(expected);
      if (name !== "no document") expect(storedStats().unlocked["first-spark"]).toBe(STORED.unlocked["first-spark"]);
      if (name === "a document with an epoch") expect(storedStats().epoch).toBe("e1");
      expect(stats.getPowerStats()).toMatchObject(expected);
      expect(placeholderKeys()).toEqual([]);
      expect(resets).not.toHaveBeenCalled();
      // First Spark was already stored: no second toast. With no document it is new.
      const sparkToasts = toasts.mock.calls.filter(([a]) => a.id === "first-spark");
      expect(sparkToasts).toHaveLength(name === "no document" ? 1 : 0);
    });

    it("content script first: stats load from the real key", async () => {
      seed();
      const { store, stats } = await freshModules();
      const resets = vi.fn();
      stats.onCollectionReset(resets);
      store.initPowerStore(ID);
      stats.recordAchievementEvent({ type: "context", now: 1, wall: Date.now(), thread: null, theme: "neon", quiet: false, silent: false });
      stats.recordStats((s) => ({ ...s, chars: s.chars + 5 }));
      expect(stats.getPowerStats()).toMatchObject(expected);
      vi.advanceTimersByTime(2500);
      await microtasks();
      expect(storedStats()).toMatchObject(expected);
      expect(placeholderKeys()).toEqual([]);
      expect(resets).not.toHaveBeenCalled();
    });
  });

  it("notifies stats subscribers after init, not synchronously inside it", async () => {
    win.data.set(STATS_KEY, JSON.stringify(STORED));
    const { store, stats } = await freshModules();
    const listener = vi.fn();
    stats.subscribePowerStats(listener);
    const before = stats.getPowerStats();
    expect(stats.getPowerStats()).toBe(before); // stable snapshot before init
    store.initPowerStore(ID);
    expect(listener).not.toHaveBeenCalled();
    await microtasks();
    expect(listener).toHaveBeenCalled();
    expect(stats.getPowerStats().chars).toBe(12345);
  });

  it("keeps the observer session across the re-baseline", async () => {
    const { store, stats } = await freshModules();
    const collection = stats.getCollection();
    collection.session.discoveries.push("probe");
    store.initPowerStore(ID);
    expect(stats.getCollection()).toBe(collection);
    expect(stats.getCollection().session.discoveries).toContain("probe");
    expect(stats.getPowerStats().collection).toBe(stats.getCollection().saved);
  });

  it("a reset before init wins over the stored document", async () => {
    win.data.set(STATS_KEY, JSON.stringify(STORED));
    const { store, stats } = await freshModules();
    stats.resetPowerStats();
    expect(placeholderKeys()).toEqual([]);
    store.initPowerStore(ID);
    expect(stats.getPowerStats().chars).toBe(0);
    await microtasks();
    vi.advanceTimersByTime(2500);
    await microtasks();
    expect(storedStats()).toMatchObject({ chars: 0, unlocked: {} });
  });

  it("initialising twice with the same id is a no-op", async () => {
    win.data.set(STATS_KEY, JSON.stringify(STORED));
    const { store, stats } = await freshModules();
    stats.recordStats((s) => ({ ...s, chars: s.chars + 5 }));
    store.initPowerStore(ID);
    store.initPowerStore(ID);
    expect(stats.getPowerStats().chars).toBe(12350);
  });
});

describe("settings mount order", () => {
  it("never writes the placeholder key and notifies subscribers once init loads stored settings", async () => {
    win.data.set(SETTINGS_KEY, JSON.stringify({ enabled: true, theme: "fire" }));
    const { store } = await freshModules();
    const listener = vi.fn();
    store.subscribePowerSettings(listener);
    expect(store.getPowerSettings().enabled).toBe(false);
    store.initPowerStore(ID);
    expect(store.getPowerSettings()).toMatchObject({ enabled: true, theme: "fire" });
    expect(listener).not.toHaveBeenCalled();
    await microtasks();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(placeholderKeys()).toEqual([]);
  });

  it("does not notify when init loads what subscribers already saw", async () => {
    const { store } = await freshModules();
    const listener = vi.fn();
    store.subscribePowerSettings(listener);
    store.initPowerStore(ID);
    await microtasks();
    expect(listener).not.toHaveBeenCalled();
  });

  it("applies a toggle made before init over the loaded settings and stores it under the real key", async () => {
    win.data.set(SETTINGS_KEY, JSON.stringify({ enabled: false, theme: "fire" }));
    const { store } = await freshModules();
    store.updatePowerSettings({ enabled: true });
    expect(store.getPowerSettings().enabled).toBe(true);
    expect(placeholderKeys()).toEqual([]);
    store.initPowerStore(ID);
    expect(store.getPowerSettings()).toMatchObject({ enabled: true, theme: "fire" });
    expect(JSON.parse(win.data.get(SETTINGS_KEY)!)).toMatchObject({ enabled: true, theme: "fire" });
  });

  it("a toggle before init wins over the server copy and is uploaded, even across a restarted sync", async () => {
    const { store, startSettingsSync } = await freshModules();
    store.updatePowerSettings({ enabled: true });
    store.initPowerStore(ID);
    const saves: Record<string, unknown>[] = [];
    let gate: () => void = () => {};
    const remote = {
      load: vi.fn(async () => {
        await new Promise<void>((resolve) => (gate = resolve));
        return { enabled: false, theme: "matrix" };
      }),
      save: vi.fn(async (s: object) => {
        saves.push({ ...s });
      }),
    };
    // The first sync is torn down before it hydrates (an effect remount).
    const first = new AbortController();
    startSettingsSync(remote, { signal: first.signal });
    await microtasks();
    first.abort();
    gate();
    await microtasks();

    const sync = startSettingsSync(remote, { signal: new AbortController().signal });
    await microtasks();
    gate();
    await sync.hydrated;
    expect(store.getPowerSettings()).toMatchObject({ enabled: true, theme: "matrix" });
    expect(saves.at(-1)).toMatchObject({ enabled: true, theme: "matrix" });
  });
});
