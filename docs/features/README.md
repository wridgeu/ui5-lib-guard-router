# Feature Proposals

Proposed enhancements for `ui5.ext.routing.Router`, derived from framework comparison analysis (docs/alt/) and TanStack Router source code study.

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

| #   | Feature                                        | Priority | Depends On | Status          |
| --- | ---------------------------------------------- | -------- | ---------- | --------------- |
| 01  | [Leave Guards](./01-leave-guards.md)           | High     | None       | **Implemented** |
| 02  | [Guard Bypass](./02-guard-bypass.md)           | High     | None       | Proposed        |
| 03  | [Transition Object](./03-transition-object.md) | Medium   | 02         | Proposed        |
| 04  | [Route Metadata](./04-route-metadata.md)       | Low      | None       | Proposed        |

## Architecture Analysis

| #   | Topic                                                    | Conclusion                                                                            |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 05  | [Async Rewrite Analysis](./05-async-rewrite-analysis.md) | Not recommended. Sync-first is correct for UI5. Refactor to unified pipeline instead. |

## Implementation Order

Features 01 and 02 are independent and enable the most common patterns:

```
Phase 1: Leave Guards (01) + Guard Bypass (02)
  → Enables "unsaved changes?" and "save & navigate" patterns

Phase 2: Transition Object (03)
  → Enables "redirect to login, resume after auth" pattern
  → Depends on Guard Bypass for retrySkipGuards()

Phase 3: Route Metadata (04)
  → Convenience layer, reduces guard boilerplate
  → Independent, can be implemented anytime

Architecture: Unified Pipeline (from 05)
  → Refactor internal guard execution when implementing Phase 1
  → Not a separate feature, but a structural improvement
```

## Framework Comparison Summary

| Feature               | Vue | Angular | React | TanStack | Ember | Nuxt | **ui5.ext** | After Features |
| --------------------- | --- | ------- | ----- | -------- | ----- | ---- | ----------- | -------------- |
| Global enter guard    | Yes | Yes     | No    | Yes      | Yes   | Yes  | **Yes**     | Yes            |
| Per-route enter guard | Yes | Yes     | No    | Yes      | Yes   | Yes  | **Yes**     | Yes            |
| Leave guard           | Yes | Yes     | Yes   | Yes      | Yes   | No   | **Yes**     | Yes            |
| Guard bypass          | No  | No      | No    | Yes      | No    | No   | **No**      | **02**         |
| Transition retry      | No  | No      | No    | No       | Yes   | No   | **No**      | **03**         |
| Route metadata        | Yes | Yes     | No    | Yes      | No    | No   | **No**      | **04**         |
| Async support         | Yes | Yes     | Yes   | Yes      | Yes   | Yes  | **Yes**     | Yes            |
| Redirect              | Yes | Yes     | Yes   | Yes      | Yes   | Yes  | **Yes**     | Yes            |
| Clean history         | Yes | Yes     | Yes   | Yes      | Yes   | Yes  | **Yes**     | Yes            |
