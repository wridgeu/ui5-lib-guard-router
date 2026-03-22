# Guard Pipeline Extraction — Implementation Plan

> **Status: Completed.** See `09-guard-pipeline-extraction.md` for the authoritative spec. Note: error handling behavior was later changed by #50 (`10-navigation-outcome-error.md`) — guard throws now produce `NavigationOutcome.Error` instead of `Blocked`.

**Goal:** Extract the guard evaluation logic from `Router.ts` into a standalone `GuardPipeline` class, keeping all public API and behavioral tests unchanged.

**Architecture:** `GuardPipeline` owns guard storage (3 fields) and all evaluation logic (8 methods). Router delegates guard management via one-line methods and calls `pipeline.evaluate()` from `navTo()` and `parse()`. The pipeline is a plain TypeScript class with no UI5 lifecycle coupling.

**Tech Stack:** TypeScript, UI5 (sap/base/Log), QUnit

**Spec:** `docs/features/09-guard-pipeline-extraction.md`

---

### Task 1: Create `GuardPipeline` with guard storage and management methods

**Files:**

- Create: `packages/lib/src/GuardPipeline.ts`

- [x] **Step 1: Create the file with imports, types, and utility functions**

Move `isGuardRedirect`, `isPromiseLike`, and `GuardDecision` from `Router.ts`. Export `GuardDecision` (Router needs it). Keep `isGuardRedirect` and `isPromiseLike` module-private (Router keeps its own copy of `isPromiseLike`).

```typescript
import Log from "sap/base/Log";
import type { GuardFn, GuardContext, GuardResult, GuardRedirect, LeaveGuardFn } from "./types";

// Uses the Router's log component to preserve backward-compatible log output.
// Guard evaluation messages remain under "ui5.guard.router.Router" rather than
// introducing a new observable component string.
const LOG_COMPONENT = "ui5.guard.router.Router";

function isGuardRedirect(value: unknown): value is GuardRedirect {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const { route } = value as GuardRedirect;
	return typeof route === "string" && route.length > 0;
}

/**
 * Promises/A+ thenable detection via duck typing.
 *
 * We intentionally do not use `instanceof Promise` because that misses
 * cross-realm Promises and PromiseLike/thenable objects.
 */
function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
	if ((typeof value !== "object" && typeof value !== "function") || value === null) {
		return false;
	}
	return typeof (value as PromiseLike<T>).then === "function";
}

/**
 * Normalized result of the guard decision pipeline.
 */
export type GuardDecision =
	| { action: "allow" }
	| { action: "block" }
	| { action: "redirect"; target: string | GuardRedirect };
```

- [x] **Step 2: Add the GuardPipeline class with storage fields and management methods**

```typescript
/**
 * Standalone guard evaluation pipeline.
 *
 * Owns guard storage (global, enter, leave) and runs the full
 * leave → global-enter → route-enter pipeline. Pure logic with
 * no dependency on Router state beyond the current route name
 * passed into evaluate().
 */
export default class GuardPipeline {
	private _globalGuards: GuardFn[] = [];
	private _enterGuards = new Map<string, GuardFn[]>();
	private _leaveGuards = new Map<string, LeaveGuardFn[]>();

	addGlobalGuard(guard: GuardFn): void {
		this._globalGuards.push(guard);
	}

	removeGlobalGuard(guard: GuardFn): void {
		const index = this._globalGuards.indexOf(guard);
		if (index !== -1) {
			this._globalGuards.splice(index, 1);
		}
	}

	addEnterGuard(route: string, guard: GuardFn): void {
		this._addToGuardMap(this._enterGuards, route, guard);
	}

	removeEnterGuard(route: string, guard: GuardFn): void {
		this._removeFromGuardMap(this._enterGuards, route, guard);
	}

	addLeaveGuard(route: string, guard: LeaveGuardFn): void {
		this._addToGuardMap(this._leaveGuards, route, guard);
	}

	removeLeaveGuard(route: string, guard: LeaveGuardFn): void {
		this._removeFromGuardMap(this._leaveGuards, route, guard);
	}

	/**
	 * Remove all registered guards.
	 */
	clear(): void {
		this._globalGuards = [];
		this._enterGuards.clear();
		this._leaveGuards.clear();
	}

	private _addToGuardMap<T>(map: Map<string, T[]>, key: string, guard: T): void {
		let guards = map.get(key);
		if (!guards) {
			guards = [];
			map.set(key, guards);
		}
		guards.push(guard);
	}

	private _removeFromGuardMap<T>(map: Map<string, T[]>, key: string, guard: T): void {
		const guards = map.get(key);
		if (!guards) return;
		const index = guards.indexOf(guard);
		if (index !== -1) guards.splice(index, 1);
		if (guards.length === 0) map.delete(key);
	}
}
```

