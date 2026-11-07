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
- State lives in each browser window's localStorage, so it is per device and syncs
  across tabs in the same browser. An agent cannot toggle it.
- It reacts to `input` events in text fields, textareas, and contenteditable editors;
  password fields are ignored.
