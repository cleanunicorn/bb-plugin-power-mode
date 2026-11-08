# Power Mode demo video

[`power-mode-demo.mp4`](power-mode-demo.mp4) is a 62-second recording of the real plugin running in bb (H.264, 1280×800, 25 fps, no audio, about 3.3 MB). [`power-mode-demo.jpg`](power-mode-demo.jpg) is its poster frame. The video shows, in order:

| Time | Scene |
|---|---|
| 0:00 | Power Mode off; the ⚡ button in the sidebar footer turns it on (POWER MODE · NEON · LEGENDARY) |
| 0:06 | Typing: particles, editor shake, combo counter with WPM gauge, NICE / ON FIRE / UNSTOPPABLE / GODLIKE tiers, achievement toasts, Backspace shards |
| 0:16 | Paste ordnance: a ~150-character paste (OVERLOAD) and a ~2,500-character paste (carpet bombing, LIGHT SHOW) |
| 0:25 | Settings → Power Mode: intensity, the six themes, choosing 🔥 Inferno, the effect toggles including Agent Power Mode |
| 0:35 | Typing again in the Inferno theme |
| 0:41 | A real agent turn: prompt sent from the composer, sparks and AGENT IS COOKING as the reply streams in, then the TURN COMPLETE finale with the word count and thread title |

Captions are overlaid in the page during capture. The 6 s wait while the agent provisioned and thought before replying was cut out.

## How it was made

- **bb:** local bb web UI at `http://127.0.0.1:38886`, light appearance, on Linux.
- **Plugin:** Power Mode installed from `git:https://github.com/cleanunicorn/bb-plugin-power-mode` at revision `7bb46c5` (it differs from `017a745` only in agent-turn attribution fixes, which do not change what the demo shows). Default settings: Legendary intensity, Neon theme, Particles 1.0×, Glow 70%, sound off, Agent Power Mode on.
- **Agent:** the composer's default model (Codex, 6.1-Sol Medium), in a new thread in the personal workspace, prompt *"Write two lively paragraphs (about 250 words total) about fireworks over a harbor at night. No tools, no headings."*
- **Capture:** [`record-demo.mjs`](record-demo.mjs) drives headless Chromium with Playwright 1.63.0 and records a 1280×800 WebM. The browser profile is fresh, so Power Mode starts off with default settings and stats, and the bb windows you normally use are untouched (Power Mode settings live in each browser's localStorage). The script blurs the sidebar thread list everywhere except Settings, so no real thread titles appear, and it highlights each control before clicking it. The typing text, the pasted text (a sentence repeated) and the agent prompt are all fixed and non-sensitive.

### Reproduce or update

1. Run bb with Power Mode installed and enabled. Check the revision with `bb plugin list --json`.
2. Record:

   ```sh
   mkdir -p /tmp/pm-demo && cd /tmp/pm-demo
   npm init -y >/dev/null && npm i playwright@1.63.0 && npx playwright install chromium
   cp <repo>/docs/demo/record-demo.mjs .
   BB_URL=http://127.0.0.1:38886 OUT_DIR=raw node record-demo.mjs
   ```

   The script prints a time mark for each scene and each Power Mode slam (also written to `raw/marks.json`). It waits for the `TURN COMPLETE` slam before finishing.
3. Cut the opening load (before the `intro` mark) and the agent's silent wait (from about 4 s after `agent-sent` to about 1 s before the `AGENT IS COOKING` slam), then encode. For the delivered take the cuts were:

   ```sh
   ffmpeg -i raw/<page>.webm -filter_complex \
     "[0:v]trim=1.5:51.5,setpts=PTS-STARTPTS[a];[0:v]trim=57.3:69.0,setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1[v]" \
     -map "[v]" -c:v libx264 -preset veryslow -crf 28 -pix_fmt yuv420p -r 25 -movflags +faststart power-mode-demo.mp4
   ffmpeg -ss 20.5 -i power-mode-demo.mp4 -frames:v 1 -vf scale=960:-1 power-mode-demo.jpg
   ```

4. Archive the disposable agent thread (`bb thread update <id> --archive`, or from the sidebar). Its ID is in `marks.json` (`url`).
5. Replace both files in this folder, update the revision and timings above, and run the checks below.

## Verification

Checked for the delivered file:

- `ffprobe`: h264, 1280×800, 61.7 s. `ffmpeg -i power-mode-demo.mp4 -f null -` decodes the whole file without errors.
- Contact sheets at one frame every 3 s, plus single frames at each scene change. Every scene in the table is present. The finale frame shows `TURN COMPLETE · 123 WORDS`. Captions and controls are readable at 1280×800.
- Privacy: frames sampled at every navigation (page load, entering and leaving Settings, opening the agent thread) show the sidebar thread list blurred. The Settings sidebar shows only bb's settings sections. No paths, tokens or personal data appear.
- Hosting: the file is committed in this repository, and the README links to it with a relative link. GitHub serves it to signed-out visitors from the file page and from the raw URL.
