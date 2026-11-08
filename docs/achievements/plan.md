## Progress

- [x] P1 — Validate host event capabilities and document the measurement contract.
- [x] P2 — Deliver a compatible catalog and the Six Biomes progress path.
- [x] P3 — Deliver sustained speed, rhythm, improvement, and idle-return achievements.
- [x] P4 — Deliver draft revision and history achievements.
- [x] P5 — Deliver trustworthy complete-reply Agent achievements.
- [x] P6 — Deliver composer-to-agent Together achievements.
- [x] P7 — Complete hidden discovery rules and make effects-off awards reachable.
- [x] P8 — Deliver collection filters, secret-safe cards, and discovery dates.
- [x] P9 — Deliver challenge pinning, cosmetic titles, and the session postcard.
- [x] P10 — Deliver coalesced accessible celebrations, documentation, and final regression verification.

## Planning baseline and evidence

Use issue #32's full body as the Define output; it has no comments. Preserve its exact 32 proposed rules and flavor text (10 Human, 7 Agent, 5 Together, 10 hidden), plus all 19 existing IDs and earned dates: 51 total. Scope excludes semantic grading, analytics, leaderboards, editing user text, and wholesale fixes for related issues.

Inspected app.tsx, lib/power-stats.ts, lib/power-store.ts, relevant engine input/combo/agent/notification paths, package.json, tsconfig.json, tests/README.md, and related issues #10/#11/#13/#24. Current input handling ignores history/replacement events and has no new-rule provenance contract. AgentWatcher supplies thread ID/title/running/idle, not a stable turn ID or explicit success outcome. Agent counting derives from DOM growth, so it cannot itself prove genuinely new output. The current density minimum is 0.25 and there is no particles-off toggle, making Quiet Finale unreachable as written. Current WPM is an eight-second burst measure, unsuitable for the new awards. No node_modules SDK installation was available to validate additional host APIs.

This Plan step was read-only: no files, commits, or GitHub issue edits; no tests run. This report supplies the issue-ready plan in place of the skill's issue mutation, per the explicit step constraint.

## Implementation decisions to lock down in P1

- Keep categories (Human/Agent/Together) independent from visibility (visible/hidden). Assign existing typing/theme achievements to Human and existing agent achievements to Agent; categorize secrets by their activity, with Here Be Dragons assigned Human as collection discovery. Count visible category achievements, including legacy unlocks, toward the three category titles; hidden unlocks count toward Secret Cartographer. Document this choice so hidden activity does not indirectly expose progress through category titles.
- Centralize rule targets, metadata, authored copy, progress formatting, eligible event types, and IDs in one documented developer catalog. User-facing README explains discovery without secret solutions.
- Use a pure achievement reducer with an injected clock and explicit event identity, plus small input/host adapters. Keep persistent aggregates separate from session/draft/turn state. Event-only rules never run merely because recordStats changed a lifetime counter.
- Track wall-clock timestamps for dates/local-hour rules and monotonic elapsed time for windows and idle expiry. Session expires at >=600,000 ms with no qualifying input or observed agent activity, or reload. Capture the prior idle gap before resetting; Back in Bloom starts only on the first qualifying returning input, not first-ever use or an inferred reload gap.
- New text thresholds use graphemes. Confirmed manual insertions and committed IME may qualify for non-speed rules; paste/drop, synthetic/programmatic input and history actions do not count as newly entered text. Require known directly timed input for speed/rhythm and direct-input combos; unknown-timing bulk IME commits cannot establish speed. Classify ambiguous input conservatively.
- Speed windows are fixed, non-overlapping 30 seconds anchored to the first eligible input; use half-open boundaries, >=100 eligible graphemes, and reject gaps >5 seconds including the final idle tail. Restart candidate tracking after invalidation; do not change legacy burst WPM. Ghost Chaser establishes a persistent best over the first three qualifying windows, then compares later windows against the previous best before updating it. Stairway requires three consecutive qualifying windows in one session. Pocket Drummer uses three adjacent fixed 10-second buckets and inclusive 20% tolerance.
- Scope draft trackers to editor/thread; switching either discards local sequences. Confirmed submit, or clear followed by fresh input, creates a new draft; Enter alone does not. Track revisions with transient grapheme ranges remapped through edits; invalidate ambiguous range mappings. For Less, But Better, use draft high-water length >=300, freeze the qualifying 10–30% reduction, then require a later insertion.
- Direct-input combo secrets need a dedicated counter excluding paste bonuses/deletions/history. Natural combo timeout ends an exact-count candidate; reset/disposal/navigation must not accidentally manufacture an unlock. Require theme/effect constraints throughout a qualifying themed/settings-dependent sequence; Lantern Keeper explicitly uses reply-start theme.
- Each qualifying reply requires observed start, stable thread+turn identity, explicit successful completion, and genuinely new output. Unknown lifecycle or identity means ineligible, not inferred success. Mission Control uses the same qualifying-complete-reply definition, without an invented word threshold.
- Baton consumes fresh >=40-character composer input once and a subsequent observed complete reply in that thread. Require reply start after the input stage; use confirmed submission when available, but absence of submit hooks permits only the explicitly labeled observable sequence, never inferred causation. One reply cannot complete multiple exchanges.

