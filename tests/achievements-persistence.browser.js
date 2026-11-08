/* note: Verify old saves, pin/title reload, reset, graphemes, and IME input. */
await page.goto("http://127.0.0.1:9146/achievements.html");
await snapshot({ interactive: true });
await snapshot();
await page.evaluate(() => {
  const old = {
    chars: 1234,
    bestCombo: 100,
    unlocked: Object.fromEntries(
      AchievementTest.ACHIEVEMENTS.filter((a) =>
        a.requires.includes("legacy-stats"),
      ).map((a, i) => [a.id, 123 + i]),
    ),
  };
  localStorage.setItem(
    "achievement-fixture:power-mode:stats",
    JSON.stringify(old),
  );
});
await page.reload();
await snapshot({ interactive: true });
await snapshot();
await page.evaluate(() => {
  const t = AchievementTest,
    s = t.getPowerStats();
  if (s.chars !== 1234 || s.unlocked["first-spark"] !== 123)
    throw Error("Legacy save lost");
  if (Object.keys(s.unlocked).length !== 19) throw Error("Legacy IDs lost");
  if (s.collection.replies !== 0 || Object.keys(s.collection.biomes).length)
    throw Error("Invented history");
  t.setCollectionPreference({ pin: "combo-50", title: "Rhythm Mage" });
  t.flushPowerStats();
});
await page.reload();
await snapshot({ diff: true });
await page.evaluate(() => {
  const t = AchievementTest,
    c = t.getCollection();
  if (c.saved.pin !== "combo-50" || c.saved.title !== "Rhythm Mage")
    throw Error("Preference reload failed");
  if (c.session.discoveries.length) throw Error("Reload replayed discoveries");
  if (t.graphemes("👨‍👩‍👧‍👦🦆e\u0301").length !== 3)
    throw Error("Wrong grapheme count");
  const achievements = t.ACHIEVEMENTS;
  for (const [category, target, title] of [
    ["Human", 5, "Rhythm Mage"],
    ["Agent", 5, "Co-Pilot"],
    ["Together", 3, "Duet Captain"],
  ]) {
    const ids = achievements
      .filter((a) => !a.hidden && a.category === category)
      .map((a) => a.id);
    const mock = {
      ...t.getPowerStats(),
      unlocked: Object.fromEntries(
        ids.slice(0, target - 1).map((id) => [id, 1]),
      ),
    };
    if (t.availableTitles(mock).includes(title)) throw Error("Early title");
    mock.unlocked[ids[target - 1]] = 1;
    if (!t.availableTitles(mock).includes(title)) throw Error("Missing title");
  }
  const secrets=achievements.filter(a=>a.hidden).slice(0,5);
  const mock={...t.getPowerStats(),unlocked:Object.fromEntries(secrets.slice(0,4).map(a=>[a.id,1]))};
  if(t.availableTitles(mock).includes('Secret Cartographer'))throw Error('Early secret title');
  mock.unlocked[secrets[4].id]=1;
  if(!t.availableTitles(mock).includes('Secret Cartographer'))throw Error('Missing secret title');
  t.resetPowerStats();
  document.getElementById("a").value = "";
});
const a = page.getByRole("textbox", { name: "Composer A", exact: true });
await a.click();
// insertText has no physical-key or IME timing evidence: do not invent provenance.
await page.keyboard.insertText("🦆");
await page.evaluate(() => {
  const t = AchievementTest,
    c = t.getCollection();
  if (c.draft?.duck || c.window || c.combo)
    throw Error("Unknown provenance counted");
  t.submit();
  t.reply();
  if (t.getPowerStats().unlocked["rubber-duck"])
    throw Error("Unknown provenance duck awarded");
  const raw = localStorage.getItem("achievement-fixture:power-mode:stats");
  if (raw.includes("🦆") || raw.includes("word word"))
    throw Error("Content persisted");
  t.resetPowerStats();
  if (
    t.getCollection().saved.pin ||
    t.getCollection().saved.title ||
    t.getCollection().session.discoveries.length
  )
    throw Error("Reset incomplete");
});
await snapshot({ diff: true });
return { passed: true };
