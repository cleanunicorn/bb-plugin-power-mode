import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installWindow } from "./window-stub";

const KEY = "test-plugin:power-mode:settings";

async function freshModules() {
  vi.resetModules();
  const store = await import("../../lib/power-store");
  const sync = await import("../../lib/settings-sync");
  return { store, ...sync };
}

/** An in-memory server copy with controllable failures and latency. */
function fakeRemote(initial: Record<string, unknown> | null = null) {
  let saved: unknown = initial;
  const remote = {
    loads: 0,
    saves: [] as Record<string, unknown>[],
    failLoads: 0,
    failSaves: 0,
    loadGate: null as Promise<void> | null,
    get saved() {
      return saved;
    },
    set saved(value) {
      saved = value;
    },
    async load() {
      remote.loads++;
      if (remote.loadGate) await remote.loadGate;
      if (remote.failLoads > 0) {
        remote.failLoads--;
        throw new Error("offline");
      }
      return saved === null ? null : structuredClone(saved);
    },
    async save(settings: object) {
      if (remote.failSaves > 0) {
        remote.failSaves--;
        throw new Error("offline");
      }
      saved = structuredClone(settings);
      remote.saves.push(saved as Record<string, unknown>);
    },
  };
  return remote;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("settings sync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("applies the server copy over the local copy on start", async () => {
    const win = installWindow();
    win.data.set(KEY, JSON.stringify({ theme: "fire", enabled: false }));
    const { store, startSettingsSync } = await freshModules();
    store.initPowerStore("test-plugin");
    const remote = fakeRemote({ theme: "matrix", enabled: true, density: 2 });
    const sync = startSettingsSync(remote, { signal: new AbortController().signal });
    await sync.hydrated;

    expect(store.getPowerSettings()).toMatchObject({ theme: "matrix", enabled: true, density: 2 });
    expect(JSON.parse(win.data.get(KEY)!)).toMatchObject({ theme: "matrix", enabled: true });
    expect(remote.saves).toHaveLength(0);
  });

  it("uploads the local copy when the server has nothing saved yet", async () => {
    installWindow().data.set(KEY, JSON.stringify({ theme: "sakura", sound: true }));
    const { store, startSettingsSync } = await freshModules();
    store.initPowerStore("test-plugin");
    const remote = fakeRemote(null);
    const sync = startSettingsSync(remote, { signal: new AbortController().signal });
    await sync.hydrated;

    expect(remote.saves).toHaveLength(1);
    expect(remote.saved).toMatchObject({ theme: "sakura", sound: true });
  });

  it("waits for the store to load before reading the server", async () => {
    installWindow();
    const { store, startSettingsSync } = await freshModules();
    const remote = fakeRemote({ theme: "retro" });
    startSettingsSync(remote, { signal: new AbortController().signal });
    await vi.advanceTimersByTimeAsync(0);
    expect(remote.loads).toBe(0);

    store.initPowerStore("test-plugin");
    await vi.advanceTimersByTimeAsync(0);
    expect(remote.loads).toBe(1);
    expect(store.getPowerSettings().theme).toBe("retro");
  });

  it("keeps a change made while the server copy was loading and uploads it", async () => {
    installWindow();
    const { store, startSettingsSync } = await freshModules();
    store.initPowerStore("test-plugin");
    const remote = fakeRemote({ theme: "matrix" });
    let open!: () => void;
    remote.loadGate = new Promise((resolve) => (open = resolve));
    const sync = startSettingsSync(remote, { signal: new AbortController().signal });
    await vi.advanceTimersByTimeAsync(0);

    store.updatePowerSettings({ theme: "cyberpunk" });
    open();
    await sync.hydrated;

    expect(store.getPowerSettings().theme).toBe("cyberpunk");
    expect(remote.saved).toMatchObject({ theme: "cyberpunk" });
  });

  it("merges only the fields changed before hydration over the server copy", async () => {
    // A new device: local defaults, a combo record before the server answered.
    installWindow();
    const { store, startSettingsSync } = await freshModules();
    store.initPowerStore("test-plugin");
    const remote = fakeRemote({ theme: "matrix", enabled: true, density: 2, bestCombo: 10 });
    remote.failLoads = 1;
    const sync = startSettingsSync(remote, { signal: new AbortController().signal, retryMs: 100 });
    await vi.advanceTimersByTimeAsync(0);

    store.updatePowerSettings({ bestCombo: 42 });
    await vi.advanceTimersByTimeAsync(100);
    await sync.hydrated;

    const expected = { theme: "matrix", enabled: true, density: 2, bestCombo: 42 };
    expect(store.getPowerSettings()).toMatchObject(expected);
    expect(remote.saved).toMatchObject(expected);
  });

  it("debounces local changes into one upload", async () => {
    installWindow();
    const { store, startSettingsSync } = await freshModules();
    store.initPowerStore("test-plugin");
    const remote = fakeRemote({ theme: "neon" });
    const sync = startSettingsSync(remote, { signal: new AbortController().signal, debounceMs: 400 });
    await sync.hydrated;

    store.updatePowerSettings({ density: 1.5 });
    store.updatePowerSettings({ density: 2 });
    store.updatePowerSettings({ density: 2.5 });
    await vi.advanceTimersByTimeAsync(399);
    expect(remote.saves).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(remote.saves).toHaveLength(1);
    expect(remote.saved).toMatchObject({ density: 2.5 });
  });

  it("does not echo settings applied from the server back to it", async () => {
    installWindow();
    const { store, startSettingsSync } = await freshModules();
    store.initPowerStore("test-plugin");
    const remote = fakeRemote({ theme: "neon" });
    const sync = startSettingsSync(remote, { signal: new AbortController().signal });
    await sync.hydrated;

    remote.saved = { theme: "fire", glow: 0.2 };
    sync.refresh();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(store.getPowerSettings()).toMatchObject({ theme: "fire", glow: 0.2 });
    expect(remote.saves).toHaveLength(0);
  });

  it("ignores a refresh while a local change is waiting to upload", async () => {
    installWindow();
    const { store, startSettingsSync } = await freshModules();
    store.initPowerStore("test-plugin");
    const remote = fakeRemote({ theme: "neon" });
    const sync = startSettingsSync(remote, { signal: new AbortController().signal, debounceMs: 400 });
    await sync.hydrated;

    store.updatePowerSettings({ theme: "retro" });
    remote.saved = { theme: "fire" };
    sync.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getPowerSettings().theme).toBe("retro");

    await vi.advanceTimersByTimeAsync(400);
    expect(remote.saved).toMatchObject({ theme: "retro" });
  });

  it("retries failed loads and uploads with backoff", async () => {
    installWindow();
    const { store, startSettingsSync } = await freshModules();
    store.initPowerStore("test-plugin");
    const remote = fakeRemote({ theme: "matrix" });
    remote.failLoads = 2;
    const onError = vi.fn();
    const sync = startSettingsSync(remote, { signal: new AbortController().signal, retryMs: 100, onError });

    await vi.advanceTimersByTimeAsync(100); // first retry
    expect(store.getPowerSettings().theme).toBe("neon");
    await vi.advanceTimersByTimeAsync(200); // second retry, doubled
    await sync.hydrated;
    expect(store.getPowerSettings().theme).toBe("matrix");
    expect(onError).toHaveBeenCalledTimes(2);

    remote.failSaves = 1;
    store.updatePowerSettings({ sound: true });
    await vi.advanceTimersByTimeAsync(400);
    expect(remote.saves).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(remote.saved).toMatchObject({ sound: true });
  });

  it("flushes a pending change when stopped and then stops listening", async () => {
    installWindow();
    const { store, startSettingsSync } = await freshModules();
    store.initPowerStore("test-plugin");
    const remote = fakeRemote({ theme: "neon" });
    const controller = new AbortController();
    const sync = startSettingsSync(remote, { signal: controller.signal, debounceMs: 400 });
    await sync.hydrated;

    store.updatePowerSettings({ shake: false });
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(remote.saves).toHaveLength(1);
    expect(remote.saved).toMatchObject({ shake: false });

    store.updatePowerSettings({ shake: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(remote.saves).toHaveLength(1);
  });
});