## Tasks

### P1 — Host capability and event contract gate
Scope: inspect the supported SDK/host interfaces available to the build environment for composer identity, confirmed submission, turn identity, lifecycle outcome, and canonical output updates. Document an adapter contract and event eligibility matrix, plus the decisions above. Keep this bounded to prerequisites for #32.

Acceptance: identify concrete sources for every identity/outcome field and how cancellations, remounts, historical rows, composition, and repeat input are distinguished. Do not treat thread active→idle as sufficient proof. If the supported host cannot provide the necessary reply evidence, report the precise missing host capability and dependency before claiming Agent/Together delivery; do not silently weaken the acceptance criteria or present permanently disabled awards as complete.

Verification: adapter contract fixtures for complete/partial/cancelled/unknown turns and composer vs settings/terminal input; inspect actual host types or documented interfaces. No invented DOM selectors or APIs.

Dependencies: none. P5/P6 depend on this gate passing.

### P2 — Catalog, persistence, and Six Biomes vertical slice
Scope: extend stats/catalog and add a dedicated event reducer; wire qualified input to per-theme progress and a visible Six Biomes card. Add all metadata with stable IDs, keeping unimplemented predicates explicitly pending until their tasks land.

Acceptance: old stats and all 19 unlock timestamps survive migration; absent new counters start at zero. Finite validated counters, theme sets, minimal identifiers, discovery timestamps, and new preferences round-trip. No prompt/reply text persists. Reset clears all new state and pending timers, pins, equipped titles, postcard discoveries, and active sequences. Theme switching alone cannot advance Six Biomes.

Verification: legacy/malformed/empty storage fixtures, six-theme 99/100 boundaries, duplicate events, reload persistence, reset during an active sequence. Avoid storage writes on every keystroke; retain batched persistence and bounded transient state.

Dependencies: P1. Preserve #10's persistence boundary rather than adding a competing synchronization system.

### P3 — Human timing path
Scope: Cruise Control, Afterburner, Ghost Chaser, Pocket Drummer, Stairway to Flow, Back in Bloom; implement reusable windows/session expiry and qualifying speed progress.

Acceptance: exact issue rules and P1 timing definitions; elapsed-time division rather than legacy burst values. No speed credit for paste/drop/dictation/repeat/synthetic/programmatic input or unknown provenance. Commit IME once for eligible non-speed counters. Thread/editor changes and reload invalidate active windows/sequences; idle return preserves only the required gap.

Verification: fake-clock positive, near-miss and replay cases per predicate; 30-second boundaries, 99/100 characters, 5-second vs >5-second gaps, 40/80 WPM thresholds, three-window baseline plus fourth-window improvement, bucket 20% edges, session 10-minute edges, returning 99/100 characters, and IME/bulk input exclusions.

