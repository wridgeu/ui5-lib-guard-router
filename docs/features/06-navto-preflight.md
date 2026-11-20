# Feature: navTo() Preflight Guard Evaluation

> **Status**: Implemented. See [architecture.md](../reference/architecture.md) for the two-entry-point design and [Router.ts](../../packages/lib/src/Router.ts) for the implementation.

## Problem

Guards run in the `parse()` override, which sees every hash change. For browser navigation (back/forward, URL bar) it is the only interception point. For `navTo()`, though, `parse()` runs _after_ UI5 has pushed a history entry via `HashChanger.setHash()`. When a guard blocks or redirects, `replaceHash()` repairs the current entry but cannot undo the push. Guarded programmatic navigations left duplicate or polluted history entries.

## Solution

`navTo()` runs the same guard pipeline (`_evaluateGuards()`, which calls `_pipeline.evaluate()`) _before_ calling `super.navTo()`. One pipeline has two entry points:

- **`navTo()` preflight**: guards run before the hash changes. A blocked navigation never pushes a history entry. A redirected navigation goes straight to the final target.
- **`parse()` fallback**: guards run after the hash changes (back/forward, URL bar, direct `HashChanger.setHash()`). The router undoes a refused hash change, see [Browser history](../../packages/lib/README.md#browser-history).

After an allowed preflight, the router enters the committing phase (origin `"preflight"`), so `parse()` commits without running the guards again.

The `navToPreflight` router option selects the behavior: `"guard"` (default) as above, `"bypass"` skips guards for `navTo()`, `"off"` leaves guarding to `parse()` after the hash change.

## Decisions

| Decision                  | Choice                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Preflight flag            | Committing phase with origin `"preflight"`: lightweight, like `_suppressedHash`                                                                                                            |
| Redirect during preflight | Each hop is guarded in `_redirect()` ([Feature 11](./11-guards-on-redirect-targets.md)); the final `navTo()` runs in the committing phase with origin `"redirect"` and skips the preflight |
| Async navTo timing        | The hash changes only after the guards resolve                                                                                                                                             |
| Same-hash redirect        | Still goes through `_redirect()` / `navTo()`, so `componentTargetInfo` is preserved                                                                                                        |
| Guard execution count     | Once per navigation, through the committing-phase handshake                                                                                                                                |
| Generation counter        | `_parseGeneration`, shared by both entry points                                                                                                                                            |

## Non-goals

- No change to the public guard API (`addGuard`, `addRouteGuard`, `addLeaveGuard`)
- No global `HashChanger` replacement or history monkey-patching
- No separate guard semantics for programmatic and browser navigation
