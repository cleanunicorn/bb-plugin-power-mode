---
name: power-mode
description: Explain or troubleshoot the Power Mode plugin, which adds particles, shake, combo counter, and lightning effects while typing in bb. Use when the user asks how to turn Power Mode on or off or tune its effects.
---

# Power Mode

Power Mode is a frontend-only plugin. It has no CLI commands or agent tools.

- **Toggle:** the ⚡ button in the sidebar footer, or "Power Mode: Toggle" in the
  command palette (default shortcut Mod+Alt+P).
- **Tune:** Settings → Power Mode — intensity (Epic / Legendary / Godlike), theme
  (Neon, Inferno, Matrix, Sakura, Cyberpunk, Retro 8-bit), Particles and Glow sliders,
  editor/screen shake, flying letters, lightning, Agent Power Mode, sound, plus
  lifetime stats and achievements.
- **Agent Power Mode** watches the transcript only while some thread is running.
- Settings are saved on the bb server (plugin KV, key `settings`) and follow the user
  to every browser and device on that server; each browser keeps a localStorage copy
  for instant start. Read them with `bb plugin rpc call <plugin id> settings.get`.
  Stats and achievements stay in the browser's localStorage only and are not yet
  synchronized between open windows, so one window can overwrite another's progress
  (issue #10).
  Don't change the user's settings through RPC unless they ask.
- It reacts to `input` events in text fields, textareas, and contenteditable editors;
  password fields are ignored.
- **Paste ordnance:** pasting text drops theme-skinned weapons near the caret, scaled
  by the paste length over 9 tiers: firecracker (< 50 chars), dynamite, cluster bomb,
  rockets, carpet bombing (2k+), orbital strike, meteor shower, tactical nuke (60k+),
  singularity (≥ 200k). Tiers 7–9 run one at a time. Pastes with no text (images,
  files) get the plain paste burst. There is no separate setting: it follows
  enabled/intensity/lightning/screen shake/sound. A "Reduce motion" setting (default: follow the OS `prefers-reduced-motion`, overridable) turns off shake, full-screen flashes and lightning. Terminal pastes are ignored.
