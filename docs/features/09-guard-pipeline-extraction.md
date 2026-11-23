# Guard Pipeline Extraction

> **Status**: Implemented. `GuardPipeline` (`packages/lib/src/GuardPipeline.ts`) owns guard storage and evaluation; the router delegates to it.

## Context

Issue #40. The guard evaluation logic was ~200 lines of private methods and three storage fields in `Router.ts`. It depends only on the guard arrays, the context and the abort signal, not on router state (`_currentHash`, the phase, settlement). After the state machine (#38) and the navigation attempt (#39) landed, that boundary was clear enough to extract.

## Decision

`GuardPipeline` owns guard storage and all evaluation. The Router validates input, resolves overloads, and calls `pipeline.evaluate()`.

Rejected alternatives:

- **A stateless pipeline** that receives the guard arrays as arguments. It leaks `Map<string, GuardFn[]>` across the boundary, and tests would still have to build those maps.
- **A standalone function.** No natural place for guard storage; same leak.

## API

```typescript
class GuardPipeline {
	addGlobalGuard(guard: GuardFn): void;
	removeGlobalGuard(guard: GuardFn): void;
	addEnterGuard(route: string, guard: GuardFn, before?: GuardFn): void;
	removeEnterGuard(route: string, guard: GuardFn): void;
	addLeaveGuard(route: string, guard: GuardFn, before?: GuardFn): void;
	removeLeaveGuard(route: string, guard: GuardFn): void;

	evaluate(
		context: GuardContext,
		options?: { skipLeaveGuards?: boolean; alsoLeaving?: string[]; alsoEntering?: string[] },
	): GuardDecision | Promise<GuardDecision>;

	clear(): void;
}
```

- `before` inserts a guard in front of another guard of the same route. With `inheritance: "pattern-tree"`, `addRoute()` uses it to put the guards a new route inherits from shallower routes in front of the route's own deeper ones.
- `skipLeaveGuards` is set on redirect hops (see [11](./11-guards-on-redirect-targets.md)).
- `alsoLeaving` / `alsoEntering` name the greedy routes that are left or entered with the main ones. Their guards run after those of `context.fromRoute` / `context.toRoute`, with the same context.
- `evaluate()` stays synchronous while every guard returns a plain value and returns a Promise from the first thenable on.

## Design rules

- **No input validation.** The pipeline trusts the Router. The `typeof guard !== "function"` checks and their warnings stay on the Router (`_isFn`).
- **No `RouteGuardConfig` handling.** The Router resolves the `GuardFn | RouteGuardConfig` overload and calls `addEnterGuard` / `addLeaveGuard`.
- **`evaluate()` gets a complete `GuardContext`**, signal included. An empty `context.fromRoute` skips leave guards (the first navigation, or after a hash that matched no route).
- **Methods return `void`.** Fluent chaining is a Router concern.
- **Only `sap/base/Log`** from UI5: a stateless utility with no coupling to the Router or the component lifecycle.

## Evaluation

Order: leave guards (`fromRoute`, then `alsoLeaving`), global guards, route enter guards (`toRoute`, then `alsoEntering`). The first result that is not `true` ends the run. Between async steps the pipeline checks `context.signal.aborted` and blocks if it is set. Each guard array is copied before iteration, so a guard can remove itself (a one-shot guard) without affecting the current run.

| Guard returns          | Decision                                   |
| ---------------------- | ------------------------------------------ |
| `true`                 | `{ action: "allow" }`                      |
| `false`                | `{ action: "block" }`                      |
| non-empty string       | `{ action: "redirect", target: <string> }` |
| `GuardRedirect` object | `{ action: "redirect", target: <object> }` |
| any other value        | logs a warning, `{ action: "block" }`      |
| throws or rejects      | `{ action: "error", error }`               |

Leave guards are boolean-only: any other value logs a warning and blocks.

A guard that throws or rejects is logged with `Log.error` and re-thrown; `evaluate()` turns it into an `error` decision. If the signal is already aborted, the error is swallowed and the guard counts as a block. [10](./10-navigation-outcome-error.md) has the design.

## Module exports

- `GuardDecision`: the normalized result, an inter-module contract between pipeline and Router.
- `isPromiseLike`: duck-typed thenable check, shared with `Router.ts` and `GuardModules.ts`.
- `nameGuard`: `GuardModules.ts` names manifest guards after their module. The error log of a throwing guard then shows the name: `Enter guard [1] "checks#1" on route "admin" threw, navigation failed`.
- `LOG_COMPONENT`, the log component of the whole library. (`isPromiseResolver`, originally exported here, was moved to `Ui5Internals.ts` alongside the other UI5-private adapters.)

## Router side

The Router holds `private _pipeline = new GuardPipeline()`. Public guard methods validate, resolve overloads, then delegate:

```typescript
addGuard(guard: GuardFn): this {
	if (!this._isFn(guard, "addGuard")) return this; // warns "addGuard: not a function, ignoring"
	this._pipeline.addGlobalGuard(guard);
	return this;
}
```

`_createGuardContext(routeInfo, toHash, signal, chain?)` builds the full context (route and hash fields, `signal`, `bag`, `toMeta` / `fromMeta`, `ownerComponent`). `_evaluateGuards(context, redirectHop)` calls `evaluate()` with the greedy routes and `skipLeaveGuards: redirectHop`.

`destroy()` calls `_pipeline.clear()`. `stop()` does not: guard registrations survive a stop and restart.

Router state stays on the Router: decision application (`_applyPreflightDecision`, `_applyDecision`, `_redirect`), settlement, the phase state machine, hash restore, unknown-route warnings (`_handleUnknownRouteRegistration`, which needs `getRoute()`) and `isRouteGuardConfig`. No public API changed.

## Tests

`packages/lib/test/qunit/unit/GuardPipeline.qunit.ts` and `GuardPipelineAsync.qunit.ts` test the pipeline alone: `new GuardPipeline()`, add guards, call `evaluate()`, assert the decision. No Router, HashChanger or UI5 runtime. They cover the decisions above, pipeline order and short-circuit, mixed sync and async chains, aborts between guards, self-removal during a run, invalid return values, throws and rejections, `clear()`, add and remove by reference, and an empty `fromRoute`. Hash changes, history, settlement, redirects and phases are tested through the Router.
