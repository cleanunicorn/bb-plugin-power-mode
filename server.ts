// Power Mode — backend entry. The effects run in the browser (app.tsx); the
// server stores the user's settings in bb's plugin KV so they survive cleared
// browser storage and follow the user to every browser and device that opens
// this bb server.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { sanitizeSettings } from "./lib/power-settings";

/** KV key holding the saved settings document. */
export const SETTINGS_KEY = "settings";
/** Realtime channel announcing that the saved settings changed. */
export const SETTINGS_CHANGED_CHANNEL = "settings-changed";

// Settings documents are tiny; this only bounds what a client may send.
const settingsInput = z.record(z.string(), z.unknown()).refine((value) => JSON.stringify(value).length <= 8_192, {
  message: "settings document is too large",
});
const settingsOutput = z.record(z.string(), z.unknown());

export const rpcContract = defineRpcContract({
  "settings.get": {
    input: z.null(),
    output: z.object({ settings: settingsOutput.nullable() }).strict(),
  },
  "settings.set": {
    input: z.object({ settings: settingsInput, clientId: z.string().max(64).optional() }).strict(),
    output: z.object({ settings: settingsOutput }).strict(),
  },
});

export default async function plugin(bb: BbPluginApi) {
  const { kv } = bb.storage;

  bb.rpc.register(rpcContract, {
    async "settings.get"() {
      const stored = await kv.get<unknown>(SETTINGS_KEY);
      // Stored values are re-sanitized so older or hand-edited rows stay well typed.
      return { settings: stored == null ? null : { ...sanitizeSettings(stored) } };
    },
    async "settings.set"({ settings, clientId }) {
      const clean = { ...sanitizeSettings(settings) };
      await kv.set(SETTINGS_KEY, clean);
      bb.realtime.publish(SETTINGS_CHANGED_CHANNEL, { clientId: clientId ?? null });
      return { settings: clean };
    },
  });

  bb.log.info("loaded");
}
