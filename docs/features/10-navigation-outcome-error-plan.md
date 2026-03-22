# NavigationOutcome.Error Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distinguish guard errors (throws/rejections) from intentional blocks (`false`) by surfacing `NavigationOutcome.Error` with the raw error on `NavigationResult`.

**Architecture:** Add `Error` to the `NavigationOutcome` enum, add `{ action: "error"; error: unknown }` to the `GuardDecision` discriminated union, update the three pipeline catch blocks and `evaluate()` passthrough, then add `_errorNavigation()` to the Router parallel to `_blockNavigation()`. All changes are additive.

**Tech Stack:** TypeScript, UI5, QUnit + Sinon

**Spec:** `docs/features/10-navigation-outcome-error.md`

---

### Task 1: Add `Error` to `NavigationOutcome` enum

**Files:**

- Modify: `packages/lib/src/NavigationOutcome.ts:11-22`

- [ ] **Step 1: Write the failing test**

In `packages/lib/test/qunit/GuardPipeline.qunit.ts`, add a test at the end of the "error handling" module that asserts a throwing enter guard produces `{ action: "error" }`:

```typescript
QUnit.test("throwing enter guard produces error decision", function (this: SinonTestContext, assert: Assert) {
	this.stub(Log, "error");
	const pipeline = new GuardPipeline();
	const thrownError = new Error("boom");
	pipeline.addGlobalGuard(() => {
		throw thrownError;
	});
	const result = pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "error", error: thrownError });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test` (from repo root)
Expected: FAIL — result is `{ action: "block" }`, not `{ action: "error", error: ... }`

- [ ] **Step 3: Add `Error` to `NavigationOutcome` and `error` variant to `GuardDecision`**

In `packages/lib/src/NavigationOutcome.ts`, add after the `Cancelled` line:

```typescript
/** A guard threw or rejected; the previous route remains active. */
Error: "error",
```

In `packages/lib/src/GuardPipeline.ts`, update the `GuardDecision` type (line 32-35):

```typescript
export type GuardDecision =
	| { action: "allow" }
	| { action: "block" }
	| { action: "redirect"; target: string | GuardRedirect }
	| { action: "error"; error: unknown };
```

In `packages/lib/src/types.ts`, add to `NavigationResult` (after `hash: string;`):

```typescript
/**
 * The error that caused the navigation to fail.
 * Present only when `status` is `NavigationOutcome.Error`.
 */
error?: unknown;
```

- [ ] **Step 4: Commit**

```bash
git add packages/lib/src/NavigationOutcome.ts packages/lib/src/GuardPipeline.ts packages/lib/src/types.ts packages/lib/test/qunit/GuardPipeline.qunit.ts
git commit -m "feat(router): add NavigationOutcome.Error enum value and GuardDecision error variant"
```

---

### Task 2: Update `GuardPipeline` catch blocks and `evaluate()` passthrough

**Files:**

- Modify: `packages/lib/src/GuardPipeline.ts:96-139` (evaluate), `185-191` (\_runLeaveGuards catch), `242-248` (\_runGuards catch), `287-296` (\_continueGuardsAsync catch)

- [ ] **Step 1: Write failing tests for all three catch paths**

Add these tests in the "error handling" module of `packages/lib/test/qunit/GuardPipeline.qunit.ts` (the first test from Task 1 already covers sync enter guard; add async enter and sync leave):

```typescript
QUnit.test(
	"async enter guard that rejects produces error decision",
	async function (this: SinonTestContext, assert: Assert) {
		this.stub(Log, "error");
		const pipeline = new GuardPipeline();
		const rejectedError = new Error("async boom");
		pipeline.addGlobalGuard(() => Promise.reject(rejectedError));

		const result = await pipeline.evaluate(createContext());
		assert.deepEqual(result, { action: "error", error: rejectedError });
	},
);

QUnit.test("throwing leave guard produces error decision", function (this: SinonTestContext, assert: Assert) {
	this.stub(Log, "error");
	const pipeline = new GuardPipeline();
	const thrownError = new Error("leave boom");
	pipeline.addLeaveGuard("current", () => {
		throw thrownError;
	});

	const result = pipeline.evaluate(createContext({ fromRoute: "current" }));
	assert.deepEqual(result, { action: "error", error: thrownError });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — results are `{ action: "block" }` for all error cases

- [ ] **Step 3: Update `_runGuards()` catch block**

In `packages/lib/src/GuardPipeline.ts`, replace the catch block in `_runGuards` (lines 242-248):

```typescript
		} catch (error) {
			Log.error(
				`Enter guard [${i}] on route "${context.toRoute}" threw, blocking navigation`,
				String(error),
				LOG_COMPONENT,
			);
			return { action: "error" as const, error };
		}
