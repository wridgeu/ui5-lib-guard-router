# Feature Proposals

Proposed enhancements for `ui5.guard.router.Router`, derived from framework comparison analysis (docs/alt/) and TanStack Router source code study.

## Current State

The router provides:

- Global enter guards (`addGuard` / `removeGuard`)
- Per-route enter guards (`addRouteGuard` / `removeRouteGuard`)
- Per-route leave guards (`addLeaveGuard` / `removeLeaveGuard`)
- Sync-first execution with async fallback
- Guard results: allow (`true`), block (`false`), redirect (string / `GuardRedirect`)
- Concurrent navigation handling via generation counter
- Clean history on block/redirect

## Proposed Features

| #   | Feature                                          | Priority | Depends On | Status          |
| --- | ------------------------------------------------ | -------- | ---------- | --------------- |
| 01  | [Leave Guards](./01-leave-guards.implemented.md) | High     | None       | **Implemented** |
| 02  | [Guard Bypass](./02-guard-bypass.md)             | Low      | None       | Deprioritized   |
| 03  | [Transition Object](./03-transition-object.md)   | Medium   | None       | Proposed        |
| 04  | [Route Metadata](./04-route-metadata.md)         | Low      | None       | Proposed        |

## Architecture Analysis

| #   | Topic                                                    | Conclusion                                                                            |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 05  | [Async Rewrite Analysis](./05-async-rewrite-analysis.md) | Not recommended. Sync-first is correct for UI5. Refactor to unified pipeline instead. |

## Implementation Order

```
Phase 1: Leave Guards (01) — DONE

Phase 2: Transition Object (03)
  → Enables "redirect to login, resume after auth" pattern
  → retry() re-runs guards (no bypass needed if state is updated)

Phase 3: Route Metadata (04)
  → Convenience layer, reduces guard boilerplate
  → Independent, can be implemented anytime

Deprioritized: Guard Bypass (02)
  → Most use cases are better solved by updating application state
    so guards pass naturally (e.g., set isDirty=false before navigating)
  → Revisit only if a concrete use case arises that can't be handled
    by proper guard logic
```

## Framework Comparison Summary

| Feature               | Vue | Angular | React | TanStack | Ember | Nuxt | **ui5.guard** | After Features |
| --------------------- | --- | ------- | ----- | -------- | ----- | ---- | ------------- | -------------- |
| Global enter guard    | Yes | Yes     | No    | Yes      | Yes   | Yes  | **Yes**       | Yes            |
| Per-route enter guard | Yes | Yes     | No    | Yes      | Yes   | Yes  | **Yes**       | Yes            |
| Leave guard           | Yes | Yes     | Yes   | Yes      | Yes   | No   | **Yes**       | Yes            |
| Guard bypass          | No  | No      | No    | Yes      | No    | No   | **No**        | Deprioritized  |
| Transition retry      | No  | No      | No    | No       | Yes   | No   | **No**        | **03**         |
| Route metadata        | Yes | Yes     | No    | Yes      | No    | No   | **No**        | **04**         |
| Async support         | Yes | Yes     | Yes   | Yes      | Yes   | Yes  | **Yes**       | Yes            |
| Redirect              | Yes | Yes     | Yes   | Yes      | Yes   | Yes  | **Yes**       | Yes            |
| Clean history         | Yes | Yes     | Yes   | Yes      | Yes   | Yes  | **Yes**       | Yes            |
