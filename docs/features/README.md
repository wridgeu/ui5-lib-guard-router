# Feature Notes

Design records for `ui5.guard.router.Router`: shipped features, rejected alternatives and open proposals.

## Implemented Capabilities

- Global enter guards (`addGuard` / `removeGuard`)
- Per-route enter guards (`addRouteGuard` / `removeRouteGuard`)
- Per-route leave guards (`addLeaveGuard` / `removeLeaveGuard`)
- Sync-first execution with async fallback
- Per-call guard bypass (`navTo(..., { skipGuards: true })`)
- Guard results: allow (`true`), block (`false`), redirect (string / `GuardRedirect`)
- `navTo()` preflight: guards run before the hash changes
- Concurrent navigation handling via generation counter and `AbortSignal`
- Navigation settlement (`navigationSettled()`, `NavigationOutcome`)
- Browser history kept as the user left it on block/redirect, browser back/forward included ([Browser history](../../packages/lib/README.md#browser-history))
- Guards of greedy routes (`greedy: true`) run with those of the first match
- Guard evaluation on redirect targets with loop detection
- Declarative manifest-based guard and metadata configuration
- Route metadata (`getRouteMeta` / `setRouteMeta`, `toMeta` / `fromMeta` on GuardContext)
- Owner component on GuardContext (`ownerComponent`) for component-scoped state in manifest guards
- Typed constructor config (`GuardRouterConfig`) for creating the router in code
- Pattern-tree inheritance for guards and metadata (`inheritance: "pattern-tree"`)

## Documents

One decision record per feature, in the order they were written. Each document starts with a `**Status**:` line that this table repeats: **Implemented**, Proposed or Rejected.

| #   | Document                                                                                                        | Type                  | Priority | Depends On | Status                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------- | --------------------- | -------- | ---------- | ------------------------------------------------------------------------------- |
| 01  | [Leave Guards](./01-leave-guards.md)                                                                            | Feature               | High     | None       | **Implemented**                                                                 |
| 02  | [Guard Bypass](./02-guard-bypass.md)                                                                            | Feature               | Low      | None       | **Implemented**                                                                 |
| 03  | [Transition Object](./03-transition-object.md)                                                                  | Feature               | Medium   | None       | Proposed                                                                        |
| 04  | [Route Metadata](./04-route-metadata.md)                                                                        | Feature               | Low      | None       | **Implemented**                                                                 |
| 05  | [Async Rewrite Analysis](./05-async-rewrite-analysis.md)                                                        | Architecture analysis |          |            | Rejected: sync-first is correct for UI5, refactor to a unified pipeline instead |
| 06  | [navTo Preflight](./06-navto-preflight.md)                                                                      | Optimization          | High     | None       | **Implemented**                                                                 |
| 07  | [Vendored OpenUI5 Router Parity](./07-vendored-openui5-router-parity.md)                                        | Feature               | Medium   | None       | **Implemented**                                                                 |
| 08  | [Declarative Manifest Guards](./08-declarative-manifest-guards.md)                                              | Feature               | High     | None       | **Implemented**                                                                 |
| 08b | [Multi-Guard Modules, Cherry-Pick Syntax, Pattern 5 Loading](./08b-multi-guard-modules-and-pattern5-loading.md) | Feature               | High     | 08         | **Implemented**                                                                 |
| 09  | [Guard Pipeline Extraction](./09-guard-pipeline-extraction.md)                                                  | Refactoring           | Medium   | #38, #39   | **Implemented**                                                                 |
| 10  | [NavigationOutcome.Error](./10-navigation-outcome-error.md)                                                     | Refactoring           | Medium   | 09         | **Implemented**                                                                 |
| 11  | [Guards on Redirect Targets](./11-guards-on-redirect-targets.md)                                                | Feature               | High     | #38, #39   | **Implemented**                                                                 |
| 12  | [Lazy Resolution Error Handling](./12-lazy-resolution-error-handling.md)                                        | Feature               | High     | 04         | **Implemented**                                                                 |

## Status Notes

- `01` leave guards: shipped.
- `02` guard bypass: shipped as the `skipGuards` option on `navTo()`. Updating application state so guards pass is still the preferred approach.
- `03` transition object: open proposal.
- `04` route metadata: `getRouteMeta`/`setRouteMeta`, `toMeta`/`fromMeta` on `GuardContext`, pattern-tree inheritance with lazy resolution and caching (PR #61, issue #62).
- `05` async rewrite: rejected; its recommended unified pipeline shipped as `09`.
- `06` navTo preflight: shipped.
- `07` vendored upstream router parity: raw upstream snapshots, executable ports, and sync/verify scripts. The ports run in the `test:qunit` lane; CI runs the verify script.
- `08`/`08b` declarative manifest guards and multi-guard modules: shipped.
- `09` guard pipeline extraction: `GuardPipeline` owns guard storage and evaluation; the router delegates.
- `10` NavigationOutcome.Error: a guard that throws settles as `Error`, distinct from an intentional `Blocked`.
- `11` guards on redirect targets: each redirect hop runs the global and route enter guards of its target (leave guards run on the first hop only), with visited-set and depth-cap loop detection.
- `12` lazy resolution error handling: `getRouteMeta` warns for unknown routes, `setRouteMeta` follows `unknownRouteRegistration`. Guard inheritance is expanded eagerly at `initialize()` / `addRoute()`, not lazily.

## Framework Comparison Summary

| Feature               | Vue | Angular | React | TanStack | Ember | Nuxt | **ui5.guard** | After Features |
| --------------------- | --- | ------- | ----- | -------- | ----- | ---- | ------------- | -------------- |
| Global enter guard    | Yes | Yes     | No    | Yes      | Yes   | Yes  | **Yes**       | Yes            |
| Per-route enter guard | Yes | Yes     | No    | Yes      | Yes   | Yes  | **Yes**       | Yes            |
| Leave guard           | Yes | Yes     | Yes   | Yes      | Yes   | No   | **Yes**       | Yes            |
| Guard bypass          | No  | No      | No    | Yes      | No    | No   | **Yes**       | Yes            |
| Transition retry      | No  | No      | No    | No       | Yes   | No   | **No**        | **03**         |
| Route metadata        | Yes | Yes     | No    | Yes      | No    | No   | **Yes**       | Yes            |
| Async support         | Yes | Yes     | Yes   | Yes      | Yes   | Yes  | **Yes**       | Yes            |
| Redirect              | Yes | Yes     | Yes   | Yes      | Yes   | Yes  | **Yes**       | Yes            |
| Clean history         | Yes | Yes     | Yes   | Yes      | Yes   | Yes  | **Yes**       | Yes            |
