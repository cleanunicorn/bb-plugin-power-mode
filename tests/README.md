## Running the tests

```sh
npm ci
npm run typecheck     # tsc over the plugin sources
npm run test:unit     # vitest: lib/power-store and lib/power-stats (tests/unit)
npm run test:browser  # all tests/*.browser.js fixtures, end to end
npm test              # unit + browser
```

`npm run test:browser` runs `scripts/run-browser-tests.mjs`. It bundles the fixture
with esbuild into `dist/test-site` (`npm run build:test`), serves it on
`127.0.0.1:9146` (the URL the fixtures hard-code), runs every `*.browser.js` file
through BetterWright with a dedicated `power-mode-tests` profile, and stops the server
afterwards, including on failure and on SIGINT/SIGTERM. It exits non-zero if any
fixture fails, if port 9146 is taken, or if BetterWright's browser is missing.

First run on a machine: `npx betterwright setup` downloads the managed Chromium.
If Chromium aborts with "The SUID sandbox helper binary was found, but is not
configured correctly" (common in containers and on recent Ubuntu), run with
`BETTERWRIGHT_CHROMIUM_ARGS=--no-sandbox npm run test:browser`.

BetterWright 2.9.1 cannot parse a snippet that starts with `await`, so the runner
runs a copy of each fixture with a leading declaration (written to `dist/snippets`).
The fixtures themselves are untouched and also run with `betterwright run` directly
once the site is served.

### CI

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`:

- `checks`: typecheck, test-site build and unit tests.
- `browser`: `betterwright setup` then `npm run test:browser` with
  `--no-sandbox`. BetterWright needs no sign-in, profile or external service, only the
  download of its managed Chromium. This was verified locally; the workflow itself
  can only be proven by its first run on GitHub. If it turns out to be blocked there,
  the `checks` job still runs and the failing `browser` job names the blocker.

## Fixtures

The test advances animation frames deterministically. It checks that typing and
paste keep viewport panels fixed, existing editor translations survive shake,
text protection softly fades only near the caret on both rendering layers,
all six themes clear their canvases after idling, visual settings and disable
clear stale pixels immediately, streaming leaves virtualized rows in place, resizing during shake keeps panels
anchored, and disposal restores host styles. The fixture
includes a fixed terminal and sidebar and a translated timeline row.
Terminal input (including Space, deletion, paste, and Enter) must retain its
positioning and focus without emitting effects or changing scroll position.

`paste-ordnance.browser.js` covers paste ordnance (#8): the `pickOrdnance` tier
table and lucky-drop limits, milestones crossed by combo jumps, paste-length capture
in `<textarea>`, `<input>` and contenteditable (paste event, `InputEvent.dataTransfer`,
drops), the fallback for editors that cancel the native paste, empty and terminal
pastes, staggered detonations, every theme × tier slam title with clean canvases
afterwards, skins kept across a mid-flight theme switch, the timer, pending and
particle caps under ten rapid 300k pastes, the singularity pull, `lightning`,
`screenShake` and `sound` off, and disabling and re-enabling during an event. It
uses the `setOrdnanceRandom` and `ordnanceDebug` test seams.

`thread-switch.browser.js` covers lingering effects after thread navigation (#17):
twelve timeline swaps with streaming text while the agent starts and stops leave
no canvas, bloom, vignette or HUD residue once activity ends; a render frame that
throws mid-draw (injected through `drawImage`) clears both canvases instead of
freezing its last frame; and an animation started right after a swap still draws.
Findings: thread switching alone did not reproduce on current main (#5's idle
clear covers it, but its tests never swap rows). The reproduced cause is the
throwing frame, which ended the loop without clearing, fixed in `frame()`.

`agent-attribution.browser.js` covers agent attribution (#12) through
`syncAgentThreads`: a background thread finishing leaves the visible word count,
`bestAgentWords` and finale alone, two simultaneous finishes show one finale for
the visible thread, concurrent turns keep separate counts, a visible-thread change
in the same update as a finish credits buffered rows to the old thread, an unknown
route credits only a sole running thread, and threads that vanish start over. Run
it with the other browser tests (`betterwright run --no-daemon tests/agent-attribution.browser.js`).
