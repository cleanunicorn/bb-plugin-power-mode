# Achievement observation contract (#32)

Capability audit: SDK 0.6.132 (host); original pin 0.6.104 also contains
turn events and composer submission subscriptions. The old AgentWatcher is not
sufficient: running → idle and DOM text growth are not completion evidence.

Concrete supported sources:

- `useComposer().key` and `.scope` identify a composer and its thread.
- `onSubmitted` reports accepted local submissions, including queued messages;
  failed sends and clearing do not notify. Preserve pending input before clearing.
- `useSdk().threads.events.list` returns ordered rows with `seq`, `createdAt`,
  `scope.kind`, `scope.turnId`, type and data. Start from the current high-water
  sequence, never replay history as new observations. Disconnects invalidate turns.
- `turn/started` and `turn/completed` with status `completed` establish lifecycle;
  `failed` and `interrupted` do not qualify. Ignore nested agent output.
- `item/agentMessage/delta` and completed agentMessage items supply canonical
  output independently of rendering. Count words on the final assembled message,
  not separately on chunks. Navigation, expand/collapse and remount cannot produce
  canonical events. Completion without an observed start is partial.

## Unresolved supported-interface dependency

Input attribution remains a gate: native DOM events expose provenance and ranges,
but the public composer handle has no editor/root DOM reference or input-event
subscription. `experimental_ComposerRoot.rootRef` belongs to the replacement
composer renderer, not an observing customization. Host source currently has
`data-app-composer` and `data-composer-box` containers, but neither carries the
composer key. The default FollowUpPromptBox puts its banner and editor under
one `data-app-composer` ancestor, so a banner marker plus native event listeners
could correlate them. This is a concrete implementation option, but it depends
on internal host layout, not the supported composer interface. It needs a stated
compatibility boundary and browser tests for multiple panes, queued editors,
compact mode and replacement composers. Do not guess a thread from the selected
route or match composers by draft text.

Inspection covered the installed npm SDK declarations at 0.6.104 and 0.6.132,
the installed bb-app bundle (which contains these DOM markers), and local BB
source in `apps/app/src/components/promptbox/FollowUpPromptBox.tsx`,
`ComposerBox.tsx`, `composer-root.tsx`, and
`components/plugin/PluginComposerBanners.tsx`. The local source is supporting
implementation evidence, not a promise about every compatible BB release.

The required supported extension would expose a read-only native editor/root
association, or an edit subscription with composer key/scope, committed edit
ranges, input provenance/history/composition and successful-submit ordering.
`PluginComposerApi.onSubmitted` already supplies successful local submissions;
that capability does **not** need to be added. Likewise, canonical agent turn
lifecycle is available and is **not** the blocking dependency.

### Gate disposition

P1 is unresolved for composer input attribution. No achievement implementation
or permanently ineligible catalog entries have been added. P2 explicitly depends
on P1 in the approved plan. Decide whether to accept the verified internal-DOM
adapter as the compatibility boundary for this plugin, or require the public
host observation extension before continuing. The former avoids expanding this
repository's work into a host SDK change; the latter preserves a public API-only
integration. Neither option requires weakening lifecycle or provenance rules.

### Validation recorded

- `bb plugin types --check`: original pin 0.6.104 differs from host 0.6.132.
- Temporarily synchronized declarations with `bb plugin types` and installed
  with `npm install --ignore-scripts --cache /tmp/power-mode-npm-cache`.
- `npx tsc --noEmit` passed against 0.6.132; this is an audit baseline only.
- Restored package manifests and lockfile after the audit; no dependency upgrade
  is included in this documentation change.
- No behavioral/browser tests: no runtime implementation changed. P1 adapter
  fixtures remain pending the interface decision. P1 is not claimed complete.

## Measurement decisions

Use monotonic time for durations and wall time for dates/hour boundaries. Expire
sessions after 600,000 ms without eligible input or observed agent activity;
reload clears transient sequences. Capture the idle gap before reset for Bloom.
Fixed half-open 30-second windows require 100 direct graphemes and no gap over
5 seconds, including trailing idle. Three adjacent 10-second rhythm buckets use
inclusive 20% tolerance. IME commits count once for non-speed rules; unknown-timing
bulk commits, paste/drop, dictation, repeats, synthetic changes and history are
excluded from speed. Undo/redo are history events, not characters.

Draft boundaries are accepted submit, clear then fresh input, or changed
editor/thread; Enter is not submission. Revisions use transient grapheme ranges.
Store no draft/reply content. Natural timeout alone ends exact direct combos.
Theme/settings-dependent sequences invalidate on any intervening change.

| Evidence | Speed/rhythm | Craft/biomes | Together |
| --- | --- | --- | --- |
| Trusted, individually timed manual insertion | Yes | Yes | Composer only |
| Committed IME, timing unknown | No | Yes, once | Composer only |
| Paste/drop/dictation/programmatic/synthetic | No | No new characters | No |
| Undo/redo | No | History only | No new characters |
| Completed turn without observed start | No | No | No |
| Observed start + fresh output + successful completion | No | Agent rules | Same-thread ordered exchange |

Category and visibility are independent. Legacy visible unlocks count toward
Human/Agent titles; secrets count toward Secret Cartographer. All 19 existing
IDs and timestamps survive. Unavailable historical counters begin at zero.
