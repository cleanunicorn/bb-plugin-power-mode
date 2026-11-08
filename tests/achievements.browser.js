/* note: Verify native input provenance, composer isolation, all collection paths and secret-safe gallery. */
await page.goto("http://127.0.0.1:9146/achievements.html");
await snapshot({ interactive: true });
await snapshot();
await page.evaluate(() => AchievementTest.resetPowerStats());
// Inspect exact native elements, then exercise trusted keyboard input.
const a = page.getByRole("textbox", { name: "Composer A", exact: true });
await a.click();
await page.keyboard.type("x".repeat(300));
await page.evaluate(() =>
  document.getElementById("a").setSelectionRange(0, 30),
);
await page.keyboard.press("Backspace");
await page.keyboard.type("y");
await page.evaluate(() => {
  if (!AchievementTest.getPowerStats().unlocked["less-better"])
    throw Error("Human revision not awarded");
});
await page.evaluate(() => {
  AchievementTest.resetPowerStats();
  document.getElementById("a").value = "";
});
await a.click();
await page.keyboard.type("x".repeat(42));
await page.evaluate(() => {
  if (AchievementTest.getPowerStats().unlocked["dont-panic"])
    throw Error("Combo awarded early");
  AchievementTest.advance(3000);
});
await page.getByText("Don't Panic", { exact: true }).waitFor();
await page.evaluate(() => {
  if (!AchievementTest.getPowerStats().unlocked["dont-panic"])
    throw Error("Secret not awarded");
  const text = document.getElementById("gallery").textContent;
  for (const secret of [
    "There Is No Spoon",
    "Rubber Duck Has Entered the Chat",
    "Here Be Dragons",
  ])
    if (text.includes(secret)) throw Error("Secret leaked: " + secret);
  AchievementTest.resetPowerStats();
  document.getElementById("a").value = "";
});
await page.getByRole("textbox", { name: "Queued editor", exact: true }).click();
await page.keyboard.type("q".repeat(50));
await page.locator("#settings").click();
await page.keyboard.type("s".repeat(50));
await page.getByRole("textbox", { name: "Terminal", exact: true }).click();
await page.keyboard.type("t".repeat(50));
await page.evaluate(() => {
  if (AchievementTest.getCollection().draft)
    throw Error("Unrelated editor counted");
});
await a.click();
await page.keyboard.type("hello".repeat(8));
await page.evaluate(() => {
  AchievementTest.submit();
  document.getElementById("a").value = "";
  AchievementTest.reply("a", 20);
});
await page.getByText("Pass the Baton", { exact: true }).waitFor();
await page.evaluate(() => {
  const s = AchievementTest.getPowerStats();
  for (const id of ["hello-copilot", "bento-box", "pass-baton"])
    if (!s.unlocked[id]) throw Error("Missing " + id);
  if (AchievementTest.getCollection().session.rallies.a !== 1)
    throw Error("Baton sequence lost");
  AchievementTest.reply("a", 20);
  if (AchievementTest.getCollection().session.rallies.a !== 1)
    throw Error("Input reused");
});
await page.getByRole("textbox", { name: "Composer B", exact: true }).click();
await page.keyboard.type("b".repeat(40));
await page.evaluate(() => {
  if (AchievementTest.getCollection().draft.thread !== "b")
    throw Error("Wrong pane identity");
  AchievementTest.submit("b");
  AchievementTest.reply("a");
  if (AchievementTest.getCollection().session.rallies.b)
    throw Error("Cross-thread exchange");
  AchievementTest.reply("b");
  if (AchievementTest.getCollection().session.rallies.b !== 1)
    throw Error("Contenteditable exchange missing");
});
await snapshot({ diff: true });
await page.getByRole("checkbox", { name: "Unlocked only" }).check();
await page
  .getByText("Your session postcard", { exact: true })
  .scrollIntoViewIfNeeded();
await snapshot({ diff: true });
const proof = await screenshot({ kind: "proof", fullPage: true });
return { passed: true, proof };