Dependencies: P2.

### P4 — Observable revision path
Scope: The Seamster, Less But Better, Revision Is a Superpower, and hidden Plot Twist. Add beforeinput/input/composition/history capture and draft lifecycle handling independent of visual effects.

Acceptance: three distinct non-overlapping 1–20-character replacements in a >=200-character draft; qualifying reduction and subsequent insertion after >=300 characters; five distinct drafts each with >=100 entered characters followed by replacement; undo→redo→40 newly entered characters in the same draft. No semantic quality claims or persisted text. Unknown revisions fail conservatively.

Verification: each rule's positive/near-miss/replay cases; overlapping and shifted ranges; grapheme/emoji boundaries; 10%/30% reduction edges; Enter-as-newline; confirmed submit and clear/new-input; repeated edits in one draft; history not counted as fresh input; navigation and reset invalidation.

Dependencies: P2 and P1 editor contract.

### P5 — Observed Agent collection
Scope: qualifying reply adapter through reducer, persistence, and visible progress for Hello Co-Pilot, Bento Box, Symphony in Three Turns, Lantern Keeper, Perfect Landing, Mission Control, The Long Thread.

Acceptance: all seven issue rules; 20–80 inclusive Bento range, five >=20-word complete replies, three replies same thread/session, ten same thread across sessions, three distinct threads, and reply-start theme for six themes. Store only needed counters/identifiers; deduplicate completion and new-output events across remount/replay/reload without storing text. Define bounded retention using host identity/order guarantees; if unavailable, surface the limitation rather than evicting IDs in a way that permits replay awards.

Verification: positive/near-miss/idempotency per award; 19/20/80/81 words; two concurrent threads; route change during finish; observed midway; cancelled/failed/unknown outcome; zero new output; replay, scrolling, remount, navigation, expand/collapse. Browser integration must prove genuine streaming still counts.

Dependencies: P1 capability gate, P2. Reuse #24's canonical counting interface if present; any minimal adapter work here protects new awards, not a full replacement of legacy effects counting.

### P6 — Together choreography
Scope: Pass the Baton, Rally Not a Race, Weave Together, Matching Jackets, Twin Engines; add the ephemeral manually-entered duck condition for Rubber Duck Has Entered the Chat.

Acceptance: exact composer-scoped ordered sequences; fresh input consumed once per reply. Weave requires prior complete reply→80 characters→revision→next complete reply, same thread. Theme changes invalidate Matching Jackets even if switched back. Twin Engines requires an earlier qualifying window in the same thread/session. Duck detection stores only a transient flag; paste/unknown manual provenance cannot qualify.

Verification: positive, threshold-minus-one, replay and out-of-order cases per rule; settings/terminal input; cross-thread completion; newline Enter; repeated completion; partial/cancelled turns; theme round-trip; session expiry; duck paste and grapheme composition.

Dependencies: P3, P4, P5.

### P7 — Hidden rules and effects-off reachability
Scope: Don't Panic, There Is No Spoon, Petal to the Metal, Silent Disco, Temporal Pincer, Lucky Seven, Quiet Finale, Here Be Dragons; integrate the two secrets from P4/P6. Add a default-on particles toggle (preserve the density range) and separate observation/reward evaluation from effect rendering.

Acceptance: exact combo endings 42/101/77 with required themes; qualifying Sakura 80 WPM window; direct combo 100 under disabled sound, both shake paths, and lightning; local-hour crossing within 30 seconds each side; complete reply with specified effects disabled throughout; five OTHER secrets trigger Dragons once. All-effects-off observation remains usable with Power Mode/agent observation enabled. No invented requirement to enable audio/motion.

Verification: threshold ±1 and overshoot, no award before exact combo ends, paste contamination, theme/settings changes, hour/midnight and clock discontinuities, 30-second boundary, disabled particles actually rendering none, fifth-secret batch and replay. Inspect storage for absence of content.

