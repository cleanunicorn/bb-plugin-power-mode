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
