# Guard Pipeline Extraction

## Context

Issue #40: extract the guard evaluation logic from `Router.ts` into a standalone `GuardPipeline` class.

The guard pipeline spans ~200 lines across 8 private methods and 3 storage fields in `Router.ts` (1,067 lines total). The logic is pure — it depends only on guard arrays, the context, and the abort signal. It has no dependency on router state (`_currentHash`, phase state machine, settlement resolvers, etc.) beyond reading the current route name to look up leave guards.

Issues #38 (state machine) and #39 (navigation attempt) are merged, making the boundary between pipeline logic and router state management clear.

## Decision

Full extraction: `GuardPipeline` owns guard storage and all evaluation logic. The Router delegates guard management and calls `pipeline.evaluate()`.

### Why not stateless (evaluation only)?

A stateless pipeline that receives guard arrays as arguments leaks internal structure (`Map<string, GuardFn[]>`) across the boundary and doesn't improve testability — tests would still need to construct the maps manually. Owning storage makes the pipeline self-contained.

### Why not a standalone function?

No natural place for guard storage management. Same leaky-internals problem as the stateless approach.

## GuardPipeline class

### File

`packages/lib/src/GuardPipeline.ts`

### Public API

```typescript
class GuardPipeline {
	addGlobalGuard(guard: GuardFn): void;
	removeGlobalGuard(guard: GuardFn): void;
	addEnterGuard(route: string, guard: GuardFn): void;
	removeEnterGuard(route: string, guard: GuardFn): void;
	addLeaveGuard(route: string, guard: LeaveGuardFn): void;
	removeLeaveGuard(route: string, guard: LeaveGuardFn): void;

	evaluate(context: GuardContext): GuardDecision | Promise<GuardDecision>;

	clear(): void;
}
```

### Design principles

- **No input validation.** The pipeline trusts its caller (the Router). All `typeof guard !== "function"` checks and warning logs stay on the Router.
- **No `RouteGuardConfig` handling.** The Router resolves the `GuardFn | RouteGuardConfig` overload and calls `addEnterGuard` / `addLeaveGuard` separately.
- **`evaluate()` receives a complete `GuardContext`** (with signal already attached). The Router builds the full context (including signal) before calling. `context.fromRoute` controls leave-guard lookup: when it is the empty string, leave guards are skipped entirely (initial navigation where no route is active yet).
- **Methods return `void`**, not `this`. Fluent chaining is a Router API concern.

### Dependencies

The pipeline imports `sap/base/Log` for guard validation warnings and error logging (thrown guards). This is the only `sap/*` dependency and is acceptable because `Log` is a stateless utility with no runtime coupling to the Router or UI5 component lifecycle. All other imports come from `./types`.

### Internal structure

**Private fields:**

- `_globalGuards: GuardFn[]`
- `_enterGuards: Map<string, GuardFn[]>`
- `_leaveGuards: Map<string, LeaveGuardFn[]>`

**Private methods (moved from Router):**

- `_runLeaveGuards(context)` — uses `context.fromRoute` for leave-guard lookup
- `_runEnterGuards(toRoute, context)` — reads `this._globalGuards` directly (no longer needs `globalGuards` parameter)
- `_runRouteGuards(toRoute, context)`
- `_runGuards(guards, context)`
- `_continueGuardsAsync(pendingResult, guards, currentIndex, context, onBlock, label, isLeaveGuard)`
- `_validateGuardResult(result)`
- `_validateLeaveGuardResult(result)`

**Guard map helpers** (`addToGuardMap`, `removeFromGuardMap`) become private methods on the class.

**Module-level utilities:**