Dependencies: P3–P6.

### P8 — Gallery discovery experience
Scope: Human/Agent/Together and unlocked-only filters, friendly progress, anonymous secret cards, discovery dates.

Acceptance: 51 total catalog entries; locked secrets disclose no title, requirement, icon, progress, tooltip, accessible name, DOM data attribute or hidden rendered text. Optional hints must be explicitly authored and non-spoiling. Reveal only after unlock; preserve dates after reload. Visible progress follows documented counters including resettable session progress.

Verification: filter combinations and empty states; DOM/accessibility assertions before and after hidden unlock; storage reload; no leaks through search/filter labels; one live browser path each for Human, Agent, Together and secret discovery.

Dependencies: P2–P7.

### P9 — Optional HUD rewards and postcard
Scope: one visible challenge pin beside WPM, optional static personal-best ghost marker for speed, equip/unequip one cosmetic title, local session postcard in Settings.

Acceptance: pins never expose a locked secret; one pin/title maximum, validated on reload/reset. Rhythm Mage at five Human, Co-Pilot at five Agent, Duet Captain at three Together, Secret Cartographer at five hidden, using the explicit counting policy. Postcard reports session bests, newly discovered badges and one visible next challenge; no interruption or remote data. Session rolls over at expiry/reload; postcard does not leak secret goals. All-complete collection has a friendly no-next-challenge state.

Verification: thresholds, legacy title eligibility, pin replacement/unpin, equip/unequip, reload, reset, timer rollover, hidden eligibility, and HUD with effects disabled. Ensure updates do not move focus or obstruct typing.

Dependencies: P8 and session reducer.

### P10 — Feedback, documentation, and integration gate
Scope: replace per-award notification fanout with one coalesced notification per unlock batch, category-specific brief flourishes, count and working gallery link; add static reduced-motion/effects-off feedback. Update README and developer catalog/test instructions.

Acceptance: simultaneous predicates including Dragons/title milestones do not flood the screen; one accessible announcement and navigable gallery action. Follow effective motion preferences from #13 where available; otherwise the new feedback must at least respect OS reduced motion without claiming #13 globally fixed. Dynamic preference changes honored. Cosmetic effects never gate earning. README says 51 achievements and explains categories, observation, windows, optional rewards and secret discovery without solutions.

Verification: table-driven tests enumerate all 32 predicates with positive/near-miss/replay cases; timed rules use deterministic clocks. Run typecheck, build, new reducer/UI/browser suites, and existing power-engine, paste-ordnance, thread-switch, agent-attribution browser regressions documented in tests/README.md. Use BetterWright for live browser verification, inspect proof screenshots, and test reduced motion plus effects-off. Record exact commands/results and baseline failures; inspect persisted payloads and exercise long sessions to check bounded memory and no per-input storage churn.

Dependencies: P7–P9.

## Coordination and completion boundaries

Issues #10, #11, #13 and #24 were all open when inspected. Recheck their landed interfaces at build start: #10 owns concurrent persistence/reset coordination; #11 owns legacy Night Owl correctness; #13 owns overall motion precedence; #24 owns legacy expand/collapse counting. Preserve or reuse their changes without duplicating those full fixes. New awards must still satisfy their own provenance, replay and static-feedback requirements independently.

Build completion requires all 32 awards reachable from trustworthy supported events, all 51 IDs represented, no secret disclosure before unlock, compatibility/reset verified, and acceptance evidence recorded. Unsupported lifecycle evidence is an explicit implementation dependency, not permission to infer success. No human decision is required to review this plan; the host capability check is the first build gate.

## Build record

Implemented following the approved DOM-adapter decision. See [verification](verification.md) for results and the explicit distinction between fixture/contract tests and live provider or native-IME verification. Implementation was grouped into core rules/adapters and integrated presentation commits because the vertical slices share one reducer and event contract.
