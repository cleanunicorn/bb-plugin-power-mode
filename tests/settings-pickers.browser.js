/* note: Intensity and Theme pickers behave as radio groups from the keyboard (#48): one Tab stop per group on the selected option, arrows/Home/End move focus and selection with wrapping, no page scroll, accessible names and checked state intact. */
await page.goto("http://127.0.0.1:9146/settings-pickers.html");
await page.evaluate(() =>
  PickersTest.updatePowerSettings({ intensity: "legendary", theme: "neon" }),
);
await page.getByRole("radio", { name: /Legendary/, checked: true }).waitFor();

// Snapshot of focus and selection, read from the DOM and the settings store.
const state = () =>
  page.evaluate(() => {
    const label = (el) =>
      el?.getAttribute("role") === "radio"
        ? el.querySelector("div,span").textContent.trim()
        : el?.id || el?.tagName;
    const group = (name) => {
      const g = document.querySelector(`[role=radiogroup][aria-label=${name}]`);
      const radios = [...g.querySelectorAll("[role=radio]")];
      return {
        checked: radios.filter((r) => r.getAttribute("aria-checked") === "true").map(label),
        tabbable: radios.filter((r) => r.tabIndex === 0).map(label),
        g,
      };
    };
    const intensity = group("Intensity");
    const theme = group("Theme");
    const settings = PickersTest.getPowerSettings();
    return {
      focus: label(document.activeElement),
      focusGroup: document.activeElement.closest("[role=radiogroup]")?.getAttribute("aria-label") ?? null,
      intensity: { checked: intensity.checked, tabbable: intensity.tabbable },
      theme: { checked: theme.checked, tabbable: theme.tabbable },
      settings: { intensity: settings.intensity, theme: settings.theme },
      scrollY: window.scrollY,
    };
  });
const check = (cond, message, s) => {
  if (!cond) throw Error(message + " — state: " + JSON.stringify(s));
};
const expectState = async (want, message) => {
  const s = await state();
  if (want.focus !== undefined) check(s.focus === want.focus, `${message}: focus`, s);
  if (want.intensity !== undefined)
    check(
      s.intensity.checked.join() === want.intensity && s.intensity.tabbable.join() === want.intensity,
      `${message}: Intensity checked/tabbable`,
      s,
    );
  if (want.theme !== undefined)
    check(
      s.theme.checked.join() === want.theme && s.theme.tabbable.join() === want.theme,
      `${message}: Theme checked/tabbable`,
      s,
    );
  if (want.settings) check(JSON.stringify(s.settings) === JSON.stringify(want.settings), `${message}: settings`, s);
  check(s.scrollY === 0, `${message}: page scrolled`, s);
  return s;
};

// 1. Accessible names: both groups and their options are reachable by role.
for (const name of ["Intensity", "Theme"])
  check((await page.getByRole("radiogroup", { name, exact: true }).count()) === 1, `radiogroup ${name}`);
check((await page.getByRole("radio").count()) === 9, "nine radio options");
check((await page.getByRole("radio", { name: /Legendary/, checked: true }).count()) === 1, "Legendary checked");
check((await page.getByRole("radio", { name: /Neon/, checked: true }).count()) === 1, "Neon checked");

// 2. One Tab stop per group, landing on the selected option; Shift+Tab reverses.
await page.locator("#before").focus();
await page.keyboard.press("Tab");
await expectState({ focus: "Legendary", intensity: "Legendary", theme: "🌈 Neon" }, "Tab into Intensity");
await page.keyboard.press("Tab");
await expectState({ focus: "🌈 Neon" }, "Tab into Theme");
await page.keyboard.press("Tab");
await expectState({ focus: "after" }, "Tab past Theme");
await page.keyboard.press("Shift+Tab");
await expectState({ focus: "🌈 Neon" }, "Shift+Tab back to Theme");
await page.keyboard.press("Shift+Tab");
await expectState({ focus: "Legendary" }, "Shift+Tab back to Intensity");
await page.keyboard.press("Shift+Tab");
await expectState({ focus: "before" }, "Shift+Tab out of Intensity");

