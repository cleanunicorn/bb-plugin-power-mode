import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installWindow } from "./window-stub";

const KEY = "test-plugin:power-mode:settings";

async function freshStore() {
  vi.resetModules();
  return import("../../lib/power-store");
}

afterEach(() => vi.unstubAllGlobals());

describe("power-store", () => {
  beforeEach(() => {
    installWindow();
  });

  it("starts with the defaults when nothing is stored", async () => {
    const store = await freshStore();
    store.initPowerStore("test-plugin");
    expect(store.getPowerSettings()).toEqual(store.DEFAULT_SETTINGS);
  });

  it("persists updates under the plugin-scoped key and reloads them", async () => {
    const win = installWindow();
    let store = await freshStore();
    store.initPowerStore("test-plugin");
    store.updatePowerSettings({ enabled: true, theme: "fire", density: 2 });
    expect(JSON.parse(win.data.get(KEY)!)).toMatchObject({ enabled: true, theme: "fire", density: 2 });

    store = await freshStore();
    store.initPowerStore("test-plugin");
    expect(store.getPowerSettings()).toMatchObject({ enabled: true, theme: "fire", density: 2, shake: true });
  });

  it.each([
    ["corrupt JSON", "{not json"],
    ["a JSON string", '"hello"'],
    ["null", "null"],
    ["empty", ""],
  ])("falls back to defaults for %s", async (_name, raw) => {
    installWindow().data.set(KEY, raw);
    const store = await freshStore();
    store.initPowerStore("test-plugin");
    expect(store.getPowerSettings()).toEqual(store.DEFAULT_SETTINGS);
  });

  it("keeps only well-typed fields and clamps ranges", async () => {
    installWindow().data.set(
      KEY,
      JSON.stringify({
        enabled: "yes",
        sound: true,
        intensity: "mild",
        theme: "retro",
        density: 99,
        glow: -4,
        bestCombo: 12.9,
      }),
    );
    const store = await freshStore();
    store.initPowerStore("test-plugin");
    expect(store.getPowerSettings()).toMatchObject({
      enabled: false,
      sound: true,
      intensity: "legendary",
      theme: "retro",
      density: store.DENSITY_RANGE.max,
      glow: 0,
      bestCombo: 12,
    });
  });

  it("clamps density below the minimum and drops non-finite numbers", async () => {
    installWindow().data.set(KEY, JSON.stringify({ density: 0.01, glow: "bright", bestCombo: -5 }));
    const store = await freshStore();
    store.initPowerStore("test-plugin");
    expect(store.getPowerSettings()).toMatchObject({ density: store.DENSITY_RANGE.min, glow: 0.7, bestCombo: 0 });
  });

  it("uses defaults when storage reads throw, and keeps updates in memory when writes throw", async () => {
    installWindow({ failReads: true, failWrites: true });
    const store = await freshStore();
    store.initPowerStore("test-plugin");
    expect(store.getPowerSettings()).toEqual(store.DEFAULT_SETTINGS);
    expect(() => store.updatePowerSettings({ enabled: true })).not.toThrow();
    expect(store.getPowerSettings().enabled).toBe(true);
  });

  it("notifies subscribers on update until they unsubscribe", async () => {
    const store = await freshStore();
    store.initPowerStore("test-plugin");
    const listener = vi.fn();
    const unsubscribe = store.subscribePowerSettings(listener);
    store.updatePowerSettings({ shake: false });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.updatePowerSettings({ shake: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("only the first initPowerStore call picks the storage key", async () => {
    const win = installWindow();
    const store = await freshStore();
    store.initPowerStore("test-plugin");
    store.initPowerStore("other-plugin");
    store.updatePowerSettings({ enabled: true });
    expect(win.data.has(KEY)).toBe(true);
    expect(win.data.has("other-plugin:power-mode:settings")).toBe(false);
    expect(store.powerStorageKey("stats")).toBe("test-plugin:power-mode:stats");
  });

  it("applies settings written by another tab, ignores other keys, and stops when aborted", async () => {
    const win = installWindow();
    const store = await freshStore();
    store.initPowerStore("test-plugin");
    const controller = new AbortController();
    store.watchExternalChanges(controller.signal);
    const listener = vi.fn();
    store.subscribePowerSettings(listener);

    win.dispatchStorage("unrelated", JSON.stringify({ enabled: true }));
    expect(store.getPowerSettings().enabled).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    win.dispatchStorage(KEY, JSON.stringify({ enabled: true, theme: "matrix" }));
    expect(store.getPowerSettings()).toMatchObject({ enabled: true, theme: "matrix" });
    expect(listener).toHaveBeenCalledTimes(1);

    win.dispatchStorage(KEY, null);
    expect(store.getPowerSettings()).toEqual(store.DEFAULT_SETTINGS);

    controller.abort();
    win.dispatchStorage(KEY, JSON.stringify({ enabled: true }));
    expect(store.getPowerSettings().enabled).toBe(false);
  });
});
