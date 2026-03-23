# Feature Notes

Feature notes for `ui5.guard.router.Router`, including shipped capabilities, historical design records, and future proposals derived from the [explorations](../explorations/README.md) and TanStack Router source code study.

## Implemented Capabilities

The router provides:

- Global enter guards (`addGuard` / `removeGuard`)
- Per-route enter guards (`addRouteGuard` / `removeRouteGuard`)
- Per-route leave guards (`addLeaveGuard` / `removeLeaveGuard`)
- Sync-first execution with async fallback
- Guard results: allow (`true`), block (`false`), redirect (string / `GuardRedirect`)
- Concurrent navigation handling via generation counter
- Clean history on programmatic block/redirect; best-effort for browser-initiated navigation
- Guard evaluation on redirect targets with loop detection

## Documents

| #   | Feature                                                                                                            | Priority | Depends On | Status          |
| --- | ------------------------------------------------------------------------------------------------------------------ | -------- | ---------- | --------------- |
| 01  | [Leave Guards](./01-leave-guards.implemented.md)                                                                   | High     | None       | **Implemented** |
| 02  | [Guard Bypass](./02-guard-bypass.md)                                                                               | Low      | None       | Deprioritized   |
| 03  | [Transition Object](./03-transition-object.md)                                                                     | Medium   | None       | Proposed        |
| 04  | [Route Metadata](./04-route-metadata.md)                                                                           | Low      | None       | Proposed        |
| 07  | [Vendored OpenUI5 Router Parity](./07-vendored-openui5-router-parity.md)                                           | Medium   | None       | Implemented     |
| 08  | [Declarative Manifest Guards](./08-declarative-manifest-guards.md)                                                 | High     | None       | Proposed        |
| 08b | [Multi-Guard Modules, Cherry-Pick Syntax, Pattern 5 Loading](./08b-multi-guard-modules-and-pattern5-loading.md)    | High     | 08         | Proposed        |
| 11  | [Guards on Redirect Targets](./11-guards-on-redirect-targets.md) ([plan](./11-guards-on-redirect-targets-plan.md)) | High     | #38, #39   | **Implemented** |

## Refactoring

| #   | Feature                                                                                                         | Priority | Depends On | Status          |
| --- | --------------------------------------------------------------------------------------------------------------- | -------- | ---------- | --------------- |
| 09  | [Guard Pipeline Extraction](./09-guard-pipeline-extraction.md) ([plan](./09-guard-pipeline-extraction-plan.md)) | Medium   | #38, #39   | **Implemented** |
| 10  | [NavigationOutcome.Error](./10-navigation-outcome-error.md) ([plan](./10-navigation-outcome-error-plan.md))     | Medium   | #09        | **Implemented** |

## Architecture Analysis

| #   | Topic                                                    | Conclusion                                                                            |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 05  | [Async Rewrite Analysis](./05-async-rewrite-analysis.md) | Not recommended. Sync-first is correct for UI5. Refactor to unified pipeline instead. |

## Optimizations

| #   | Feature                                    | Priority | Depends On | Status          |
| --- | ------------------------------------------ | -------- | ---------- | --------------- |
| 06  | [navTo Preflight](./06-navto-preflight.md) | High     | None       | **Implemented** |

## Status Notes

- `01` leave guards are implemented and shipped
- `02` guard bypass is deferred because most use cases are better handled by updating application state so guards pass naturally
- `03` transition object and `04` route metadata remain open proposals
- `06` navTo preflight is implemented and shipped
- `07` vendored upstream router parity is implemented as a dedicated parity lane with raw upstream snapshots, executable ports, sync/verify scripts, and CI coverage
- `09` guard pipeline extraction is implemented -- `GuardPipeline` class owns guard storage and evaluation, Router delegates
- `10` NavigationOutcome.Error is implemented -- guard throws produce `Error` settlements distinct from intentional `Blocked`
- `11` guards on redirect targets is implemented -- redirect chain hops evaluate the full guard pipeline with visited-set + depth-cap loop detection

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