- [x] **Step 3: Verify typecheck passes**

Run: `npm run typecheck` from repo root
Expected: PASS (new file compiles, Router unchanged yet)

- [x] **Step 4: Verify lint passes**

Run: `npm run lint` from repo root
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/lib/src/GuardPipeline.ts
git commit -m "refactor(router): add GuardPipeline class with guard storage management"
```

---

### Task 2: Move evaluation methods to GuardPipeline

**Files:**

- Modify: `packages/lib/src/GuardPipeline.ts`

Move all 8 evaluation methods from Router into the pipeline class. Key changes from the Router versions:

- `_evaluateGuards` becomes `evaluate` (public) — receives `GuardContext` directly (signal already included), uses `context.fromRoute` for leave-guard lookup
- `_runLeaveGuards` uses `context.fromRoute` directly (no separate `currentRoute` parameter)
- `_runEnterGuards` reads `this._globalGuards` directly (drops the `globalGuards` parameter)
- All other methods transfer as-is with minimal signature changes

- [x] **Step 1: Add the `evaluate` method (was `_evaluateGuards`)**

```typescript
/**
 * Run the full guard pipeline (leave -> global enter -> route enter) and
 * return a normalized decision. Stays synchronous when all guards return
 * plain values; returns a Promise only when an async guard is encountered.
 *
 * @param context - Complete guard context including AbortSignal.
 *   `context.fromRoute` controls leave-guard lookup: empty string skips leave guards.
 */
evaluate(context: GuardContext): GuardDecision | Promise<GuardDecision> {
	const hasLeaveGuards = context.fromRoute !== "" && this._leaveGuards.has(context.fromRoute);
	const hasEnterGuards =
		this._globalGuards.length > 0 || (context.toRoute !== "" && this._enterGuards.has(context.toRoute));

	if (!hasLeaveGuards && !hasEnterGuards) {
		return { action: "allow" };
	}

	const processEnterResult = (
		enterResult: GuardResult | Promise<GuardResult>,
	): GuardDecision | Promise<GuardDecision> => {
		if (isPromiseLike(enterResult)) {
			return enterResult.then((r: GuardResult): GuardDecision => {
				if (r === true) return { action: "allow" };
				if (r === false) return { action: "block" };
				return { action: "redirect", target: r };
			});
		}
		if (enterResult === true) return { action: "allow" };
		if (enterResult === false) return { action: "block" };
		return { action: "redirect", target: enterResult };
	};

	const runEnterPhase = (): GuardDecision | Promise<GuardDecision> => {
		const enterResult = this._runEnterGuards(context.toRoute, context);
		return processEnterResult(enterResult);
	};

	if (hasLeaveGuards) {
		const leaveResult = this._runLeaveGuards(context);

		if (isPromiseLike(leaveResult)) {
			return leaveResult.then((allowed: boolean): GuardDecision | Promise<GuardDecision> => {
				if (allowed !== true) return { action: "block" };
				if (context.signal.aborted) return { action: "block" };
				return runEnterPhase();
			});
		}
		if (leaveResult !== true) return { action: "block" };
	}

	return runEnterPhase();
}
```

- [x] **Step 2: Add `_runLeaveGuards` (uses `context.fromRoute` directly)**

```typescript
private _runLeaveGuards(context: GuardContext): boolean | Promise<boolean> {
	const registered = this._leaveGuards.get(context.fromRoute);
	if (!registered || registered.length === 0) return true;

	const guards = registered.slice();
	for (let i = 0; i < guards.length; i++) {
		try {
			const result = guards[i](context);
			if (isPromiseLike(result)) {
				return this._continueGuardsAsync(
					result,
					guards,
					i,
					context,
					(candidate) => this._validateLeaveGuardResult(candidate),
					"Leave guard",
					true,
				) as Promise<boolean>;
			}
			if (result !== true) return this._validateLeaveGuardResult(result);
		} catch (error) {
			Log.error(
				`Leave guard [${i}] on route "${context.fromRoute}" threw, blocking navigation`,
				String(error),
				LOG_COMPONENT,
			);
			return false;
		}
	}
	return true;
}
```

- [x] **Step 3: Add `_runEnterGuards` (reads `this._globalGuards` directly)**

```typescript
private _runEnterGuards(toRoute: string, context: GuardContext): GuardResult | Promise<GuardResult> {
	const globalResult = this._runGuards(this._globalGuards, context);

	if (isPromiseLike(globalResult)) {
		return globalResult.then((result: GuardResult) => {
			if (result !== true) return result;
			if (context.signal.aborted) return false;
			return this._runRouteGuards(toRoute, context);
		});
	}
	if (globalResult !== true) return globalResult;
	return this._runRouteGuards(toRoute, context);
}
```

- [x] **Step 4: Add remaining private methods (`_runRouteGuards`, `_runGuards`, `_continueGuardsAsync`, `_validateGuardResult`, `_validateLeaveGuardResult`)**

These transfer from Router with no signature changes:

```typescript
private _runRouteGuards(toRoute: string, context: GuardContext): GuardResult | Promise<GuardResult> {
	if (!toRoute || !this._enterGuards.has(toRoute)) return true;
	return this._runGuards(this._enterGuards.get(toRoute)!, context);
}