```

- [ ] **Step 4: Update `_runLeaveGuards()` catch block**

In `packages/lib/src/GuardPipeline.ts`, replace the catch block in `_runLeaveGuards` (lines 185-192):

```typescript
		} catch (error) {
			Log.error(
				`Leave guard [${i}] on route "${context.fromRoute}" threw, blocking navigation`,
				String(error),
				LOG_COMPONENT,
			);
			return { action: "error" as const, error };
		}
```

Update the return type of `_runLeaveGuards` from `boolean | Promise<boolean>` to `boolean | GuardDecision | Promise<boolean | GuardDecision>`:

```typescript
private _runLeaveGuards(context: GuardContext): boolean | GuardDecision | Promise<boolean | GuardDecision> {
```

Also update the `as Promise<boolean>` cast on line 182 (inside the `isPromiseLike` branch) to match:

```typescript
				) as Promise<boolean | GuardDecision>;
```

- [ ] **Step 5: Update `_continueGuardsAsync()` catch block**

In `packages/lib/src/GuardPipeline.ts`, replace the catch block in `_continueGuardsAsync` (lines 287-296). The `!context.signal.aborted` check stays for logging, but the non-aborted path now returns the error decision:

```typescript
	} catch (error) {
		if (!context.signal.aborted) {
			const route = isLeaveGuard ? context.fromRoute : context.toRoute;
			Log.error(
				`${label} [${guardIndex}] on route "${route}" threw, blocking navigation`,
				String(error),
				LOG_COMPONENT,
			);
			return { action: "error" as const, error };
		}
		return false;
	}
