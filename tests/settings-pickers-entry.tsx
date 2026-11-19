import React from "react";
import { createRoot } from "react-dom/client";
import { SettingsPickers } from "../app";
import {
  getPowerSettings,
  initPowerStore,
  updatePowerSettings,
} from "../lib/power-store";

initPowerStore("settings-pickers-fixture");
createRoot(document.getElementById("pickers")!).render(<SettingsPickers />);

export { getPowerSettings, updatePowerSettings };
