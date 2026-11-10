/* note: COMBO LOST slam, clutch saves, record crown and fireworks, paste chains, unlock banner and its particles-off gate (real timers, ~20s). */
await page.goto("http://127.0.0.1:9146/power-engine.html");
await page.evaluate(() => {
  const t = PowerTest;
  window.slams = [];
  window.pops = [];
  const append = document.documentElement.appendChild.bind(document.documentElement);
  document.documentElement.appendChild = (el) => {
    if (el.classList?.contains("pm-slam")) window.slams.push(el.textContent);
    if (el.classList?.contains("pm-pop")) window.pops.push(el.textContent);
    if (el.classList?.contains("pm-badge")) window.badges = (window.badges ?? 0) + 1;
    return append(el);
  };
  t.updatePowerSettings({ enabled: true, sound: false, particles: true, reduceMotion: false, bestCombo: 0 });
  t.resetPowerStats();
});
await page.waitForTimeout(1800);
const field = page.getByRole("textbox", { name: "Textarea", exact: true });
// A short combo ends quietly.
await field.click();
await page.keyboard.type("abcde", { delay: 5 });
await page.waitForTimeout(3300);
await page.evaluate(() => {
  if (window.slams.some((s) => s.includes("COMBO LOST"))) throw Error("Short combo must not announce a loss");
  window.slams.length = 0;
  PowerTest.updatePowerSettings({ bestCombo: 500 });
});
// A 30-key streak under the record ends with COMBO LOST.
await page.keyboard.type("abcdefghij".repeat(3), { delay: 5 });
await page.waitForTimeout(3300);
await page.evaluate(() => {
  if (!window.slams.some((s) => s.includes("COMBO LOST"))) throw Error("Lost streak did not slam: " + JSON.stringify(window.slams));
});
// A keystroke in the last 30% of the timer is a clutch save; a quick one is not.
await page.evaluate(() => { window.pops.length = 0; });
await page.keyboard.type("abcdefghijkl", { delay: 5 });
await page.waitForTimeout(2400);
await page.keyboard.type("a");
await page.waitForTimeout(100);
await page.evaluate(() => {
  if (window.pops.join() !== "CLUTCH!") throw Error("Expected one clutch callout, got " + JSON.stringify(window.pops));
  if (PowerTest.getPowerStats().clutches !== 1) throw Error("Clutch save was not counted");
  if (!document.querySelector(".pm-hud-next")?.textContent.includes("TO ON FIRE")) throw Error("HUD lacks the next milestone");
});
await page.waitForTimeout(3300);
// Beating the record mid-combo crowns the HUD; ending it launches fireworks.
await page.evaluate(() => { window.slams.length = 0; window.pops.length = 0; PowerTest.updatePowerSettings({ bestCombo: 26 }); });
await page.keyboard.type("abcdefghij".repeat(3), { delay: 5 });
await page.waitForTimeout(100);
await page.evaluate(() => {
  if (!window.pops.includes("NEW BEST!")) throw Error("No callout on passing the record: " + JSON.stringify(window.pops));
  if (!document.querySelector(".pm-hud").classList.contains("pm-record")) throw Error("HUD is not crowned");
});
await page.waitForTimeout(3100);
await page.evaluate(() => {
  if (!window.slams.some((s) => s.includes("NEW RECORD · +4"))) throw Error("Record slam lacks the margin: " + JSON.stringify(window.slams));
  if (!(PowerTest.ordnanceDebug().kinds.shell > 0)) throw Error("A new record launches fireworks");
  if (document.querySelector(".pm-hud").classList.contains("pm-record")) throw Error("Crown must clear with the combo");
});
// Two ordnance pastes within five seconds chain.
await page.evaluate(() => {
  window.pops.length = 0;
  const el = document.querySelector("textarea");
  const paste = () => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "x".repeat(300));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: null }));
  };
  PowerTest.setOrdnanceRandom(() => 0.99);
  paste();
  paste();
  PowerTest.setOrdnanceRandom(null);
  if (!window.pops.includes("CHAIN ×2")) throw Error("No chain callout: " + JSON.stringify(window.pops));
  if (PowerTest.getPowerStats().bestPasteChain !== 2) throw Error("Chain was not recorded");
});
await page.waitForTimeout(300);
// Unlock banner appears with particles on, never with them off.
await page.evaluate(() => {
  window.badges = 0;
  PowerTest.recordStats((s) => ({ ...s, bestPasteTier: 5 }));
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  if (window.badges !== 1) throw Error("Expected one banner, got " + window.badges);
  if (!document.querySelector(".pm-badge")?.textContent.includes("Bombardier")) throw Error("Banner lacks the badge title");
  PowerTest.updatePowerSettings({ particles: false });
  window.badges = 0;
  PowerTest.recordStats((s) => ({ ...s, luckyDrops: 1 }));
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  if (window.badges !== 0) throw Error("Banner shown with particles off");
});
return { passed: true };
