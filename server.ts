// Power Mode — backend entry. Everything happens in the browser (app.tsx), so
// the server only announces that the plugin loaded.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");
}