// 3. Arrows move focus and selection in Intensity, wrapping; Theme untouched.
const neon = { theme: "🌈 Neon" };
await page.keyboard.press("Tab");
await page.keyboard.press("ArrowRight");
await expectState({ focus: "Godlike", intensity: "Godlike", ...neon, settings: { intensity: "godlike", theme: "neon" } }, "Right");
check((await page.getByRole("radio", { name: /Godlike/, checked: true }).count()) === 1, "Godlike announced checked");
check((await page.getByRole("radio", { name: /Legendary/, checked: false }).count()) === 1, "Legendary unchecked");
await page.keyboard.press("ArrowDown");
await expectState({ focus: "Epic", intensity: "Epic", ...neon, settings: { intensity: "epic", theme: "neon" } }, "Down wraps last→first");
await page.keyboard.press("ArrowLeft");
await expectState({ focus: "Godlike", intensity: "Godlike", ...neon, settings: { intensity: "godlike", theme: "neon" } }, "Left wraps first→last");
await page.keyboard.press("ArrowUp");
await expectState({ focus: "Legendary", intensity: "Legendary", ...neon }, "Up");
await page.keyboard.press("Home");
await expectState({ focus: "Epic", intensity: "Epic", ...neon }, "Home");
await page.keyboard.press("End");
await expectState({ focus: "Godlike", intensity: "Godlike", ...neon }, "End");
await page.keyboard.press("Shift+ArrowLeft");
await expectState({ focus: "Legendary", intensity: "Legendary", ...neon }, "Shift+Left still moves");
// Modified arrows are left to the browser and the app.
for (const key of ["Alt+ArrowRight", "Control+ArrowRight", "Meta+ArrowRight"]) {
  await page.keyboard.press(key);
  await expectState({ focus: "Legendary", intensity: "Legendary", ...neon }, `${key} ignored`);
}

// 4. Theme group: same behaviour across its six options; Intensity untouched.
await page.keyboard.press("Tab");
await expectState({ focus: "🌈 Neon" }, "Tab to Theme after arrows");
await page.keyboard.press("ArrowLeft");
await expectState({ focus: "👾 Retro 8-bit", theme: "👾 Retro 8-bit", intensity: "Legendary", settings: { intensity: "legendary", theme: "retro" } }, "Theme Left wraps");
await page.keyboard.press("ArrowRight");
await expectState({ focus: "🌈 Neon", theme: "🌈 Neon", intensity: "Legendary" }, "Theme Right wraps");
await page.keyboard.press("ArrowDown");
await expectState({ focus: "🔥 Inferno", theme: "🔥 Inferno", intensity: "Legendary", settings: { intensity: "legendary", theme: "fire" } }, "Theme Down is linear");
await page.keyboard.press("End");
await expectState({ focus: "👾 Retro 8-bit", theme: "👾 Retro 8-bit", intensity: "Legendary" }, "Theme End");
await page.keyboard.press("Home");
await expectState({ focus: "🌈 Neon", theme: "🌈 Neon", intensity: "Legendary" }, "Theme Home");

// 5. Clicking still selects; the Tab stop follows the new selection.
await page.getByRole("radio", { name: /Matrix/ }).click();
await expectState({ theme: "🟩 Matrix", intensity: "Legendary", settings: { intensity: "legendary", theme: "matrix" } }, "click selects");
await page.locator("#after").focus();
await page.keyboard.press("Shift+Tab");
await expectState({ focus: "🟩 Matrix" }, "Shift+Tab lands on clicked theme");

// 6. A remote change while an option is focused moves the Tab stop; arrows
// continue from the focused option (Matrix) rather than from the new value.
await page.evaluate(() => PickersTest.updatePowerSettings({ theme: "retro" }));
await expectState({ focus: "🟩 Matrix", theme: "👾 Retro 8-bit" }, "remote change");
await page.keyboard.press("ArrowRight");
await expectState({ focus: "🌸 Sakura", theme: "🌸 Sakura", settings: { intensity: "legendary", theme: "sakura" } }, "arrow from focused option");
