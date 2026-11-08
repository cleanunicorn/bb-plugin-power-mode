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

## Approved internal-DOM compatibility boundary

The user approved the verified DOM adapter with compatibility tests. native DOM events expose provenance and ranges,
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

The user approved the verified internal DOM adapter with compatibility tests.
The implementation uses composer-scoped banner markers, excludes queued/terminal
and unrelated inputs, and fails closed for ambiguous/replacement layouts.
Canonical agent events come from `useSdk().threads.events.list`; provider RPC
inspection exposed usage information but no additional input-observation API.

The dependency pin is now aligned with the inspected host SDK 0.6.132. See
`tests/README.md` and `verification.md` for deterministic and browser coverage.
The original pre-implementation audit was committed as f900513; its pending
interface decision is resolved, not an outstanding build gate.

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
