# Power Mode — round 3 plan

## Progress

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
- [ ] Live check in a browser (headless session attempted)

Deferred
- [ ] Boss fight (not selected)
