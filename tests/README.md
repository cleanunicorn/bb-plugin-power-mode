Browser regression fixture for the effects engine. Build the fixture with esbuild
(available in BB's plugin toolchain or through `npm exec --package=esbuild`):

```sh
esbuild tests/power-engine-entry.ts --bundle --format=iife --global-name=PowerTest --alias:sonner=./tests/toast-stub.ts --outfile=/tmp/power-regression/engine.js
cp tests/power-engine.html /tmp/power-regression/
python3 -m http.server 9146 --bind 127.0.0.1 --directory /tmp/power-regression
```

In another terminal:

```sh
betterwright run --no-daemon tests/power-engine.browser.js
betterwright run --no-daemon tests/paste-ordnance.browser.js
```

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

`stats-multiwindow.browser.js` covers stats shared across windows (#10). The runner
exposes one page per script, so the two "windows" are same-origin iframes: each loads its
own copy of the engine bundle (separate module state), and they share `localStorage`,
`navigator.locks` and `storage` events like two windows of one browser profile. It checks
that overlapping flushes keep both windows' counters, bests, themes and unlocks, that a
threshold crossed only by the merged total unlocks once and notifies once, that repeated
flushes never double-count, that a reset propagates and a stale window with unsent activity
(or a flush racing the reset, or one queued before it) cannot restore old stats while later
activity still counts, that a legacy document without an `epoch` keeps its numbers and is
not rewritten by merely loading, and that clearing storage empties other windows. The
suite polls for `storage` events instead of sleeping because delivery is asynchronous.
Run it with `betterwright run --no-daemon tests/stats-multiwindow.browser.js`.

Limits: the locks serialise flushes across windows, but the teardown flush
(`flushPowerStatsSync`, used on dispose and `pagehide`) has to be synchronous, so it
reads, merges and writes without the lock and keeps a small residual race. Two windows
unlocking the same achievement in the same instant, before either flush lands, are
deduplicated at the locked flush (the notification waits for it); a teardown in that
window can drop a pending notification, though the unlock itself is kept. A test cannot
force interleaving inside two processes' synchronous `localStorage` calls.