```

Update the return type of `_continueGuardsAsync` from `Promise<GuardResult>` to `Promise<GuardResult | GuardDecision>`:

```typescript
private async _continueGuardsAsync(
	...
): Promise<GuardResult | GuardDecision> {
```

- [ ] **Step 6: Update `evaluate()` passthrough logic**

In `packages/lib/src/GuardPipeline.ts`, add a helper function before the class (after `isPromiseLike`):

```typescript
function isGuardDecision(value: unknown): value is GuardDecision {
	return typeof value === "object" && value !== null && "action" in value;
}
```

Update `processEnterResult` to passthrough `GuardDecision` values:

```typescript
const processEnterResult = (
	enterResult: GuardResult | GuardDecision | Promise<GuardResult | GuardDecision>,
): GuardDecision | Promise<GuardDecision> => {
	if (isPromiseLike(enterResult)) {
		return enterResult.then((r: GuardResult | GuardDecision): GuardDecision => {
			if (isGuardDecision(r)) return r;
			if (r === true) return { action: "allow" };
			if (r === false) return { action: "block" };
			return { action: "redirect", target: r };
		});
	}
	if (isGuardDecision(enterResult)) return enterResult;
	if (enterResult === true) return { action: "allow" };
	if (enterResult === false) return { action: "block" };
	return { action: "redirect", target: enterResult };
};
```

Update the leave-guard sync path in `evaluate()`:

```typescript
if (leaveResult !== true) {
	if (isGuardDecision(leaveResult)) return leaveResult;
	return { action: "block" };
}
```

Update the leave-guard async path `.then` callback:

```typescript
return leaveResult.then((allowed: boolean | GuardDecision): GuardDecision | Promise<GuardDecision> => {
	if (isGuardDecision(allowed)) return allowed;
	if (allowed !== true) return { action: "block" };
	if (context.signal.aborted) return { action: "block" };
	return runEnterPhase();
});
```

Also update `_runEnterGuards` return type:

```typescript
private _runEnterGuards(toRoute: string, context: GuardContext): GuardResult | GuardDecision | Promise<GuardResult | GuardDecision> {
```

And the `.then` in `_runEnterGuards`:

```typescript
return globalResult.then((result: GuardResult | GuardDecision) => {
	if (isGuardDecision(result)) return result;
	if (result !== true) return result;
	if (context.signal.aborted) return false;
	return this._runRouteGuards(toRoute, context);
});
```

And `_runRouteGuards` return type:

```typescript
private _runRouteGuards(toRoute: string, context: GuardContext): GuardResult | GuardDecision | Promise<GuardResult | GuardDecision> {
```

And `_runGuards` return type:

```typescript
private _runGuards(guards: GuardFn[], context: GuardContext): GuardResult | GuardDecision | Promise<GuardResult | GuardDecision> {
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test`
Expected: All new tests PASS. The existing "throwing guards block and log errors" and "async guard that rejects blocks navigation" tests will now FAIL because they assert `{ action: "block" }` instead of `{ action: "error", ... }`.

- [ ] **Step 8: Update existing tests that now assert wrong outcome**

In `packages/lib/test/qunit/GuardPipeline.qunit.ts`, update the "throwing guards block and log errors" test (lines 325-345). The enter guard throw now produces `{ action: "error" }` and the leave guard throw produces `{ action: "error" }`:

```typescript
QUnit.test("throwing guards produce error decisions and log errors", function (this: SinonTestContext, assert: Assert) {
	const errorStub = this.stub(Log, "error");

	const enterError = new Error("boom");
	const p1 = new GuardPipeline();
	p1.addGlobalGuard(() => {
		throw enterError;
	});
	assert.deepEqual(
		p1.evaluate(createContext()),
		{ action: "error", error: enterError },
		"Enter guard throw → error decision",
	);

	const leaveError = new Error("leave boom");
	const p2 = new GuardPipeline();
	p2.addLeaveGuard("current", () => {
		throw leaveError;
	});
	assert.deepEqual(
		p2.evaluate(createContext({ fromRoute: "current" })),
		{ action: "error", error: leaveError },
		"Leave guard throw → error decision",
	);

	assert.strictEqual(errorStub.callCount, 2, "Error logged for each throw");
});
```

Update the "async guard that rejects blocks navigation" test (lines 347-355):

```typescript
QUnit.test("async guard that rejects produces error decision", async function (this: SinonTestContext, assert: Assert) {
	const errorStub = this.stub(Log, "error");
	const pipeline = new GuardPipeline();
	const rejectedError = new Error("async boom");
	pipeline.addGlobalGuard(() => Promise.reject(rejectedError));

	const result = await pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "error", error: rejectedError });
	assert.ok(errorStub.calledOnce, "Error was logged");
});
```

Update the "aborted signal suppresses error logging" test (lines 357-377) — aborted case should still produce `{ action: "block" }`:

```typescript
QUnit.test(
	"aborted signal suppresses error logging and produces block",
	async function (this: SinonTestContext, assert: Assert) {
		const errorStub = this.stub(Log, "error");

		const c1 = new AbortController();
		const p1 = new GuardPipeline();
		p1.addGlobalGuard(() => {
			c1.abort();
			return Promise.reject(new Error("aborted"));
		});
		const r1 = await p1.evaluate(createContext({ signal: c1.signal }));
		assert.deepEqual(r1, { action: "block" }, "Aborted enter guard → block (not error)");
		assert.ok(errorStub.notCalled, "Enter guard error suppressed when signal aborted");

		const c2 = new AbortController();
		const p2 = new GuardPipeline();
		p2.addLeaveGuard("current", () => {
			c2.abort();
			return Promise.reject(new Error("leave aborted"));
		});
		const r2 = await p2.evaluate(createContext({ signal: c2.signal, fromRoute: "current" }));
		assert.deepEqual(r2, { action: "block" }, "Aborted leave guard → block (not error)");
		assert.ok(errorStub.notCalled, "Leave guard error suppressed when signal aborted");
	},
);
```

- [ ] **Step 9: Add regression test — guard returning false still produces block**

Add to the "error handling" module in `packages/lib/test/qunit/GuardPipeline.qunit.ts`:

```typescript
QUnit.test("guard returning false produces block, not error", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => false);
	assert.deepEqual(pipeline.evaluate(createContext()), { action: "block" }, "false → block, not error");
});
```

- [ ] **Step 10: Run all tests to verify**

Run: `npm run test`
Expected: All PASS

- [ ] **Step 11: Commit**

```bash
git add packages/lib/src/GuardPipeline.ts packages/lib/test/qunit/GuardPipeline.qunit.ts
git commit -m "feat(pipeline): return error decision on guard throw/reject instead of block"
```

---

### Task 3: Add `_errorNavigation()` to Router and wire up decision handling

**Files:**

- Modify: `packages/lib/src/Router.ts:496-524` (\_applyPreflightDecision), `657-670` (\_applyDecision), `462-474` (navTo .catch), `597-608` (parse .catch), after `_blockNavigation` (new method)

- [ ] **Step 1: Write failing Router tests**

In `packages/lib/test/qunit/Router.qunit.ts`, update existing tests and add new ones. First, update the existing tests that assert `Blocked` on guard throws to assert `Error` instead.

Update "Guard throwing an error blocks navigation" (around line 671):

```typescript
QUnit.test("Guard throwing an error produces Error settlement", async function (assert: Assert) {
	const thrownError = new Error("Guard error");
	router.addGuard(() => {
		throw thrownError;
	});
	router.initialize();
	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Error, "Status is Error");
	assert.strictEqual(result.error, thrownError, "Error is the thrown value");
});
```

Update "Guard returning rejected Promise blocks navigation" (around line 679):

```typescript
QUnit.test("Guard returning rejected Promise produces Error settlement", async function (assert: Assert) {
	const rejectedError = new Error("Rejected");
	router.addGuard(() => Promise.reject(rejectedError));
	router.initialize();
	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Error, "Status is Error");
	assert.strictEqual(result.error, rejectedError, "Error is the rejected value");
});
```

Update "Async route-specific guard throwing error blocks navigation" (around line 1276):

```typescript
QUnit.test("Async route-specific guard throwing error produces Error settlement", async function (assert: Assert) {
	const thrownError = new Error("Async route guard error");
	router.addRouteGuard("protected", async () => {
		await nextTick(10);
		throw thrownError;
	});
	router.initialize();
	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Error, "Status is Error");
	assert.strictEqual(result.error, thrownError, "Error is the thrown value");
});
```

Update "Async route-specific guard returning rejected promise blocks navigation" (around line 1285):

```typescript
QUnit.test(
	"Async route-specific guard returning rejected promise produces Error settlement",
	async function (assert: Assert) {
		const rejectedError = new Error("Route guard rejected");
		router.addRouteGuard("protected", () => Promise.reject(rejectedError));
		router.initialize();
		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Error, "Status is Error");
		assert.strictEqual(result.error, rejectedError, "Error is the rejected value");
	},
);
```

Update "Leave guard throwing error blocks navigation" (around line 2149):

```typescript
QUnit.test("Leave guard throwing error produces Error settlement", async function (assert: Assert) {
	const thrownError = new Error("Leave guard error");
	router.addLeaveGuard("home", () => {
		throw thrownError;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Error, "Status is Error");
	assert.strictEqual(result.error, thrownError, "Error is the thrown value");
});
```

Add new tests in a new module at the end of Router.qunit.ts:

```typescript
// ============================================================
// Module: NavigationOutcome.Error
// ============================================================
QUnit.module("Router - NavigationOutcome.Error", standardHooks);

QUnit.test("result.error is undefined for non-error settlements", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	const committed = await router.navigationSettled();
	assert.strictEqual(committed.status, NavigationOutcome.Committed, "Committed status");
	assert.strictEqual(committed.error, undefined, "No error on committed");

	router.addRouteGuard("protected", () => false);
	router.navTo("protected");
	const blocked = await router.navigationSettled();
	assert.strictEqual(blocked.status, NavigationOutcome.Blocked, "Blocked status");
	assert.strictEqual(blocked.error, undefined, "No error on blocked");
});