private _runGuards(guards: GuardFn[], context: GuardContext): GuardResult | Promise<GuardResult> {
	guards = guards.slice();
	for (let i = 0; i < guards.length; i++) {
		try {
			const result = guards[i](context);
			if (isPromiseLike(result)) {
				return this._continueGuardsAsync(
					result,
					guards,
					i,
					context,
					(candidate) => this._validateGuardResult(candidate),
					"Enter guard",
					false,
				);
			}
			if (result !== true) return this._validateGuardResult(result);
		} catch (error) {
			Log.error(
				`Enter guard [${i}] on route "${context.toRoute}" threw, blocking navigation`,
				String(error),
				LOG_COMPONENT,
			);
			return false;
		}
	}
	return true;
}

private async _continueGuardsAsync(
	pendingResult: PromiseLike<GuardResult>,
	guards: GuardFn[],
	currentIndex: number,
	context: GuardContext,
	onBlock: (result: unknown) => GuardResult,
	label: string,
	isLeaveGuard: boolean,
): Promise<GuardResult> {
	let guardIndex = currentIndex;
	try {
		const result = await pendingResult;
		if (result !== true) return onBlock(result);

		for (let i = currentIndex + 1; i < guards.length; i++) {
			if (context.signal.aborted) return false;
			guardIndex = i;
			const nextResult = await guards[i](context);
			if (nextResult !== true) return onBlock(nextResult);
		}
		return true;
	} catch (error) {
		if (!context.signal.aborted) {
			const route = isLeaveGuard ? context.fromRoute : context.toRoute;
			Log.error(
				`${label} [${guardIndex}] on route "${route}" threw, blocking navigation`,
				String(error),
				LOG_COMPONENT,
			);
		}
		return false;
	}
}

private _validateGuardResult(result: unknown): GuardResult {
	if (typeof result === "boolean") return result;
	if (typeof result === "string" && result.length > 0) return result;
	if (isGuardRedirect(result)) return result;
	Log.warning("Guard returned invalid value, treating as block", String(result), LOG_COMPONENT);
	return false;
}

