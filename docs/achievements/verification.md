# Build verification — issue #32

## Implemented

All P1–P10 implementation slices are present: 32 new event-driven rules, 51-entry
catalog preserving old IDs, migration/reset, SDK canonical turn adapter, approved
DOM composer adapter, secret-safe gallery/filter/progress, pins and ghost marker,
category titles, local postcard, particles-off switch, coalesced accessible
feedback and static reduced-motion fallback. See `catalog.md` for the exact
compatibility and measurement boundaries. No related issue is claimed resolved.

## Checks

- `npm run test:achievements`: **26 tests pass**, including an explicit coverage
  assertion that every one of the 32 additions earned in a positive scenario.
- `npm run typecheck`: pass against SDK 0.6.132.
- `bb plugin build`: pass, frontend/backend/CSS artifacts generated.
- `git diff --check`: pass.
- BetterWright `achievements.browser.js`: pass (native keyboard events, Human,
  Agent, Together and secret unlocks; pane/queued/settings/terminal isolation;
  contenteditable replacement; submit/clear and one-use handoffs; hidden cards).
- BetterWright `achievements-persistence.browser.js`: pass (all 19 legacy IDs,
  old dates/counters, zero new history, pin/title reload, title thresholds,
  graphemes, unknown-provenance exclusion, content-free storage, reset).
- BetterWright `achievements-feedback.browser.js`: pass (one toast for simultaneous
  unlocks, gallery action, reduced motion, effects off, pending-toast reset).
- Existing BetterWright `power-engine.browser.js`: pass.
- Existing BetterWright `thread-switch.browser.js`: pass.
- Existing BetterWright `agent-attribution.browser.js`: pass.
- Existing BetterWright `paste-ordnance.browser.js`: pass using the unchanged
  test via the BetterWright Node client with a 120-second script budget. Initial
  CLI run timed out at 30 seconds. Extended run reported all 54 combo cases,
  six staggered detonations, singularity and pending caps passing.

Browser runs used isolated `/tmp` profiles. Initial default-profile launch failed
because that profile was read-only; no user browser profile was changed. The
integration proof was inspected and retaken full-page to include the complete
unlocked gallery and postcard. Native IME commit-once behavior uses a deterministic
trusted-event model; BetterWright does not expose raw CDP for OS IME automation.

## Practical limits for implementation review

The browser fixture uses production adapters/UI with SDK-shaped canonical events
and a minimal hook stub; it does not claim a live provider round trip or install
this worktree over the user's existing plugin. Public SDK declarations are checked
by TypeScript, and the internal composer layout was inspected in the installed BB
bundle and host source. Unsupported/ambiguous composer layouts fail closed. New
input awards intentionally observe supported BB composers. Legacy generic-field
effects/stats are unchanged. The live-provider and native-IME integration levels
should remain distinguished from the passing fixture/contract tests.

Draft comparisons are bounded to 100,000 UTF-16 units. Reply text is not retained:
word counts carry a single in-word flag across streamed chunks and reconcile at
completion. Per-thread lifetime counters scale with visited threads (capped at ten
per thread), and session maps expire after idle/reload. Multi-window stat merging
remains issue #10's existing boundary; this build adds no competing sync protocol.

## Follow-up review fixes

Regression coverage now includes native delete-to-empty followed by fresh input,
submission handoff preservation, undo restoration, visibility changes during an
in-flight request and between polls, stale cursor seeds/errors, and turns mixing
fully observed messages with messages whose start was missed. All 26 tests,
TypeScript, plugin build and diff checks pass after these fixes. The browser
results above are from the original build; these follow-ups use deterministic
adapter tests rather than claiming a new live-provider run.
