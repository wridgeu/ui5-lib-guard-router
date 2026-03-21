# Feature: navTo() Preflight Guard Evaluation

> **Status**: Implemented. See [architecture.md](../reference/architecture.md) for the two-entry-point design and [Router.ts](../../packages/lib/src/Router.ts) for the implementation.

## Problem

The library's guard model runs guards inside the `parse()` override, which intercepts all navigation paths. For browser-initiated navigation (back/forward, URL bar), this is the only viable interception point. But for programmatic `navTo()` calls, `parse()` runs _after_ UI5 has already pushed a history entry via `HashChanger.setHash()`. When a guard blocks or redirects, `replaceHash()` repairs the current entry but cannot undo the push. The result: guarded programmatic navigations leave duplicate or polluted browser history entries.

## Solution

Override `navTo()` to run the same shared guard pipeline (`_evaluateGuards`) _before_ calling `super.navTo()`. This gives two entry points into one pipeline:

- **`navTo()` preflight**: guards run before the hash changes. Blocked navigations never push a history entry. Redirected navigations go directly to the final target.
- **`parse()` fallback**: guards run after the hash changes (browser back/forward, URL bar, direct `HashChanger.setHash()`). Best-effort hash repair via `replaceHash()`.

A `_preflightApprovedHash` flag tells `parse()` to skip guard re-evaluation for navigations already approved by the preflight.

## Key Design Decisions

| Decision                  | Choice                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| Preflight flag            | `_preflightApprovedHash: string \| null`: lightweight, matches `_suppressedHash` pattern  |
| Redirect during preflight | Bypass preflight via `_redirecting` flag, matching existing redirect-bypass-guards design |
| Async navTo timing        | Hash deferred until guard resolves, no premature hash change                              |
| Same-hash redirect        | Still goes through `_redirect()` / `navTo()` so `componentTargetInfo` is preserved        |
| Guard execution count     | Exactly once per navigation via `_preflightApprovedHash` handshake                        |
| Generation counter        | Shared `_parseGeneration` for both paths                                                  |

## Non-Goals

- No changes to the public guard API (`addGuard`, `addRouteGuard`, `addLeaveGuard`)
- No global `HashChanger` replacement or history monkey-patching
- No separate guard semantics for programmatic vs browser-driven navigation
