/* note: Verify coalesced static feedback, disabled particles and reset cancellation. */
await page.addInitScript(() => {
  let id = 0;
  const pending = new Map();
  window.setTimeout = (callback) => {
    pending.set(++id, callback);
    return id;
  };
  window.clearTimeout = (id) => pending.delete(id);
  window.flushTestTimers = () => {
    const callbacks = [...pending.values()];
    pending.clear();
    for (const fn of callbacks) fn();
  };
});
await page.emulateMedia({ reducedMotion: "reduce" });
await page.goto("http://127.0.0.1:9146/power-engine.html");
await snapshot({ interactive: true });
await snapshot();
await page.evaluate(() => {
  const t = PowerTest;
  t.updatePowerSettings({
    particles: false,
    glow: 0,
    sound: false,
    shake: false,
    screenShake: false,
    lightning: false,
  });
  t.resetPowerStats();
  window.powerTestToasts = [];
  const event = {
    now: performance.now(),
    wall: Date.now(),
    thread: "t",
    theme: "neon",
    quiet: true,
    silent: true,
  };
  t.recordAchievementEvent({ ...event, type: "start", turn: "r" });
  t.recordAchievementEvent({
    ...event,
    type: "complete",
    turn: "r",
    status: "completed",
    fresh: true,
    words: 20,
  });
});
// Predicate wait, no fixed sleep: one timer emits the coalesced notification.
await page.evaluate(() => window.flushTestTimers());
await page.evaluate(() => {
  const calls = window.powerTestToasts;
  if (!calls[0].message.includes("3 achievements"))
    throw Error("Unlocks not coalesced");
  if (calls[0].options.action.label !== "View gallery")
    throw Error("Missing gallery action");
  if (PowerTest.ordnanceDebug()?.particles > 0)
    throw Error("Particles rendered while off");
  const before = calls.length;
  PowerTest.recordStats((s) => ({
    ...s,
    chars: 100000,
    bestCombo: 500,
    bestWpm: 140,
  }));
  PowerTest.resetPowerStats();
  window.flushTestTimers();
  if (window.powerTestToasts.length !== before)
    throw Error("Reset left a pending unlock toast");
});
await page.waitForFunction(
  () => Object.keys(PowerTest.getPowerStats().unlocked).length === 0,
);
await snapshot({ diff: true });
return { passed: true };