QUnit.test("navigationSettled event carries error field", async function (assert: Assert) {
	const thrownError = new Error("event test");
	router.addGuard(() => {
		throw thrownError;
	});
	router.initialize();

	let eventError: unknown;
	let eventStatus: string | undefined;
	router.attachNavigationSettled((event) => {
		eventStatus = event.getParameter("status") as string;
		eventError = event.getParameter("error");
	});

	router.navTo("protected");
	await router.navigationSettled();

	assert.strictEqual(eventStatus, NavigationOutcome.Error, "Event status is Error");
	assert.strictEqual(eventError, thrownError, "Event carries the error");
});

QUnit.test("idle replay after error returns Error status with error", async function (assert: Assert) {
	const thrownError = new Error("replay test");
	const throwingGuard: GuardFn = () => {
		throw thrownError;
	};
	router.addGuard(throwingGuard);
	router.initialize();

	router.navTo("protected");
	const errorResult = await router.navigationSettled();
	assert.strictEqual(errorResult.status, NavigationOutcome.Error, "First settlement is Error");

	// Remove guard and query idle settlement
	router.removeGuard(throwingGuard);
	const replay = await router.navigationSettled();
	assert.strictEqual(replay.status, NavigationOutcome.Error, "Replay returns Error");
	assert.strictEqual(replay.error, thrownError, "Replay includes the error");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — Router doesn't handle `action: "error"` yet

- [ ] **Step 3: Add `_errorNavigation()` method to Router**

In `packages/lib/src/Router.ts`, add a new method after `_blockNavigation` (after line 775):

```typescript
/**
 * Clear pending state and flush an Error settlement.
 * Same structure as `_blockNavigation` but with `NavigationOutcome.Error`
 * and the error that caused the failure.
 */
private _errorNavigation(error: unknown, attemptedHash?: string, restoreHash = true): void {
	this._phase = IDLE;
	this._flushSettlement({
		status: NavigationOutcome.Error,
		route: this._currentRoute,
		hash: this._currentHash ?? "",
		error,
	});
	if (!restoreHash) return;
	if (this._currentHash === null && attemptedHash && attemptedHash !== "") {
		this._restoreHash("", false);
		return;
	}
	this._restoreHash(this._currentHash ?? "");
}
```

- [ ] **Step 4: Add `case "error"` to `_applyDecision()`**

In `packages/lib/src/Router.ts`, update `_applyDecision` (around line 657-670):

```typescript
private _applyDecision(decision: GuardDecision, hash: string, route: string): void {
	switch (decision.action) {
		case "allow":
			this._phase = { kind: "committing", hash, route, origin: "parse" };
			this._commitNavigation(hash, route);
			break;
		case "block":
			this._blockNavigation(hash);
			break;
		case "redirect":
			this._redirect(decision.target, hash);
			break;
		case "error":
			this._errorNavigation(decision.error, hash);
			break;
	}
}
```

- [ ] **Step 5: Add `case "error"` to `_applyPreflightDecision()`**

In `packages/lib/src/Router.ts`, update `_applyPreflightDecision` (around line 505-523). Add after the `"redirect"` case:

```typescript
		case "error":
			this._errorNavigation(decision.error, targetHash, false);
			break;
```

- [ ] **Step 6: Update `.catch()` in `navTo()` to use `_errorNavigation()`**

In `packages/lib/src/Router.ts`, update the `.catch()` handler in `navTo()` (around line 463-474):

```typescript
			.catch((error: unknown) => {
				if (generation !== this._parseGeneration) return;
				Log.error(
					`Async preflight guard failed for route "${routeName}", blocking navigation`,
					String(error),
					LOG_COMPONENT,
				);
				this._errorNavigation(error, targetHash, false);
			});
```

- [ ] **Step 7: Update `.catch()` in `parse()` to use `_errorNavigation()`**

In `packages/lib/src/Router.ts`, update the `.catch()` handler in `parse()` (around line 597-608):

```typescript
			.catch((error: unknown) => {
				if (generation !== this._parseGeneration) return;
				Log.error(
					`Guard pipeline failed for "${newHash}", blocking navigation`,
					String(error),
					LOG_COMPONENT,
				);
				this._errorNavigation(error, newHash);
			});
```

- [ ] **Step 8: Run all tests to verify**

Run: `npm run test`
Expected: All PASS

- [ ] **Step 9: Run all tests**

Run: `npm run test`
Expected: All PASS

- [ ] **Step 10: Commit**

```bash
git add packages/lib/src/Router.ts packages/lib/test/qunit/Router.qunit.ts
git commit -m "feat(router): add _errorNavigation() and wire error decision through apply/catch paths"
```

---

### Task 4: Verify existing behavior is preserved and clean up

**Files:**

- Verify: `packages/lib/test/qunit/Router.qunit.ts`, `packages/lib/test/qunit/GuardPipeline.qunit.ts`

- [ ] **Step 1: Verify guard-returning-false still produces Blocked**

Confirm that existing tests for `() => false` guards still assert `NavigationOutcome.Blocked` (not Error). These should already pass — just verify.

- [ ] **Step 2: Verify abort-signal tests still pass**

Confirm the "Guard error after signal abort" tests (around line 3066-3139) still pass. Aborted navigations should still produce `Cancelled` or `Blocked` outcomes, not `Error`.

- [ ] **Step 3: Remove duplicate tests added in Task 2**

If the Task 2 new tests ("throwing enter guard produces error decision", "async enter guard that rejects produces error decision", "throwing leave guard produces error decision") overlap with the updated existing tests ("throwing guards produce error decisions and log errors", "async guard that rejects produces error decision"), remove the duplicates. Keep the consolidated tests.

- [ ] **Step 4: Run the full test suite**

Run: `npm run test`
Expected: All PASS, no regressions

- [ ] **Step 5: Commit any cleanup**

```bash
git add packages/lib/test/qunit/GuardPipeline.qunit.ts packages/lib/test/qunit/Router.qunit.ts
git commit -m "test(router): clean up duplicate NavigationOutcome.Error tests"
```

---

### Task 5: Run full test suite and verify

- [ ] **Step 1: Run full test suite**

Run: `npm run test`
Expected: All tests PASS

- [ ] **Step 2: Run linter**

Run: `npm run lint` (if available)
Expected: No errors

- [ ] **Step 3: Verify no TypeScript errors**

Run: `npx tsc --noEmit` (from `packages/lib`)
Expected: No errors

- [ ] **Step 4: Final commit if any fixes needed**

Only if previous steps revealed issues.
