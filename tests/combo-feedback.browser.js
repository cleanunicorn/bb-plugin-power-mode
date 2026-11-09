/* note: COMBO LOST slam, unlock banner and the particles-off banner gate (real timers, ~10s). */
await page.goto("http://127.0.0.1:9146/power-engine.html");
await page.evaluate(() => {
  const t = PowerTest;
  window.slams = [];
  const append = document.documentElement.appendChild.bind(document.documentElement);
  document.documentElement.appendChild = (el) => {
    if (el.classList?.contains("pm-slam")) window.slams.push(el.textContent);
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
