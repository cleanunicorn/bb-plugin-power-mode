# Achievement implementation guide

The executable catalog is `lib/achievement-rules.ts`: `CATALOG` owns stable IDs,
category, hidden visibility, authored requirements, flavor and eligible event
families; `RULES` owns measurement targets. Category and visibility are independent.
Keep requirement/progress copy in this catalog aligned when changing targets.
The legacy definitions in `power-stats.ts` preserve all 19 existing IDs. There are
32 additions and 51 total badges. Do not expose locked hidden metadata in UI,
accessible names, tooltips, progress, pins or the postcard.

## State and attribution

`reduceCollection` receives explicit monotonic and wall time. It performs no IO,
uses only the provided state, and returns the newly earned IDs. Persistence stays
in the existing two-second stats writer; unlocks flush immediately. The versioned
collection stores numbers, theme sets, minimal thread IDs, dates and preferences.
It never stores draft/reply text. Old saves initialize missing counters to zero.
Reset clears the reducer, in-flight observations, preferences and queued feedback.

Draft content is transient in the native adapter only. A beforeinput snapshot and
selection/range are compared with the committed input. Graphemes use
`Intl.Segmenter`. A trusted matching non-repeat keyboard event establishes direct
input; a trusted IME composition commits once and is eligible for non-speed
rules. Unknown provenance, dictation, paste/drop, programmatic and synthetic
changes cannot establish direct typing. Undo/redo are history, not new text.
Drafts over 100,000 UTF-16 units are conservatively excluded from revision/input
tracking to bound synchronous diff work. No changes are made to the user's text.

The SDK composer key/scope is associated with native input through the approved
banner marker and BB containers. A unique editor box is required. Main composer
input cannot borrow a queued editor, other pane, Settings field or terminal.
Replacement composers work if they retain BB's container contract and native
editable/input events; otherwise new input awards fail closed. This is deliberately
an internal DOM compatibility boundary, not a newly invented SDK API.

Speed windows are non-overlapping, half-open 30-second intervals, with at least
100 directly entered graphemes and no gap over five seconds, including the idle
tail. Existing HUD burst WPM is unchanged. Direct combos use the existing
three-second timeout, exclude paste, and never earn exact-ending secrets on
navigation, disposal or reset. Changes in theme/effects invalidate dependent
sequences even when the setting is immediately switched back.

The browser SDK's canonical event stream supplies observed agent lifecycle and
output. Each observer first reads a high-water cursor; it never earns from older
rows. Route changes, hidden tabs, disconnects, reload and reset invalidate active
observations. Only a root turn with observed start, new agent-message items and
explicit `completed` status qualifies. `failed`, `interrupted`, unknown outcomes,
partial messages, and DOM transcript changes do not. Incremental word counting
carries the in-word state across chunk boundaries; completed message text
reconciles the count without retaining text. Multiple agent messages in one turn
are separated as words and summed. Observed activity makes no correctness claim.

A successful local submit preserves a handoff through composer clearing. A turn
must start after that draft's last qualifying edit. Start time comes from the
canonical row, so polling delay cannot manufacture an exchange; a successful
submit acknowledgement may arrive after server start without erasing valid input.
One complete reply consumes at most one handoff. Enter alone is never submission.

Session state expires after ten idle minutes or reload. Short fixed timing/range
buffers and per-thread session counters are cleared then. Session maps scale with
threads observed in that session, not keystrokes. Persistent per-thread counts
(cap ten per thread) are necessary for The Long Thread across sessions. No reply
text or lifetime event-ID log grows with streaming output. A fresh high-water
cursor on reconnect/reload prevents history replay without such a log.

## Presentation

Human/Agent/Together filters and unlocked-only views retain anonymous secret
cards. Visible progress is formatted centrally by `challengeProgress`. One
visible challenge can be pinned; sustained speed pins include a static PB ghost.
Visible legacy badges count toward category titles; hidden badges count only
toward Secret Cartographer. Equipped titles have no gameplay effect. The session
postcard remains in Settings and the gallery; it never interrupts writing.

One 150-ms coalescing timer emits one toast with count and a gallery action.
Category flourishes differ by color, particle count/radius and copy. Particle,
sound and OS reduced-motion preferences govern new feedback; a static toast works
with everything off. This does not claim to fix legacy motion behavior (#13).
The new default-on particles toggle makes all-effects-off observation reachable.

Related issues #10/#11/#13/#24 retain ownership of cross-window stats consistency,
legacy Night Owl, global motion precedence and legacy DOM output counting. New
awards use their own event contract without rewriting those legacy paths.
