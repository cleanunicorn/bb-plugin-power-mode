# Demo video

[`media/power-mode-demo.mp4`](media/power-mode-demo.mp4) is an 84-second, 1280×800 H.264 recording of the real plugin running in bb. It has no audio, because Sound is off by default. [`media/power-mode-demo-poster.jpg`](media/power-mode-demo-poster.jpg) is a still from 0:25, which the README uses as a thumbnail. Both are committed to the repository, so the README link always points at the version on the branch you are viewing.

## What it shows

| Time | Scene |
|---|---|
| 0:00 | Intro caption on the bb home screen |
| 0:04 | 1 · Click ⚡ **Toggle Power Mode** in the sidebar footer |
| 0:07 | 2 · Type a sentence in the composer: particles, editor shake, flying letters, combo counter with WPM, milestone slams. Then 30 Backspaces for red shards |
| 0:20 | 3 · Paste ordnance: ~120 chars (dynamite), 1,026 chars (rocket barrage), 3,015 chars (carpet bombing) |
| 0:36 | 4 · Settings → Power Mode: switch the theme from Neon to 🔥 Inferno; point at the **Agent Power Mode** checkbox (on by default) |
| 0:50 | 5 · Pick the `bb-plugin-power-mode` project, type an agent prompt with the Inferno theme, send it |
| 1:05 | The agent reply streams with sparks and the AGENT word combo ("AGENT IS COOKING"), then the **TURN COMPLETE** finale plays |
| 1:20 | Outro caption |

The yellow ring is a cursor marker added for the recording. The dark captions are an overlay injected by the script. Neither comes from the plugin.

## Capture environment

- bb 0.49.0 at `http://127.0.0.1:38886`, Linux, headless Google Chrome 155 at 1280×800
- Power Mode installed from `git:https://github.com/cleanunicorn/bb-plugin-power-mode` at `017a745` (Merge PR #22)
- A fresh Chrome profile, so Power Mode starts from its defaults: Legendary intensity, Neon theme, Agent Power Mode on, Sound off
- Agent turn: a new thread in the `bb-plugin-power-mode` project (Project checkout, Claude Sonnet, Medium), prompt *"Without using any tools, write three short upbeat paragraphs (about 200 words total) about why typing with particle effects is fun."*
- puppeteer-core 24.43.1, ffmpeg 8.1

## Reproduce or update

1. Run bb with the plugin installed, and pick a sidebar project for the agent turn (default `bb-plugin-power-mode`).
2. Record. The script uses a throwaway Chrome profile, so your own Power Mode settings are untouched.

   ```sh
   mkdir -p /tmp/pm-demo && cd /tmp/pm-demo
   npm i --no-save puppeteer-core@24
   cp <repo>/scripts/demo/record.mjs <repo>/scripts/demo/encode.mjs .
   # dry run (types the prompt but does not send it):
   node record.mjs frames
   # real take, sends the prompt and waits for the turn to finish:
   SEND=1 node record.mjs frames
   ```

   Optional environment variables are `BB_URL`, `CHROME`, and `DEMO_PROJECT`. The script blurs the sidebar's project and thread lists and the project picker's options, so the recording doesn't show other projects.
3. Encode. The frames come from the CDP screencast and arrive only when the screen changes. `encode.mjs` keeps their real timing:

   ```sh
   node encode.mjs frames
   ffmpeg -f concat -safe 0 -i frames/list.txt -vf "fps=30,format=yuv420p" \
     -c:v libx264 -crf 26 -preset slow -movflags +faststart power-mode-demo.mp4
   ffmpeg -ss 25 -i power-mode-demo.mp4 -frames:v 1 -vf scale=960:-1 -q:v 4 power-mode-demo-poster.jpg
   ```
4. Archive the demo thread. Its ID is written to `frames/demo-thread.txt`: `bb thread archive <id>`.
5. Replace the files in `docs/media/`, update the revision and timings above, and repeat the checks below.

### Gotchas

- Run the agent turn in a project that appears in the sidebar. The TURN COMPLETE finale fires when a sidebar thread goes from running to idle. A "No project" (personal workspace) thread isn't in the sidebar list, so it gets the streaming effects but no finale.
- The paste uses the real clipboard (`navigator.clipboard.writeText` plus a Ctrl+V with the `Paste` editing command), so the composer receives a native paste event.

## Verification of the committed video

- `ffprobe` reports h264, 1280×800, 83.97 s. `ffmpeg -v error -i power-mode-demo.mp4 -f null -` decodes the whole file without errors. SHA-256 `2d519f990410254c26642a1690fb43f6b2edb65d939a86c27b2af9cae6d8c004`.
- I checked frames from every scene: the toggle click, the combo counter (155 GODLIKE, "ON FIRE!", "NEW RECORD"), Backspace shards, dynamite sticks and the "OVERLOAD" slam, the rocket barrage ("NICE!"), carpet bombing, the Settings page with Inferno selected and the "INFERNO" slam, the agent combo ("AGENT IS COOKING", 117 words), and "TURN COMPLETE". Captions and controls are legible at 1280×800.
- Privacy: the sidebar thread and project lists and the project picker are blurred, and the demo threads were archived. The workspace-provisioning log is on screen for about a second and shows the local checkout path.
