/* note: vibration on big moments — milestone and COMBO LOST buzz, plain typing does not, `haptics: false` silences everything (real timers, ~10s). */
await page.goto("http://127.0.0.1:9146/power-engine.html");
await page.evaluate(() => {
  window.buzzes = [];
  // Badge unlocks also buzz and depend on stats left by other fixtures; only the combo events are asserted here.
  const unlock = new Set(Object.values(PowerTest.UNLOCK_HAPTICS).map((p) => JSON.stringify(p)));
  PowerTest.setVibrate((pattern) => { if (!unlock.has(JSON.stringify(pattern))) window.buzzes.push(pattern); return true; });
  PowerTest.resetPowerStats();
  PowerTest.updatePowerSettings({ enabled: true, sound: false, haptics: true, reduceMotion: false, bestCombo: 500 });
});
await page.waitForTimeout(1800);
await page.evaluate(() => { window.buzzes.length = 0; });
const field = page.getByRole("textbox", { name: "Textarea", exact: true });
await field.click();
// Under the first milestone: ordinary keystrokes never vibrate.
await page.keyboard.type("abcdefgh", { delay: 5 });
await page.waitForTimeout(100);
await page.evaluate(() => {
  if (window.buzzes.length) throw Error("Plain typing vibrated: " + JSON.stringify(window.buzzes));
});
// Crossing ×10 buzzes once with the milestone pattern; letting a 25+ streak die buzzes COMBO LOST.
await page.keyboard.type("abcdefghij".repeat(3), { delay: 5 });
await page.waitForTimeout(100);
await page.evaluate(() => {
  const want = JSON.stringify(PowerTest.milestoneHaptic(0));
  if (!window.buzzes.some((b) => JSON.stringify(b) === want)) throw Error("Milestone did not vibrate: " + JSON.stringify(window.buzzes));
  window.buzzes.length = 0;
});
await page.waitForTimeout(3300);
await page.evaluate(() => {
  const want = JSON.stringify([...PowerTest.HAPTICS.comboLost]);
  if (window.buzzes.filter((b) => JSON.stringify(b) === want).length !== 1) throw Error("COMBO LOST did not vibrate once: " + JSON.stringify(window.buzzes));
  window.buzzes.length = 0;
  PowerTest.updatePowerSettings({ haptics: false });
});
// With haptics off the same run is silent.
await page.keyboard.type("abcdefghij".repeat(3), { delay: 5 });
await page.waitForTimeout(3400);
await page.evaluate(() => {
  if (window.buzzes.length) throw Error("haptics: false still vibrated: " + JSON.stringify(window.buzzes));
  PowerTest.updatePowerSettings({ haptics: true });
  PowerTest.setVibrate(null);
});
