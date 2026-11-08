# Power Mode — plan history

This file is a historical record. The README is the source of truth for current
features; open work is tracked in GitHub issues. Plans for earlier rounds were not
kept in this repository.

## Progress

- [x] Round 3: agent Power Mode, themes, achievements and stats (details below)
- [x] Paste ordnance (#8, merged in PR #9): 9 tiers scaled by paste length, lucky
  drops, theme skins, event and pending caps, regression fixture
  `tests/paste-ordnance.browser.js`
- [x] Docs cleanup (#16): README is the single feature list; overview removed; data
  and limitations documented

Deferred / not done
- [ ] Boss fight (not selected in round 3)
- [ ] Round 3 live check in a browser: a headless session was attempted, but no
  completed check was recorded. Later browser regression fixtures live in `tests/`.

## Round 3 plan (archived)

- [x] Pick features with user: Agent Power Mode, Themes, Achievements & stats
- [x] Research: agent output detection (sidebar thread status + timeline DOM `[data-timeline-items]`)
- [x] Particles slider (density 0.25×–3×) + Glow slider (bloom strength) — store + settings UI
- [x] Bloom layer: quarter-res canvas upscaled by the browser, restores strong glow cheaply
- [x] Themes: Neon (default), Fire, Matrix, Sakura, Cyberpunk, Retro 8-bit — palette + particle shape
- [x] Achievements & stats: lifetime chars, sessions, WPM gauge on HUD, unlock toasts, list in settings
- [x] Agent Power Mode: overlay tracks running threads → engine watches timeline text growth → sparks + agent combo; turn-finish celebration
- [x] Typecheck, build, reload
- [x] Docs: README / skill updated
- [x] Keep text clear: effects sink below the text box's text (underlay canvas), erase fallback
- [x] Light theme: auto-detect (.dark class → bg luminance → OS), ink rendering (normal blend, saturated darker sprites/colors, dark bolt core), subtler bloom, light HUD/slam/flash styles
- [ ] Live check in a browser (headless session attempted; see above)
