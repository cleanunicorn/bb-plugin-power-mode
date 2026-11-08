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

`agent-toggle.browser.js` covers the timeline's clamped content and command
preview expansion controls (#24), including streaming interleaved with expansion
and collapse, another row, and an unrelated control.

`night-owl.browser.js` covers Night Owl (#11) with a controllable local clock
(`Date.now()` and `new Date()` stay consistent): typing unlocks it from 00:00
inclusive to 04:00 exclusive (00:00:00.000, 03:59:59.999 yes; 04:00:00.000,
23:59:59.999 no); daytime typing followed only by nighttime agent activity,
theme changes or other stats mutations does not unlock it; a nighttime deletion
or paste does not count as typing; and an existing unlock is preserved. Run it
with the other browser tests (`betterwright run --no-daemon tests/night-owl.browser.js`).

`reduced-motion.browser.js` covers reduced motion (#13) with a controllable
`matchMedia` stub: the OS value is followed until an explicit override is saved,
overrides (true and false) win over OS changes and persist, legacy or untrusted
saved values parse to "follow the OS", tier 7–9 pastes, combo milestones, typing
and power-on produce no body/editor shake and no `.pm-flash`, an OS flip
mid-event releases live shakes and flashes, normal effects return when reduction
is off, and disposal removes the listener. Lightning is gated in `bolt()` but not
asserted directly.

`docs-counts.test.mjs` checks that the README's feature list matches the code: the
achievement badge count, one theme name per `THEME_IDS` entry, and the ordnance table's
tiers and combo bumps against `ORDNANCE_COMBO`. It needs only Node:

```sh
node --test tests/docs-counts.test.mjs
```

## Achievement collection (#32)

Node 24+ runs the pure reducer and adapter contract suites without a test runtime:

```sh
npm run test:achievements
npm run typecheck
bb plugin build
```

The tests exercise positive paths for **all 32** new IDs, plus boundary, replay,
provenance, failure, timing and submission-order cases. `achievement-input.test.mjs`
models trusted IME events to verify commit-once behavior; native IME is not driven
by the guarded browser API. The browser suite verifies that unknown-timing
`keyboard.insertText` does not silently become manual typing.

`npm run build:test` (and so `npm run test:browser`) already builds this fixture into `dist/test-site`. To build it by hand alongside the engine fixture above:

```sh
npm exec --yes --package=esbuild -- esbuild tests/achievements-entry.tsx --bundle --format=iife --global-name=AchievementTest --alias:sonner=./tests/toast-stub.ts --alias:@get-bb/plugin-sdk/app=./tests/achievement-sdk-stub.ts --outfile=/tmp/power-regression/achievements.js
cp tests/achievements.html dist/app.css /tmp/power-regression/
betterwright run --no-daemon tests/achievements.browser.js
betterwright run --no-daemon tests/achievements-persistence.browser.js
betterwright run --no-daemon tests/achievements-feedback.browser.js
```

The fixture mounts the production gallery and input adapter. SDK hook stubs keep
it independent of a signed-in BB; canonical event fixtures go through the real
agent adapter and reducer, including split-word streaming. It covers compact
container layout, two panes, a contenteditable replacement editor, excluded queued
editors/Settings/terminal, real key input, submit→clear→reply, one-use handoffs,
Human/Agent/Together/hidden unlocks, secret-safe rendering, all 19 old IDs/dates,
legacy/new pins, titles, reset, and content-free persistence. Feedback checks one
coalesced gallery-action toast, OS reduced motion, particles-off and pending-toast
cancellation on reset. Native IME event modeling and live host provider delivery
are distinct verification levels; the latter has not been exercised by this fixture.

In a restricted filesystem, set `BETTERWRIGHT_HOME` to a fresh `/tmp` directory
and use npm's `--cache /tmp/power-mode-npm-cache` option. The full paste suite can
exceed the CLI's 30-second script budget. Run that unchanged script through the
BetterWright Node client's `run(code, { timeout: 120 })` when needed; keep its
managed browser/network guard and close the client afterward.