private _validateLeaveGuardResult(result: unknown): boolean {
	if (typeof result === "boolean") return result;
	Log.warning("Leave guard returned non-boolean value, treating as block", String(result), LOG_COMPONENT);
	return false;
}
```

- [x] **Step 5: Verify typecheck passes**

Run: `npm run typecheck` from repo root
Expected: PASS (GuardPipeline compiles, Router unchanged yet)

- [x] **Step 6: Commit**

```bash
git add packages/lib/src/GuardPipeline.ts
git commit -m "refactor(router): add evaluate pipeline methods to GuardPipeline"
```

---

### Task 3: Wire Router to use GuardPipeline

**Files:**

- Modify: `packages/lib/src/Router.ts`

This is the critical task — Router delegates to the pipeline. Must be done atomically (all changes in one commit) so the code is never in a broken intermediate state.

- [x] **Step 1: Update imports**

Replace the current imports and remove module-level utilities that moved.

Remove these module-level functions from `Router.ts`:

- `isGuardRedirect` (lines 22-29)
- `isPromiseLike` (lines 37-43)
- `addToGuardMap` (lines 49-56)
- `removeFromGuardMap` (lines 58-64)
- `GuardDecision` type (line 70)

Add import:

```typescript
import GuardPipeline, { type GuardDecision } from "./GuardPipeline";
```

Keep `isRouteGuardConfig` — it stays on Router.

- [x] **Step 2: Replace guard storage fields with pipeline instance**

Remove:

```typescript
private _globalGuards: GuardFn[] = [];
private _enterGuards = new Map<string, GuardFn[]>();
private _leaveGuards = new Map<string, LeaveGuardFn[]>();
```

Add:

```typescript
private _pipeline = new GuardPipeline();
```

- [x] **Step 3: Update `addGuard` to delegate**

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

- [x] **Step 4: Update `removeGuard` to delegate**

```typescript
removeGuard(guard: GuardFn): this {
	if (typeof guard !== "function") {
		Log.warning("removeGuard called with invalid guard, ignoring", undefined, LOG_COMPONENT);
		return this;
	}
	this._pipeline.removeGlobalGuard(guard);
	return this;
}
```

- [x] **Step 5: Update `addRouteGuard` to delegate**

Replace `addToGuardMap(this._enterGuards, ...)` with `this._pipeline.addEnterGuard(...)` and `addToGuardMap(this._leaveGuards, ...)` with `this._pipeline.addLeaveGuard(...)`.

```typescript
addRouteGuard(routeName: string, guard: GuardFn | RouteGuardConfig): this {
	if (isRouteGuardConfig(guard)) {
		let hasHandler = false;
		this._warnIfRouteUnknown(routeName, "addRouteGuard");

		if (guard.beforeEnter !== undefined) {
			hasHandler = true;
			if (typeof guard.beforeEnter !== "function") {
				Log.warning("addRouteGuard called with invalid guard, ignoring", routeName, LOG_COMPONENT);
			} else {
				this._pipeline.addEnterGuard(routeName, guard.beforeEnter);
			}
		}
		if (guard.beforeLeave !== undefined) {
			hasHandler = true;
			if (typeof guard.beforeLeave !== "function") {
				Log.warning("addRouteGuard called with invalid guard, ignoring", routeName, LOG_COMPONENT);
			} else {
				this._pipeline.addLeaveGuard(routeName, guard.beforeLeave);
			}
		}

		if (!hasHandler) {
			Log.info(
				"addRouteGuard called with config missing both beforeEnter and beforeLeave",
				routeName,
				LOG_COMPONENT,
			);
			return this;
		}
		return this;
	}
	if (typeof guard !== "function") {
		Log.warning("addRouteGuard called with invalid guard, ignoring", routeName, LOG_COMPONENT);
		return this;
	}
	this._warnIfRouteUnknown(routeName, "addRouteGuard");
	this._pipeline.addEnterGuard(routeName, guard);
	return this;
}
```

- [x] **Step 6: Update `removeRouteGuard` to delegate**

Replace `removeFromGuardMap(this._enterGuards, ...)` with `this._pipeline.removeEnterGuard(...)`.

```typescript
removeRouteGuard(routeName: string, guard: GuardFn | RouteGuardConfig): this {
	if (isRouteGuardConfig(guard)) {
		if (typeof guard.beforeEnter === "function") {
			this.removeRouteGuard(routeName, guard.beforeEnter);
		}
		if (typeof guard.beforeLeave === "function") {
			this.removeLeaveGuard(routeName, guard.beforeLeave);
		}
		return this;
	}
	if (typeof guard !== "function") {
		Log.warning("removeRouteGuard called with invalid guard, ignoring", routeName, LOG_COMPONENT);
		return this;
	}
	this._pipeline.removeEnterGuard(routeName, guard);
	return this;
}
```

- [x] **Step 7: Update `addLeaveGuard` to delegate**

```typescript
addLeaveGuard(routeName: string, guard: LeaveGuardFn): this {
	if (typeof guard !== "function") {
		Log.warning("addLeaveGuard called with invalid guard, ignoring", routeName, LOG_COMPONENT);
		return this;
	}
	this._warnIfRouteUnknown(routeName, "addLeaveGuard");
	this._pipeline.addLeaveGuard(routeName, guard);
	return this;
}
```

- [x] **Step 8: Update `removeLeaveGuard` to delegate**

```typescript
removeLeaveGuard(routeName: string, guard: LeaveGuardFn): this {
	if (typeof guard !== "function") {
		Log.warning("removeLeaveGuard called with invalid guard, ignoring", routeName, LOG_COMPONENT);
		return this;
	}
	this._pipeline.removeLeaveGuard(routeName, guard);
	return this;
}
```

- [x] **Step 9: Update `navTo` evaluation call site**

Replace (around line 475-483):

```typescript
// Old:
const context: GuardContextBase = { ... };
const decision = this._evaluateGuards(context, controller.signal);

