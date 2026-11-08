# Power Mode demo video

[`docs/media/power-mode-demo.mp4`](media/power-mode-demo.mp4) (≈ 68 s, 1280×800, no audio, ≈ 5 MB) shows the real plugin running in the bb UI. This page records how it was made, how to verify it, and how to replace it.

## What it shows

| # | Segment | What to look for |
|---|---|---|
| 1 | Enable | Power Mode off → hover the ⚡ button in the sidebar footer (tooltip "Toggle Power Mode") → click. Caption mentions Mod+Alt+P. |
| 2 | Typing | Three sentences in a new-thread composer: caret particles and bloom, flying letters, editor shake, combo counter with WPM gauge and tier titles, milestone slams (NICE! → UNSTOPPABLE! → GODLIKE!) with achievement toasts, then Backspace (small red shards). **Enter shockwave is not shown**, see "Known limitation". |
| 3 | Settings | Settings → Power Mode: Theme Neon → Inferno, **Particles** slider nudged from 1.0× to 2.5× with the arrow keys, back to a thread, typing in the new theme. |
| 4 | Paste | 1,500 characters of lorem ipsum pasted with Ctrl+V → ordnance drop. Seen: **tier 4 rocket barrage** (Inferno-skinned, "1,500 CHARS" slam). One paste in 12 is a lucky drop that upgrades the tier, so a re-record can show a different tier. |
| 5 | Agent | Prompt `Describe a thunderstorm in 200 words.` sent in a disposable project; the thread stays on screen through streaming sparks, the **AGENT IS COOKING** word combo and the **TURN COMPLETE** finale (the finale reported a 139-word reply this take; Haiku's length varies run to run). |

## How it was captured

| | |
|---|---|
| Capture date | 2026-11-08 |
| bb | 0.49.0 (web UI served by the local bb server, `http://127.0.0.1:38886`) |
| Plugin | this repo at `017a745` (`main` after PR #22), installed via `bb plugin update power-mode`; confirmed with `bb plugin source power-mode` |
| Host | Ubuntu 26.04.1 LTS, Linux 6.17 |
| Browser / backend | Google Chrome 155 (headless, `/usr/bin/google-chrome`) driven by `playwright-core` 1.65.0 with `recordVideo` (not the `bb browser-automation` backend: it only returns JPEG screenshots, so it can't record video) |
| Window | 1280×800, fresh browser profile (so the recording does not touch anyone's real Power Mode stats or settings) |
| Plugin settings | Defaults except the theme: intensity Legendary, theme Neon → Inferno (segment 3), Particles 1.0× → 2.5×, Glow 70 %, Agent Power Mode **on**, sound **off** |
| Agent model | Claude Code · Haiku 5.5 · Low reasoning (cheap, ~9 s reply) |
| Effective frame rate | Source is Playwright's 25 fps screencast; the MP4 is re-timed to 30 fps, so ≈ 25 distinct frames per second during active effects (checked with `mpdecimate`) |

**Known limitation.** The plugin's Enter shockwave (README: "shockwave on Enter") never fires in bb's thread composer: it is a TipTap/ProseMirror editor, Enter sends the message, and Shift+Enter inserts the line break without any `beforeinput`/`input` event (checked by logging events), which is what the plugin listens to. By the plugin code (`onInput` treats `insertParagraph`/`insertLineBreak` as a newline) it should work in native editors that emit those events; that was not exercised here. Because plugin behavior is out of scope for this video, segment 2 does not claim it; revisit if the composer or plugin changes.

**Privacy.** The recorder hides every sidebar project except the disposable `power-demo` project (a small `addInitScript` in `docs/demo/record.mjs`; it only changes the recording page's DOM). The Settings view shows the Settings navigation, which lists plugin names and nothing else personal. No thread, path, account or token from the host appears; verify per "Verification" below.

## Reproduce

Prerequisites: `ffmpeg`/`ffprobe`, `jq`, `bc`, Google Chrome, Node ≥ 20, a running bb with this plugin installed at the commit you want to show (`bb plugin update power-mode --yes` pulls the tracked upstream), and a working Claude Code provider.

```sh
# 1. Disposable project (its name must be "power-demo": the recorder keeps only that sidebar section)
mkdir -p /tmp/power-demo && git -C /tmp/power-demo init -q
echo "# Demo" > /tmp/power-demo/README.md
git -C /tmp/power-demo add -A && git -C /tmp/power-demo -c user.name=demo -c user.email=demo@example.com commit -qm init
bb project create --name power-demo --root /tmp/power-demo --machine <machine> --json   # note the project id

# 2. Recorder dependencies in a scratch dir (never inside the repo)
mkdir -p /tmp/demo-capture && cd /tmp/demo-capture && npm init -y && npm i playwright-core

# 3. Record (≈ 80 s). Copy the recorder next to node_modules (ESM resolves playwright-core relative to the script).
#    Writes raw/*.webm and marks.json in the current directory
cp <repo>/docs/demo/record.mjs . && DEMO_PROJECT_ID=<project id> BB_URL=http://127.0.0.1:38886 node record.mjs

# 4. Trim, caption, encode, poster (writes docs/media/power-mode-demo.{mp4,jpg})
cd <repo> && docs/demo/encode.sh /tmp/demo-capture/raw/*.webm /tmp/demo-capture/marks.json
```

Notes:

- Run `bb thread delete` on any thread left in `power-demo` between takes so the sidebar starts empty. The first take's model choice is remembered by the project, so the model picker step only re-selects Haiku 5.5.
- `record.mjs` selectors target bb 0.49 (button names such as "Toggle Power Mode", "New thread in power-demo"). Adjust them if the UI changes.
- The agent segment depends on the model streaming its reply. If a take shows a long "Thinking…" pause and the whole reply landing at once (no sparks, no finale), discard it and re-record.
- `marks.json` holds the start offset of each segment; `encode.sh` derives the trim points and caption timings from it. The core of the encode is: `-ss <start> -to <end>`, `drawtext` captions, `fps=30,format=yuv420p`, `-an -c:v libx264 -preset slow -crf 25 -pix_fmt yuv420p -movflags +faststart -map_metadata -1`.
- The encode is deterministic: re-running `encode.sh` on the same raw capture produces a byte-identical MP4.

## Replace the video

Re-record and encode as above, which overwrites `docs/media/power-mode-demo.mp4` and `.jpg` in place. Keep the file **≤ 10 MB** (raise `-crf` if needed; otherwise attach it to a GitHub release and link that asset instead), keep the same paths so the README link keeps working, then update the capture table above (date, bb version, plugin commit, tier seen).

## Verification (2026-11-08)

| Check | Result |
|---|---|
| `ffprobe` | h264 (High), `yuv420p`, 1280×800, 30 fps, 68.3 s, 5,100,393 bytes (≈ 4.9 MiB, under the 10 MB budget), no audio stream, no container tags beyond the encoder |
| Effective fps (`mpdecimate`) | 25.2 and 25.0 distinct fps while typing (8–12 s, 14–18 s), 23.0–24.0 during paste and agent segments; particles and combo counter animate continuously |
| Segment frames | Reviewed contact sheets of the whole video plus dense frame runs: toggle tooltip, caret particles + combo/WPM, NICE!/UNSTOPPABLE!/GODLIKE! slams and toasts, Backspace shards, Inferno theme and Particles 2.5×, paste rocket barrage with "1,500 CHARS" slam, streaming sparks, AGENT IS COOKING (138 words), TURN COMPLETE (139 words) |
| Legibility | Settings page is scrolled so the sliders clear the bottom caption; all captions fit inside the frame |
| Privacy | Sidebar crop scanned per frame: only frames with text outside the empty project list were the hover tooltip, the Settings navigation (plugin names only) and the demo thread. OCR of those frames found only `power-demo`, Settings labels and the demo thread. `strings` on the MP4 and JPG: no hostnames, paths, emails or names |
| Re-encode | `encode.sh` on the same raw capture gives a byte-identical MP4 and JPG |
| Plugin under test | `bb plugin source power-mode` → `017a7451685e` (`main`) |
