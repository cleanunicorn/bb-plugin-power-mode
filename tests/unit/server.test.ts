import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, { SETTINGS_CHANGED_CHANNEL, SETTINGS_KEY } from "../../server";
import { DEFAULT_SETTINGS } from "../../lib/power-settings";

async function load() {
  const host = createFakePluginHost({ pluginId: "power-mode-test" });
  await plugin(host.bb);
  return host;
}

describe("server settings storage", () => {
  it("returns null before anything was saved", async () => {
    const { harness } = await load();
    await expect(harness.behavior.callRpc("settings.get", null)).resolves.toEqual({ settings: null });
  });

  it("saves sanitized settings, announces the change, and returns them", async () => {
    const { bb, harness } = await load();
    const result = await harness.behavior.callRpc("settings.set", {
      settings: { theme: "fire", density: 50, enabled: true, bogus: 1 },
      clientId: "abc",
    });
    expect(result).toEqual({ settings: { ...DEFAULT_SETTINGS, theme: "fire", density: 3, enabled: true } });
    expect(await bb.storage.kv.get(SETTINGS_KEY)).toEqual(result.settings);
    expect(harness.realtimeSignals.at(-1)).toMatchObject({
      channel: SETTINGS_CHANGED_CHANNEL,
      payload: { clientId: "abc" },
    });
    await expect(harness.behavior.callRpc("settings.get", null)).resolves.toEqual(result);
  });

  it("keeps settings across a plugin reload", async () => {
    const { harness } = await load();
    await harness.behavior.callRpc("settings.set", { settings: { theme: "sakura" } });
    const reloaded = await harness.lifecycle.reload(plugin);
    const { settings } = await reloaded.harness.behavior.callRpc("settings.get", null);
    expect(settings).toMatchObject({ theme: "sakura" });
  });

  it("re-sanitizes a malformed stored row", async () => {
    const { bb, harness } = await load();
    await bb.storage.kv.set(SETTINGS_KEY, { theme: "nope", glow: "bright" });
    await expect(harness.behavior.callRpc("settings.get", null)).resolves.toEqual({ settings: DEFAULT_SETTINGS });
  });

  it("rejects non-object and oversized input", async () => {
    const { harness } = await load();
    await expect(harness.behavior.callRpc("settings.set", { settings: "x" })).rejects.toThrow();
    await expect(
      harness.behavior.callRpc("settings.set", { settings: { junk: "x".repeat(10_000) } }),
    ).rejects.toThrow();
  });
});