// New:
const context: GuardContext = {
	toRoute,
	toHash: targetHash,
	toArguments: routeInfo?.arguments ?? {},
	fromRoute: this._currentRoute,
	fromHash: this._currentHash ?? "",
	signal: controller.signal,
};
const decision = this._pipeline.evaluate(context);
```

Note: `GuardContextBase` type can be removed since we now build `GuardContext` directly.

- [x] **Step 10: Update `parse` evaluation call site**

Same pattern as navTo:

```typescript
// Old:
const context: GuardContextBase = { ... };
const decision = this._evaluateGuards(context, controller.signal);

// New:
const context: GuardContext = {
	toRoute,
	toHash: newHash,
	toArguments: routeInfo?.arguments ?? {},
	fromRoute: this._currentRoute,
	fromHash: this._currentHash ?? "",
	signal: controller.signal,
};
const decision = this._pipeline.evaluate(context);
```

- [x] **Step 11: Update `destroy` to use pipeline.clear()**

```typescript
override destroy(): this {
	this._pipeline.clear();
	this._cancelPendingNavigation();
	this._suppressedHash = null;
	this._lastSettlement = null;
	super.destroy();
	return this;
}
```

Note: `stop()` does NOT call `clear()` — guards are intentionally preserved across stop/restart.

- [x] **Step 12: Remove dead code from Router.ts**

Remove the following (now in GuardPipeline):

- `_evaluateGuards` method
- `_runLeaveGuards` method
- `_runEnterGuards` method
- `_runRouteGuards` method
- `_runGuards` method
- `_continueGuardsAsync` method
- `_validateGuardResult` method
- `_validateLeaveGuardResult` method
- `GuardContextBase` type (no longer needed)

Clean up unused imports: remove `GuardResult` from the Router import (no longer referenced). Keep `GuardRedirect` — it is still used by `_redirect`.

- [x] **Step 13: Verify typecheck passes**

Run: `npm run typecheck` from repo root
Expected: PASS

- [x] **Step 14: Verify lint passes**

Run: `npm run lint` from repo root
Expected: PASS

- [x] **Step 15: Commit**

```bash
git add packages/lib/src/Router.ts packages/lib/src/GuardPipeline.ts
git commit -m "refactor(router): delegate guard storage and evaluation to GuardPipeline"
```

---

### Task 4: Replace introspection tests with behavioral tests

**Files:**

- Modify: `packages/lib/test/qunit/Router.qunit.ts`
- Modify: `packages/lib/test/qunit/testHelpers.ts`

Three test functions used `Reflect.get(router, "_enterGuards")` and `Reflect.get(router, "_leaveGuards")` to verify guards registered for unknown routes. Replace with behavioral tests that use `addRouteDynamic` to add the route, then verify the guard actually runs by navigating.

- [x] **Step 1: Add `addRouteDynamic` helper to `testHelpers.ts`**

Wraps `sap.ui.core.routing.Router#addRoute` via `getRouterMethod` to avoid the incorrect UI5 type signature.

- [x] **Step 2: Replace the 3 introspection tests with behavioral equivalents**

1. `addRouteGuard warns for unknown route but guard runs after route is added`
2. `addRouteGuard object form warns once for unknown route and both guards run after route is added`
3. `addLeaveGuard warns for unknown route but guard runs after route is added`

Each test: register guard for unknown route, assert warning, add the route via `addRouteDynamic`, initialize, navigate, assert the guard was called.

- [x] **Step 2: Verify typecheck passes**

Run: `npm run typecheck` from repo root
Expected: PASS

- [x] **Step 3: Commit**

```bash
git add packages/lib/test/qunit/Router.qunit.ts
git commit -m "test(router): update introspection tests to reach through GuardPipeline"
```

---

### Task 5: Run existing tests

**Files:** None (verification only)

- [x] **Step 1: Run all QUnit tests**

Run from repo root: `npm run test:qunit`
Expected: All 234 Router tests pass. No behavioral changes.

- [x] **Step 2: Run typecheck**

Run: `npm run typecheck` from repo root
Expected: PASS

- [x] **Step 3: Run lint + format check**

Run: `npm run check` from repo root
Expected: PASS

---

### Task 6: Add GuardPipeline unit tests

**Files:**

