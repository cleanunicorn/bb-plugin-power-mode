# Retro 8-bit demo

[Watch the demo](media/power-mode-demo.mp4?raw=true) · [Motion preview](media/power-mode-preview.gif) · [Poster](media/power-mode-demo-poster.jpg)

A 47-second, 1260×740, 30 fps H.264 recording of the real Power Mode plugin in bb. Silent, with flashing effects and screen shake. The README uses a five-second GIF so the effects play directly in GitHub Markdown; clicking it opens the repository MP4. These relative links follow the branch being viewed rather than pointing at an older published demo.

## Loadout

Power Mode on, **Godlike**, **Retro 8-bit**, **Particles 1.5×**, **Glow 70%**, **Agent Power Mode on**. Sound off. Reduce motion follows the recording environment's system setting (off). The first scene shows the selected controls. Retro deliberately skips bloom for crisp pixels, even with Glow set to 70%.

## Scenes

| Time | What actually happens |
| --- | --- |
| 0:00–0:04 | The selected intensity, theme and exact slider values |
| 0:04–0:20 | Native typing stays visible as the combo builds to GODLIKE; pixel effects and milestone slams |
| 0:20–0:26 | A native 3,330-character paste triggers carpet bombing, BOMBER RUN and the Bombardier unlock |
| 0:26–0:36 | The end of typing the agent prompt, then submission |
| 0:36–0:43 | An actual agent reply streams: AGENT IS COOKING and TURN COMPLETE fireworks |
| 0:43–0:47 | “YOUR NEXT TASK IS A BOSS FIGHT. EQUIP POWER MODE.” |

The opening typing scene was re-recorded in the same profile after its introductory badges had already been earned. This prevents repeated first-time achievement banners from covering the composer. The sentence starts more slowly to make the connection between keystrokes and effects clear. No banners were digitally erased or restyled; the original paste scene still shows the Bombardier celebration.

Idle time and navigation are cut. Retained footage plays at real speed. The magenta-bordered captions and sidebar blur are recording overlays, not plugin features. No effects, replies, achievement unlocks or WPM values were fabricated. Automated keystrokes demonstrate visuals; their displayed WPM is not a human speed benchmark. Physical haptics cannot be conveyed by this video.

## Capture environment

- Recorded 2026-11-10 with the installed plugin at `89e6b8926d22e280a2d89af1d49ddb5e01e24fe0`.
- BetterWright, isolated `power-mode-video` browser profile, headed Chromium on Xvfb `:98`.
- 1260×740 browser viewport; ffmpeg records that viewport at display offset `10,130`.
- An actual Codex agent turn in the `bb-plugin-power-mode` project. The demo thread is archived after capture. No repository changes were requested from it.
- Prompt: “No tools or file changes. Write 180 words of arcade announcer hype about a coder and an AI teammate defeating a backlog with pixel fireworks. Three short paragraphs. Start with PLAYER TWO READY.”
- The server already had the requested preset. No effect settings were changed. Settings are server-synchronized; a fresh browser profile does **not** isolate them.

## Record a new take

1. Use BetterWright with an isolated profile. Inspect the real UI before acting; open Settings → Power Mode, select the loadout and verify the controls. Preserve the user's previous settings if changing them.
2. On Linux, a virtual display can capture the headed browser without exposing another desktop:

   ```sh
   Xvfb :98 -screen 0 1280x900x24 -nolisten tcp -extension GLX -extension RENDER
   DISPLAY=:98 betterwright run --headed --profile power-mode-video \
     -c "await page.setViewportSize({width:1260,height:740}); await page.goto('http://127.0.0.1:38886'); return await snapshot({interactive:true})"
   ```

3. Inspect a full-display screenshot to confirm the viewport offset for your browser. Hide unrelated sidebar project/thread names before capture. Keep the sidebar present so the plugin can observe the demo thread's completion. Add clearly editorial captions if desired.
4. Record while driving the browser through BetterWright:

   ```sh
   ffmpeg -y -f x11grab -framerate 30 -video_size 1260x740 \
     -i :98+10,130 -c:v libx264 -preset ultrafast -crf 18 \
     -pix_fmt yuv420p /tmp/power-mode-take.mp4
   ```

5. Type with real keyboard events. For the bomber, copy `('Ship the feature. Collect the pixels. ').repeat(90)` to the browser clipboard, then press Ctrl+V in the composer. Do not substitute a synthetic paste event. Clear that draft and send the short demo prompt in a new project thread. Capture the complete reply and finale.
6. Stop ffmpeg cleanly with `q` or SIGINT. Inspect a contact sheet and select scene boundaries. [`scripts/demo/edit-retro.mjs`](../scripts/demo/edit-retro.mjs) contains the edit points for this take; update them for a new recording. The optional second input replaces the 16-second opening typing scene; the last argument is its start time. To reproduce the clearer cut, run:

   ```sh
   node scripts/demo/edit-retro.mjs /tmp/power-mode-take.mp4 /tmp/power-mode-clear-typing-2.mp4 3
   ```

7. Verify full-file decoding, inspect frames from every scene and check playback in a browser. Archive the demo thread, close the isolated browser session, and stop the virtual display. Commit the MP4, GIF, poster and updated scene notes together.

The older `record.mjs` / `encode.mjs` scripts describe the previous Neon/Inferno capture. They were not used for this take. In particular, the old recorder's claim that a throwaway profile leaves server settings untouched is no longer valid.

## Verification

The exported MP4 reports H.264, 1260×740, 30 fps and 47.00 seconds. `ffmpeg -v error -i docs/media/power-mode-demo.mp4 -f null -` decodes it without errors. Frames were inspected for the exact controls, typing milestones, Bomber Run/Bombardier, agent streaming and TURN COMPLETE. The initial export passed browser playback. The revised opening and portrait export were checked with full-file decoding and scene-frame inspection. The README consistency checks pass for the badge count, six themes and all nine ordnance tiers.


## Vertical edition

[Watch the 9:16 video](media/power-mode-vertical.mp4?raw=true) · [Portrait poster](media/power-mode-vertical-poster.jpg)

The portrait edition is 1080×1920 at 30 fps, with the same 47-second sequence and no audio. It reframes the existing recording: the blurred sidebar and original bottom captions are cropped away, while the composer, combo HUD and streamed reply remain in a wide gameplay panel. Large scene captions, the exact preset and an installation end card sit on a dark arcade background. This is a portrait edit of desktop footage, not a recording of the mobile layout.

Regenerate it from the finished landscape MP4:

```sh
node scripts/demo/vertical.mjs
```

The script uses ffmpeg and DejaVu Sans Mono; set `DEMO_FONT` to another local font path if needed.