- `isGuardRedirect` — private to module
- `isPromiseLike` — private to module (Router has its own copy to check whether `evaluate()`'s return is a Promise)

### Exported types

- `GuardDecision` — the normalized pipeline result, promoted from a Router-internal type to an inter-module contract:

```typescript
type GuardDecision = { action: "allow" } | { action: "block" } | { action: "redirect"; target: string | GuardRedirect };
```

### Result normalization

`evaluate()` maps raw `GuardResult` values from guards into `GuardDecision`:

| Guard returns          | Pipeline decision                          |
| ---------------------- | ------------------------------------------ |
| `true`                 | `{ action: "allow" }`                      |
| `false`                | `{ action: "block" }`                      |
| non-empty string       | `{ action: "redirect", target: <string> }` |
| `GuardRedirect` object | `{ action: "redirect", target: <object> }` |
| any other value        | logs warning, `{ action: "block" }`        |

Leave guards are boolean-only: any non-boolean return logs a warning and blocks.

### Error handling

If a guard function throws (sync) or its Promise rejects (async), the pipeline catches the error, logs it via `Log.error`, and re-throws. `evaluate()` catches the re-thrown error and returns `{ action: "error", error }`. If the context's abort signal is already aborted at the time of the error, the error is swallowed and the pipeline returns `false` (mapped to `{ action: "block" }`) — the navigation was cancelled, the error is expected. See `docs/features/10-navigation-outcome-error.md` for the full design.

### `clear()` behavior

Resets `_globalGuards` to an empty array and clears both `_enterGuards` and `_leaveGuards` maps.

## Router changes

### File

`packages/lib/src/Router.ts`

### New imports

```typescript
import GuardPipeline, { type GuardDecision } from "./GuardPipeline";
```

### New field

```typescript
private _pipeline = new GuardPipeline();
```

### Removed

- `_globalGuards`, `_enterGuards`, `_leaveGuards` fields
- `_evaluateGuards`, `_runLeaveGuards`, `_runEnterGuards`, `_runRouteGuards`, `_runGuards`, `_continueGuardsAsync`, `_validateGuardResult`, `_validateLeaveGuardResult` methods (8 methods)
- Module-level `isGuardRedirect`, `addToGuardMap`, `removeFromGuardMap` functions
- `GuardContextBase` type (Router now builds the full `GuardContext` with signal directly)

### Delegation pattern

Public guard methods keep validation and overload resolution, then delegate:

```typescript
addGuard(guard: GuardFn): this {
  if (typeof guard !== "function") {
    Log.warning("addGuard called with invalid guard, ignoring", undefined, LOG_COMPONENT);
    return this;
  }
  this._pipeline.addGlobalGuard(guard);
  return this;
}
```

Evaluation call sites change from:

```typescript
const decision = this._evaluateGuards(context, controller.signal);
```

to:

```typescript
const context: GuardContext = {
	toRoute,
	toHash,
	toArguments,
	fromRoute: this._currentRoute,
	fromHash: this._currentHash ?? "",
	signal: controller.signal,
};
const decision = this._pipeline.evaluate(context);
```

`destroy()` calls `this._pipeline.clear()` instead of manually clearing the three collections. `stop()` does **not** call `clear()` — it intentionally preserves guard registrations across stop/restart cycles, matching the current behavior.

### Unchanged

- `navTo()`, `parse()` — same control flow, just call `this._pipeline.evaluate()` instead of `this._evaluateGuards()`
- `_applyPreflightDecision`, `_applyDecision`, `_redirect`, `_blockNavigation`, `_commitNavigation`, `_restoreHash` — all Router state management
- `NavigationAttempt`, `RouterPhase`, phase state machine
- `_warnIfRouteUnknown` — stays on Router (needs `this.getRoute()`)
- `isRouteGuardConfig` — stays on Router (API overload resolution)
- Settlement logic
- All public API signatures

## Testing

### Existing tests

All 234 existing tests in `Router.qunit.ts` pass unchanged. The Router's public API does not change.

### New test file

`packages/lib/test/qunit/GuardPipeline.qunit.ts`

Focused unit tests for the pipeline in isolation — no Router, no HashChanger, no UI5 runtime. Just `new GuardPipeline()`, add guards, call `evaluate()`, assert the decision.

**Coverage areas:**

- Empty pipeline returns `{ action: "allow" }`
- Global guard blocks / allows / redirects
- Route-specific enter guard blocks / allows / redirects
- Leave guard blocks / allows
- Leave guard cannot redirect (validation → block)
- Pipeline order: leave → global enter → route enter
- Short-circuit on first non-true result
- Mixed sync/async guard chains
- Abort signal checked between async guards
- Guard self-removal during iteration (snapshot copy)
- Invalid return values → validation warnings → block
- Sync guard throws → error
- Async guard rejects → error
- Guard throws after signal aborted → block without logging
- `clear()` removes all guards
- Add/remove by reference semantics
- `context.fromRoute` empty string → leave guards skipped

**What pipeline tests do NOT cover:** hash changes, history, settlement, redirects, phase transitions. That is Router territory, already tested.

## Scope

- Internal refactor only — no public API changes
- No new dependencies beyond `sap/base/Log` (already used by Router)
- No changes to `packages/lib/src/types.ts`, `packages/lib/src/NavigationOutcome.ts`, or `manifest.json`