- Create: `packages/lib/test/qunit/GuardPipeline.qunit.ts`
- Modify: `packages/lib/test/qunit/testsuite.qunit.ts`

Pipeline tests run without Router, HashChanger, or UI5 routing runtime. They only need `GuardPipeline` and `GuardContext`.

- [x] **Step 1: Create test file with imports and helper**

```typescript
import Log from "sap/base/Log";
import GuardPipeline from "ui5/guard/router/GuardPipeline";
import type { GuardContext, GuardFn, LeaveGuardFn } from "ui5/guard/router/types";

/**
 * Sinon-qunit-bridge injects `stub`, `spy`, `mock` onto the QUnit test
 * context (`this`) via a per-test sandbox that is auto-restored in afterEach.
 * Using `this.stub` (sandbox) rather than `sinon.stub` (global) ensures
 * stubs are cleaned up between tests without manual restore.
 */
interface SinonTestContext {
	stub: sinon.SinonStubStatic;
}

function createContext(overrides: Partial<GuardContext> = {}): GuardContext {
	return {
		toRoute: "target",
		toHash: "target",
		toArguments: {},
		fromRoute: "",
		fromHash: "",
		signal: new AbortController().signal,
		...overrides,
	};
}
```

- [x] **Step 2: Add empty pipeline and guard management tests**

```typescript
QUnit.module("GuardPipeline - evaluate");

QUnit.test("empty pipeline allows navigation", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const result = pipeline.evaluate(createContext({ fromRoute: "current" }));
	assert.deepEqual(result, { action: "allow" }, "No guards means allow");
});

QUnit.test("empty pipeline allows when currentRoute is empty string", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const result = pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "allow" }, "Initial navigation with no guards allows");
});

QUnit.module("GuardPipeline - guard management");

QUnit.test("clear removes all guards", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => false);
	pipeline.addEnterGuard("target", () => false);
	pipeline.addLeaveGuard("current", () => false);

	pipeline.clear();

	const result = pipeline.evaluate(createContext({ fromRoute: "current" }));
	assert.deepEqual(result, { action: "allow" }, "All guards cleared");
});

QUnit.test("removeGlobalGuard removes by reference", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const guard: GuardFn = () => false;
	pipeline.addGlobalGuard(guard);
	pipeline.removeGlobalGuard(guard);

	const result = pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "allow" }, "Guard removed, navigation allowed");
});

QUnit.test("removeEnterGuard removes by reference", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const guard: GuardFn = () => false;
	pipeline.addEnterGuard("target", guard);
	pipeline.removeEnterGuard("target", guard);

	const result = pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "allow" }, "Enter guard removed");
});

QUnit.test("removeLeaveGuard removes by reference", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const guard: LeaveGuardFn = () => false;
	pipeline.addLeaveGuard("current", guard);
	pipeline.removeLeaveGuard("current", guard);

	const result = pipeline.evaluate(createContext({ fromRoute: "current" }));
	assert.deepEqual(result, { action: "allow" }, "Leave guard removed");
});
```

- [x] **Step 3: Add global guard decision tests**

```typescript
QUnit.module("GuardPipeline - global guards");

QUnit.test("global guard returning true allows", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => true);
	const result = pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "allow" });
});

QUnit.test("global guard returning false blocks", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => false);
	const result = pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "block" });
});

QUnit.test("global guard returning string redirects", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => "login");
	const result = pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "redirect", target: "login" });
});

QUnit.test("global guard returning GuardRedirect object redirects", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const redirect = { route: "login", parameters: { reason: "auth" } };
	pipeline.addGlobalGuard(() => redirect);
	const result = pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "redirect", target: redirect });
});

QUnit.test("first non-true global guard short-circuits", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const calls: number[] = [];
	pipeline.addGlobalGuard(() => {
		calls.push(1);
		return true;
	});
	pipeline.addGlobalGuard(() => {
		calls.push(2);
		return false;
	});
	pipeline.addGlobalGuard(() => {
		calls.push(3);
		return true;
	});

	pipeline.evaluate(createContext());
	assert.deepEqual(calls, [1, 2], "Third guard never called");
});
```

- [x] **Step 4: Add route-specific enter guard tests**

```typescript
QUnit.module("GuardPipeline - route enter guards");

QUnit.test("route enter guard blocks", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addEnterGuard("target", () => false);
	const result = pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "block" });
});

QUnit.test("route enter guard redirects", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addEnterGuard("target", () => "other");
	const result = pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "redirect", target: "other" });
});

QUnit.test("global guards run before route guards", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const order: string[] = [];
	pipeline.addGlobalGuard(() => {
		order.push("global");
		return true;
	});
	pipeline.addEnterGuard("target", () => {
		order.push("route");
		return true;
	});

	pipeline.evaluate(createContext());
	assert.deepEqual(order, ["global", "route"]);
});

QUnit.test("route guard skipped when global guard blocks", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const called: string[] = [];
	pipeline.addGlobalGuard(() => {
		called.push("global");
		return false;
	});
	pipeline.addEnterGuard("target", () => {
		called.push("route");
		return true;
	});

	pipeline.evaluate(createContext());
	assert.deepEqual(called, ["global"], "Route guard never called");
});
```

- [x] **Step 5: Add leave guard tests**

```typescript
QUnit.module("GuardPipeline - leave guards");

QUnit.test("leave guard blocks navigation", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addLeaveGuard("current", () => false);
	const result = pipeline.evaluate(createContext({ fromRoute: "current" }));
	assert.deepEqual(result, { action: "block" });
});

QUnit.test("leave guard allows, then enter guards run", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const order: string[] = [];
	pipeline.addLeaveGuard("current", () => {
		order.push("leave");
		return true;
	});
	pipeline.addGlobalGuard(() => {
		order.push("global");
		return true;
	});
	pipeline.addEnterGuard("target", () => {
		order.push("route");
		return true;
	});

	pipeline.evaluate(createContext({ fromRoute: "current" }));
	assert.deepEqual(order, ["leave", "global", "route"]);
});

QUnit.test("leave guards skipped when currentRoute is empty string", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addLeaveGuard("", () => false);
	const result = pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "allow" }, "No leave guards checked for empty currentRoute");
});

QUnit.test("leave guard blocking skips enter guards", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const called: string[] = [];
	pipeline.addLeaveGuard("current", () => {
		called.push("leave");
		return false;
	});
	pipeline.addGlobalGuard(() => {
		called.push("global");
		return true;
	});

	pipeline.evaluate(createContext({ fromRoute: "current" }));
	assert.deepEqual(called, ["leave"], "Enter guards never called");
});
```

- [x] **Step 6: Add validation tests**

Uses `this.stub` from sinon-qunit-bridge for log interception. The bridge auto-restores stubs between tests.

```typescript
QUnit.module("GuardPipeline - validation");

QUnit.test("invalid guard return value treated as block", function (this: SinonTestContext, assert: Assert) {
	const warnStub = this.stub(Log, "warning");
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard((() => 42) as unknown as GuardFn);

	const result = pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "block" });
	assert.ok(warnStub.calledOnce, "Warning logged");
});

QUnit.test("leave guard returning non-boolean treated as block", function (this: SinonTestContext, assert: Assert) {
	const warnStub = this.stub(Log, "warning");
	const pipeline = new GuardPipeline();
	pipeline.addLeaveGuard("current", (() => "nope") as unknown as LeaveGuardFn);

	const result = pipeline.evaluate(createContext({ fromRoute: "current" }));
	assert.deepEqual(result, { action: "block" });
	assert.ok(warnStub.calledOnce, "Warning logged for non-boolean leave guard");
});

QUnit.test("empty string guard return treated as block", function (this: SinonTestContext, assert: Assert) {
	this.stub(Log, "warning");
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard((() => "") as unknown as GuardFn);

	const result = pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "block" });
});
```

- [x] **Step 7: Add error handling tests**

```typescript
QUnit.module("GuardPipeline - error handling");

QUnit.test("sync guard that throws blocks navigation", function (this: SinonTestContext, assert: Assert) {
	const errorStub = this.stub(Log, "error");
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => {
		throw new Error("boom");
	});

	const result = pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "block" });
	assert.ok(errorStub.calledOnce, "Error was logged");
});

QUnit.test("sync leave guard that throws blocks navigation", function (this: SinonTestContext, assert: Assert) {
	const errorStub = this.stub(Log, "error");
	const pipeline = new GuardPipeline();
	pipeline.addLeaveGuard("current", () => {
		throw new Error("leave boom");
	});

	const result = pipeline.evaluate(createContext({ fromRoute: "current" }));
	assert.deepEqual(result, { action: "block" });
	assert.ok(errorStub.calledOnce, "Error was logged");
});

QUnit.test("async guard that rejects blocks navigation", async function (this: SinonTestContext, assert: Assert) {
	const errorStub = this.stub(Log, "error");
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => Promise.reject(new Error("async boom")));

	const result = await pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "block" });
	assert.ok(errorStub.calledOnce, "Error was logged");
});

QUnit.test("guard error after signal aborted does not log", async function (this: SinonTestContext, assert: Assert) {
	const errorStub = this.stub(Log, "error");
	const pipeline = new GuardPipeline();
	const controller = new AbortController();
	pipeline.addGlobalGuard(() => {
		controller.abort();
		return Promise.reject(new Error("aborted boom"));
	});

	const result = await pipeline.evaluate(createContext({ signal: controller.signal }));
	assert.deepEqual(result, { action: "block" });
	assert.ok(errorStub.notCalled, "Error suppressed when signal aborted");
});
```

- [x] **Step 8: Add async pipeline tests**

```typescript
QUnit.module("GuardPipeline - async");

QUnit.test("async global guard that allows", async function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => Promise.resolve(true));
	const result = await pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "allow" });
});

QUnit.test("async global guard that blocks", async function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => Promise.resolve(false));
	const result = await pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "block" });
});

QUnit.test("async global guard that redirects", async function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => Promise.resolve("login"));
	const result = await pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "redirect", target: "login" });
});

QUnit.test("mixed sync-async pipeline", async function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const order: number[] = [];
	pipeline.addGlobalGuard(() => {
		order.push(1);
		return true;
	});
	pipeline.addGlobalGuard(() => {
		order.push(2);
		return Promise.resolve(true);
	});
	pipeline.addGlobalGuard(() => {
		order.push(3);
		return true;
	});

	const result = await pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "allow" });
	assert.deepEqual(order, [1, 2, 3], "All guards ran in order");
});

QUnit.test("async leave guard blocks before enter guards", async function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const called: string[] = [];
	pipeline.addLeaveGuard("current", () => {
		called.push("leave");
		return Promise.resolve(false);
	});
	pipeline.addGlobalGuard(() => {
		called.push("global");
		return true;
	});

	const result = await pipeline.evaluate(createContext({ fromRoute: "current" }));
	assert.deepEqual(result, { action: "block" });
	assert.deepEqual(called, ["leave"], "Enter guards never called");
});

QUnit.test("abort signal checked between async guards", async function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const controller = new AbortController();
	const called: number[] = [];
	pipeline.addGlobalGuard(() => {
		called.push(1);
		controller.abort();
		return Promise.resolve(true);
	});
	pipeline.addGlobalGuard(() => {
		called.push(2);
		return true;
	});

	const result = await pipeline.evaluate(createContext({ signal: controller.signal }));
	assert.deepEqual(result, { action: "block" }, "Blocked due to abort");
	assert.deepEqual(called, [1], "Second guard never called");
});
```

- [x] **Step 9: Add self-removal test**

```typescript
QUnit.module("GuardPipeline - snapshot copy");

QUnit.test("guard can remove itself during iteration", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const oneShotGuard: GuardFn = () => {
		pipeline.removeGlobalGuard(oneShotGuard);
		return true;
	};
	pipeline.addGlobalGuard(oneShotGuard);
	pipeline.addGlobalGuard(() => true);

	const result1 = pipeline.evaluate(createContext());
	assert.deepEqual(result1, { action: "allow" }, "First call: both guards run, allow");

	const result2 = pipeline.evaluate(createContext());
	assert.deepEqual(result2, { action: "allow" }, "Second call: one-shot removed, still allow");
});
```

- [x] **Step 10: Register in test suite**

Add to `testsuite.qunit.ts`:

```typescript
GuardPipeline: {
	title: "QUnit Tests for ui5.guard.router.GuardPipeline",
},
```

- [x] **Step 11: Verify typecheck passes**

Run: `npm run typecheck` from repo root
Expected: PASS

- [x] **Step 12: Commit**

```bash
git add packages/lib/test/qunit/GuardPipeline.qunit.ts packages/lib/test/qunit/testsuite.qunit.ts
git commit -m "test(router): add standalone GuardPipeline unit tests"
```

---

### Task 7: Run full test suite

**Files:** None (verification only)

- [x] **Step 1: Run full check (format + lint + typecheck)**

Run: `npm run check` from repo root
Expected: PASS

- [x] **Step 2: Run QUnit tests**

Run: `npm run test:qunit` from repo root
Expected: All tests pass (existing 234 Router + new pipeline tests)

- [x] **Step 3: Run E2E tests**

Run: `npm run test:e2e` from repo root
Expected: All E2E tests pass unchanged
