# Guards on Redirect Targets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evaluate guards on redirect targets instead of bypassing them, with visited-set loop detection and a depth cap.

**Architecture:** Refactor `_redirect()` to call `_pipeline.evaluate()` for each hop in a redirect chain instead of entering `committing/redirect` phase and bypassing guards. Thread a `RedirectChainContext` (visited set, generation, signal, original source) through recursive calls. Add `skipLeaveGuards` option to `GuardPipeline.evaluate()`. The `committing/redirect` bypass in `navTo()` is kept but only used for the final commit step.

**Tech Stack:** TypeScript, UI5 (sap/base/Log), QUnit

**Spec:** `docs/features/11-guards-on-redirect-targets.md`

---

### Task 1: Add `skipLeaveGuards` option to `GuardPipeline.evaluate()`

**Files:**

- Modify: `packages/lib/src/GuardPipeline.ts`
- Test: `packages/lib/test/qunit/GuardPipeline.qunit.ts`

- [ ] **Step 1: Write the failing test**

Add a new module section in GuardPipeline.qunit.ts:

```typescript
QUnit.module("GuardPipeline - skipLeaveGuards option");

QUnit.test("skipLeaveGuards skips leave guards even when fromRoute is set", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const called: string[] = [];
	pipeline.addLeaveGuard("current", () => {
		called.push("leave");
		return false; // would block
	});
	pipeline.addGlobalGuard(() => {
		called.push("global");
		return true;
	});

	const result = pipeline.evaluate(createContext({ fromRoute: "current" }), { skipLeaveGuards: true });
	assert.deepEqual(result, { action: "allow" }, "Navigation allowed despite blocking leave guard");
	assert.deepEqual(called, ["global"], "Leave guard was skipped, global guard ran");
});

QUnit.test("skipLeaveGuards false still runs leave guards", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addLeaveGuard("current", () => false);

	const result = pipeline.evaluate(createContext({ fromRoute: "current" }), { skipLeaveGuards: false });
	assert.deepEqual(result, { action: "block" }, "Leave guard blocks when skipLeaveGuards is false");
});

QUnit.test("skipLeaveGuards omitted still runs leave guards (backward compat)", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addLeaveGuard("current", () => false);

	const result = pipeline.evaluate(createContext({ fromRoute: "current" }));
	assert.deepEqual(result, { action: "block" }, "Leave guard blocks when options omitted");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:qunit`
Expected: 3 failures — `evaluate` does not accept second argument yet (TypeScript), but since tests run transpiled this will be a behavioral fail: leave guards still run.

- [ ] **Step 3: Implement `skipLeaveGuards` in `GuardPipeline.evaluate()`**

In `packages/lib/src/GuardPipeline.ts`, modify the `evaluate` method signature and the leave guard check:

```typescript
evaluate(
	context: GuardContext,
	options?: { skipLeaveGuards?: boolean },
): GuardDecision | Promise<GuardDecision> {
	const hasLeaveGuards =
		!options?.skipLeaveGuards && context.fromRoute !== "" && this._leaveGuards.has(context.fromRoute);
	// ... rest unchanged ...
}
```

Only the first line inside `evaluate` changes — add `!options?.skipLeaveGuards &&` to the `hasLeaveGuards` condition.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:qunit`
Expected: All GuardPipeline tests pass (existing + 3 new).

- [ ] **Step 5: Commit**

```
feat(pipeline): add skipLeaveGuards option to evaluate()

Allows redirect chain hops to skip leave guard execution while
preserving fromRoute in the context for guard functions to read.

Closes part of #52.
```

---

### Task 2: Add `captureErrors` helper to test utilities

**Files:**

- Modify: `packages/lib/test/qunit/testHelpers.ts`

- [ ] **Step 1: Add `captureErrors` and `captureErrorsAsync` helpers**

Follow the exact pattern of the existing `captureWarnings`/`captureWarningsAsync`, but for `Log.error`:

```typescript
export interface CapturedLogEntry {
	message: string;
	details?: string;
}

export function captureErrors(fn: () => void): CapturedLogEntry[] {
	const errors: CapturedLogEntry[] = [];
	const original = Log.error;
	Log.error = (message: string, details?: string) => {
		errors.push({ message, details });
	};
	try {
		fn();
	} finally {
		Log.error = original;
	}
	return errors;
}

export async function captureErrorsAsync(fn: () => Promise<void>): Promise<CapturedLogEntry[]> {
	const errors: CapturedLogEntry[] = [];
	const original = Log.error;
	Log.error = (message: string, details?: string) => {
		errors.push({ message, details });
	};
	try {
		await fn();
	} finally {
		Log.error = original;
	}
	return errors;
}
```

Also refactor the existing `CapturedWarning` type to reuse `CapturedLogEntry` (they have the same shape). Update the return type of `captureWarnings`/`captureWarningsAsync` to `CapturedLogEntry[]`.

- [ ] **Step 2: Run tests to verify nothing is broken**

Run: `npm run test:qunit`
Expected: All tests pass (no behavioral changes, just added helpers).

- [ ] **Step 3: Commit**

```
test(helpers): add captureErrors/captureErrorsAsync for Log.error

Mirrors the existing captureWarnings pattern. Needed for testing
redirect loop detection error messages in #52.
```

---

### Task 3: Add `RedirectChainContext` interface and `MAX_REDIRECT_DEPTH` constant

**Files:**

- Modify: `packages/lib/src/Router.ts`

- [ ] **Step 1: Add the interface and constant**

Add after the existing `RouterPhase` type alias (around line 64), before the Router class:

```typescript
/** Maximum number of hops in a redirect chain before it is treated as a loop. */
const MAX_REDIRECT_DEPTH = 10;

/** State threaded through a redirect chain. */
interface RedirectChainContext {
	/** Hashes whose guards have been evaluated in this chain (mutated via .add()). */
	visited: Set<string>;
	/** Hash of the originally attempted navigation (for settlement / hash restore). */
	readonly attemptedHash: string | undefined;
	/** Whether to restore the hash on block (true for parse path, false for preflight). */
	readonly restoreHash: boolean;
	/** Original source route — the route the user is currently on. */
	readonly fromRoute: string;
	/** Original source hash — the hash the user is currently on. */
	readonly fromHash: string;
	/** Shared AbortSignal from the original navigation. */
	readonly signal: AbortSignal;
	/** Shared generation counter from the original navigation. */
	readonly generation: number;
}
```

- [ ] **Step 2: Run tests to verify nothing is broken**

Run: `npm run test:qunit`
Expected: All tests pass (interface and constant are unused so far).

- [ ] **Step 3: Commit**

```
refactor(router): add RedirectChainContext interface and MAX_REDIRECT_DEPTH

Preparatory types for evaluating guards on redirect targets (#52).
```

---

### Task 4: Refactor `_redirect` to evaluate guards on each hop

This is the core change. Replace the current bypass-and-commit logic with recursive guard evaluation.

**Files:**

- Modify: `packages/lib/src/Router.ts`

- [ ] **Step 1: Write `_applyRedirectDecision` helper method**

Add a new private method after `_redirect`. This handles the result of evaluating guards on a redirect target:

```typescript
/**
 * Apply a guard decision within a redirect chain. For "allow", enter
 * committing phase and delegate to navTo (which hits the existing bypass).
 * For "block", block the entire chain. For "redirect", recurse.
 */
private _applyRedirectDecision(
	decision: GuardDecision,
	target: string | GuardRedirect,
	targetHash: string,
	chain: RedirectChainContext,
): void {
	switch (decision.action) {
		case "allow": {
			const targetName = typeof target === "string" ? target : target.route;
			const settlementBefore = this._lastSettlement;
			this._phase = { kind: "committing", hash: targetHash, route: targetName, origin: "redirect" };
			try {
				if (typeof target === "string") {
					this.navTo(target, {}, {}, true);
				} else {
					this.navTo(target.route, target.parameters ?? {}, target.componentTargetInfo, true);
				}
			} finally {
				if (this._phase.kind === "committing") {
					this._phase = IDLE;
				}
			}
			// Safety net: if navTo didn't produce a settlement (e.g. unknown route
			// or redirect to current hash where HashChanger doesn't fire), handle it.
			if (this._lastSettlement === settlementBefore) {
				const redirectsToCurrentHash = targetHash === (this._currentHash ?? "");
				if (redirectsToCurrentHash) {
					this._phase = {
						kind: "committing",
						hash: this._currentHash ?? "",
						route: this._currentRoute,
						origin: "redirect",
					};
					this._commitNavigation(this._currentHash ?? "", this._currentRoute);
					return;
				}
				Log.warning(
					`Guard redirect target "${targetName}" did not produce a navigation, treating as blocked`,
					undefined,
					LOG_COMPONENT,
				);
				this._blockNavigation(chain.attemptedHash, chain.restoreHash);
			}
			break;
		}
		case "block":
			this._blockNavigation(chain.attemptedHash, chain.restoreHash);
			break;
		case "redirect":
			this._redirect(decision.target, chain);
			break;
	}
}
```

- [ ] **Step 2: Rewrite `_redirect` method**

Replace the entire `_redirect` method body with the new recursive evaluation logic:

```typescript
/** Perform a guard redirect with full guard evaluation on the target route. */
private _redirect(target: string | GuardRedirect, chain: RedirectChainContext): void {
	const targetName = typeof target === "string" ? target : target.route;
	let targetHash: string | null = null;
	const targetParameters = typeof target === "string" ? {} : (target.parameters ?? {});
	const targetRoute = this.getRoute(targetName);
	if (targetRoute) {
		try {
			targetHash = targetRoute.getURL(targetParameters);
		} catch {
			targetHash = null;
		}
	}

	// Loop detection: visited set (exact hash match) + depth cap.
	if (targetHash !== null && chain.visited.has(targetHash)) {
		Log.error(
			`Guard redirect loop detected: ${[...chain.visited, targetHash].join(" -> ")}`,
			undefined,
			LOG_COMPONENT,
		);
		this._blockNavigation(chain.attemptedHash, chain.restoreHash);
		return;
	}
	if (chain.visited.size >= MAX_REDIRECT_DEPTH) {
		Log.error(
			`Guard redirect chain exceeded maximum depth (${MAX_REDIRECT_DEPTH}): ${[...chain.visited].join(" -> ")}`,
			undefined,
			LOG_COMPONENT,
		);
		this._blockNavigation(chain.attemptedHash, chain.restoreHash);
		return;
	}
	if (targetHash !== null) {
		chain.visited.add(targetHash);
	}

	// If the target route doesn't exist or the hash couldn't be resolved,
	// fall through to _applyRedirectDecision's safety net via the allow path.
	if (targetHash === null) {
		this._applyRedirectDecision({ action: "allow" }, target, "", chain);
		return;
	}

	// Build guard context for the redirect target.
	const routeInfo = this.getRouteInfoByHash(targetHash);
	const context: GuardContext = {
		toRoute: routeInfo?.name ?? "",
		toHash: targetHash,
		toArguments: routeInfo?.arguments ?? {},
		fromRoute: chain.fromRoute,
		fromHash: chain.fromHash,
		signal: chain.signal,
	};

	const decision = this._pipeline.evaluate(context, { skipLeaveGuards: true });

	if (isPromiseLike(decision)) {
		decision
			.then((d: GuardDecision) => {
				if (chain.generation !== this._parseGeneration) return;
				this._applyRedirectDecision(d, target, targetHash!, chain);
			})
			.catch((error: unknown) => {
				if (chain.generation !== this._parseGeneration) return;
				Log.error(
					`Guard pipeline failed during redirect chain for "${targetName}", blocking navigation`,
					String(error),
					LOG_COMPONENT,
				);
				this._blockNavigation(chain.attemptedHash, chain.restoreHash);
			});
		return;
	}

	this._applyRedirectDecision(decision, target, targetHash, chain);
}
```

- [ ] **Step 3: Update call sites to pass `RedirectChainContext`**

In `_applyPreflightDecision`, update the redirect case:

```typescript
case "redirect": {
	const { attempt } = this._phase as PhaseEvaluating;
	const visited = new Set<string>();
	visited.add(targetHash);
	this._redirect(decision.target, {
		visited,
		attemptedHash: targetHash,
		restoreHash: false,
		fromRoute: this._currentRoute,
		fromHash: this._currentHash ?? "",
		signal: attempt.controller.signal,
		generation: attempt.generation,
	});
	break;
}
```

In `_applyDecision`, update the redirect case:

```typescript
case "redirect": {
	const { attempt } = this._phase as PhaseEvaluating;
	const visited = new Set<string>();
	visited.add(hash);
	this._redirect(decision.target, {
		visited,
		attemptedHash: hash,
		restoreHash: true,
		fromRoute: this._currentRoute,
		fromHash: this._currentHash ?? "",
		signal: attempt.controller.signal,
		generation: attempt.generation,
	});
	break;
}
```

Note: `_applyDecision` and `_applyPreflightDecision` are called from both sync and async paths. In the async path, `this._phase` might have been changed by a superseding navigation. However, the generation check in the async `.then()` callback ensures we only reach these call sites when the phase is still `evaluating` with the correct attempt. The cast to `PhaseEvaluating` is safe under that invariant.

- [ ] **Step 4: Update the Router class JSDoc**

In the class-level JSDoc comment (around line 82-91), remove or update the line about redirect targets bypassing guards:

Change: `* - Redirect targets bypass guards to prevent infinite loops.`
To: `* - Redirect targets are evaluated by the guard pipeline with loop detection.`

- [ ] **Step 5: Update existing tests that assert the old bypass behavior**

Three existing tests assert that redirect targets bypass guards. Update them to match the new behavior:

**a) Line 1070: "Multiple route guards with cross-redirects settle correctly"**

The chain is now: forbidden -> (guard: redirect to protected) -> protected -> (guard: redirect to home) -> home. Update to expect landing on `home` instead of `protected`:

```typescript
QUnit.test("Multiple route guards with cross-redirects settle correctly", async function (assert: Assert) {
	// forbidden -> redirects to protected -> redirects to home
	// The redirect chain evaluates guards on each hop.
	router.addRouteGuard("forbidden", () => "protected");
	router.addRouteGuard("protected", () => "home");
	router.initialize();

	router.navTo("forbidden");
	await waitForRoute(router, "home");
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Cross-redirect chain followed to home");
});
```

**b) Line 3217: "Redirect target's own guard is bypassed by committing/redirect phase"**

This test now asserts the opposite — redirect target's guard BLOCKS the chain:

```typescript
QUnit.test("Redirect target's own guard is evaluated (not bypassed)", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Redirect target's blocking guard blocks the chain");
});
```

**c) Line 1973: "Leave guard does not run during redirects"**

The assertion (`leaveGuardCallCount === 1`) still holds because `skipLeaveGuards: true` is used on redirect hops. Update the comment only:

```typescript
// The redirect from forbidden back to home should NOT trigger
// the leave guard again because redirect hops use skipLeaveGuards
```

- [ ] **Step 6: Run existing tests**

Run: `npm run test:qunit`
Expected: All existing tests pass with the updated assertions.

- [ ] **Step 7: Commit**

```
feat(router): evaluate guards on redirect targets (#52)

Replace the redirect guard bypass with recursive evaluation. Each
hop in a redirect chain runs the full enter-guard pipeline on the
target route. Loop detection uses a visited-set (tracking hashes)
plus a MAX_REDIRECT_DEPTH=10 cap. Leave guards run only on the
first hop.

BREAKING CHANGE: Guards registered on redirect target routes now
execute during redirect chains. Previously they were skipped.
```

---

### Task 5: Write integration tests for redirect chain guard evaluation

**Files:**

- Modify: `packages/lib/test/qunit/Router.qunit.ts`

- [ ] **Step 1: Add a new QUnit module for redirect chain tests**

Add after the existing redirect test sections:

```typescript
QUnit.module("Router - Guards on redirect targets", standardHooks);
```

- [ ] **Step 2: Test — redirect target's guards are evaluated (basic case)**

```typescript
QUnit.test("Guard on redirect target is evaluated", async function (assert: Assert) {
	const called: string[] = [];
	router.addRouteGuard("protected", () => {
		called.push("protected");
		return "forbidden";
	});
	router.addRouteGuard("forbidden", () => {
		called.push("forbidden");
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "forbidden");
	assert.deepEqual(called, ["protected", "forbidden"], "Both guards ran");
	assert.strictEqual(getHash(), "forbidden", "Landed on redirect target");
});
```

- [ ] **Step 3: Test — redirect target's guard blocks entire chain**

```typescript
QUnit.test("Guard on redirect target blocks entire chain", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Chain blocked");
	assert.strictEqual(getHash(), "", "Hash unchanged (preflight)");
});
```

- [ ] **Step 4: Test — multi-hop chain (A -> B -> C)**

```typescript
QUnit.test("Redirect chain follows multiple hops (A -> B -> C)", async function (assert: Assert) {
	// Chain: protected -> forbidden -> detail (avoids redirecting back to current route)
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => ({ route: "detail", parameters: { id: "chain" } }));
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "detail");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Redirected, "Settled as Redirected");
	assert.strictEqual(getHash(), "detail/chain", "Landed on final hop");
});
```

- [ ] **Step 5: Test — redirect loop (A -> B -> A) detected**

```typescript
QUnit.test("Redirect loop (A -> B -> A) is detected and blocked", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => "protected");
	router.initialize();
	await waitForRoute(router, "home");

	const errors = await captureErrorsAsync(async () => {
		router.navTo("protected");
		await router.navigationSettled();
	});
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Loop blocked");
	assert.ok(
		errors.some((e) => e.message.includes("redirect loop detected")),
		"Error logged about redirect loop",
	);
});
```

- [ ] **Step 6: Test — settlement outcomes**

```typescript
QUnit.test("Settlement is Redirected for successful chain", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "forbidden");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Redirected, "Redirected settlement");
	assert.strictEqual(result.route, "forbidden", "Settled on redirect target route");
});

QUnit.test("Settlement is Blocked when redirect target guard blocks", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Blocked settlement");
});
```

- [ ] **Step 7: Test — guard context on redirect target**

```typescript
QUnit.test("Guard on redirect target receives correct context", async function (assert: Assert) {
	let capturedContext: GuardContext | undefined;
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", (ctx: GuardContext) => {
		capturedContext = ctx;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "forbidden");
	assert.ok(capturedContext, "Guard on redirect target was called");
	assert.strictEqual(capturedContext!.toRoute, "forbidden", "toRoute is redirect target");
	assert.strictEqual(capturedContext!.toHash, "forbidden", "toHash is redirect target hash");
	assert.strictEqual(capturedContext!.fromRoute, "home", "fromRoute is original source");
	assert.strictEqual(capturedContext!.fromHash, "", "fromHash is original source hash");
});
```

- [ ] **Step 8: Test — leave guards run only on first hop**

```typescript
QUnit.test("Leave guards run only on first hop, not on redirect hops", async function (assert: Assert) {
	let leaveCallCount = 0;
	router.addLeaveGuard("home", () => {
		leaveCallCount++;
		return true;
	});
	router.addRouteGuard("protected", () => "forbidden");
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "forbidden");
	assert.strictEqual(leaveCallCount, 1, "Leave guard ran exactly once (first hop only)");
});
```

- [ ] **Step 9: Run all tests**

Run: `npm run test:qunit`
Expected: All tests pass.

- [ ] **Step 10: Commit**

```
test(router): add integration tests for guards on redirect targets

Covers basic evaluation, chain blocking, multi-hop chains, loop
detection, settlement outcomes, guard context, and leave guard
semantics.
```

---

### Task 6: Write integration tests for async chains and edge cases

**Files:**

- Modify: `packages/lib/test/qunit/Router.qunit.ts`

- [ ] **Step 1: Test — async guards in redirect chain**

```typescript
QUnit.test("Async guards in redirect chain work correctly", async function (assert: Assert) {
	router.addRouteGuard("protected", async () => {
		await nextTick(10);
		return "forbidden";
	});
	router.addRouteGuard("forbidden", async () => {
		await nextTick(10);
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "forbidden");
	assert.strictEqual(getHash(), "forbidden", "Async chain resolved to redirect target");
});
```

- [ ] **Step 2: Test — superseding navigation cancels async chain**

```typescript
QUnit.test("Superseding navigation during async redirect chain cancels the chain", async function (assert: Assert) {
	router.addRouteGuard("protected", async () => {
		await nextTick(50);
		return "forbidden";
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	// Supersede before the async guard resolves
	router.navTo("detail", { id: "1" });
	await waitForRoute(router, "detail");
	assert.strictEqual(getHash(), "detail/1", "Superseding navigation won");
});
```

- [ ] **Step 3: Test — self-redirect detected as loop**

```typescript
QUnit.test("Self-redirect (A -> A) detected as loop", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "protected");
	router.initialize();
	await waitForRoute(router, "home");

	const errors = await captureErrorsAsync(async () => {
		router.navTo("protected");
		await router.navigationSettled();
	});
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Self-redirect blocked");
	assert.ok(
		errors.some((e) => e.message.includes("redirect loop detected")),
		"Loop detection error logged",
	);
});
```

- [ ] **Step 4: Test — redirect target is unknown route**

```typescript
QUnit.test("Redirect to unknown route is treated as blocked", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "nonexistent");
	router.initialize();
	await waitForRoute(router, "home");

	const warnings = await captureWarningsAsync(async () => {
		router.navTo("protected");
		await router.navigationSettled();
	});
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Unknown redirect target blocked");
	assert.ok(
		warnings.some((w) => w.message.includes("did not produce a navigation")),
		"Warning logged about failed redirect",
	);
});
```

- [ ] **Step 5: Test — guard on redirect target throws**

```typescript
QUnit.test("Guard on redirect target that throws blocks entire chain", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => {
		throw new Error("guard explosion");
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Chain blocked when guard throws");
});
```

- [ ] **Step 6: Test — max depth exceeded**

```typescript
QUnit.test("Max redirect depth exceeded blocks with error", async function (assert: Assert) {
	// Create a chain that exceeds MAX_REDIRECT_DEPTH (10) using parameterized redirects
	// to the same route with different params (different hashes, avoids visited-set detection).
	let callCount = 0;
	router.addRouteGuard("detail", (ctx: GuardContext) => {
		callCount++;
		const currentId = Number(ctx.toArguments.id ?? "0");
		return { route: "detail", parameters: { id: String(currentId + 1) } };
	});
	router.initialize();
	await waitForRoute(router, "home");

	const errors = await captureErrorsAsync(async () => {
		router.navTo("detail", { id: "0" });
		await router.navigationSettled();
	});
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Depth exceeded blocked");
	assert.ok(callCount <= 10, `Guard called at most 10 times (was ${callCount})`);
	assert.ok(
		errors.some((e) => e.message.includes("maximum depth")),
		"Error logged about max depth",
	);
});
```

- [ ] **Step 7: Test — redirect chain via parse (browser navigation)**

```typescript
QUnit.test("Redirect chain works via parse (browser back/forward)", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => true);
	router.initialize();
	await waitForRoute(router, "home");

	// Simulate browser navigation (hash change without navTo)
	HashChanger.getInstance().setHash("protected");
	await waitForRoute(router, "forbidden");
	assert.strictEqual(getHash(), "forbidden", "Parse-path redirect chain resolved");
});
```

- [ ] **Step 8: Test — redirect to current hash evaluates guards**

```typescript
QUnit.test("Redirect to current hash evaluates guards and commits", async function (assert: Assert) {
	let homeGuardCalled = false;
	router.addRouteGuard("protected", () => "home");
	router.addRouteGuard("home", () => {
		homeGuardCalled = true;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Redirected, "Redirected settlement");
	assert.ok(homeGuardCalled, "Guard on redirect target (current hash) was evaluated");
});
```

- [ ] **Step 9: Run all tests**

Run: `npm run test:qunit`
Expected: All tests pass.

- [ ] **Step 10: Commit**

```
test(router): add async, edge case, and loop detection tests (#52)

Covers async chains, superseding navigation, self-redirect, unknown
routes, guard throws, max depth, parse-path chains, and redirect
to current hash.
```

---

### Task 7: Update architecture docs and README

**Files:**

- Modify: `docs/reference/architecture.md`
- Modify: `packages/lib/README.md`

- [ ] **Step 1: Update architecture.md**

Find the section about redirect targets bypassing guards and update it to describe the new behavior: guards are evaluated on redirect targets with loop detection via a visited set and depth cap.

- [ ] **Step 2: Update README.md**

Find the limitations section that mentions "Redirect targets bypass guards" and remove or replace it with the new behavior description.

- [ ] **Step 3: Commit**

```
docs(router): update architecture and README for redirect chain guards

Remove the "redirect targets bypass guards" limitation. Document the
new visited-set loop detection and MAX_REDIRECT_DEPTH cap.
```

---

### Task 8: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: All QUnit and e2e tests pass.

- [ ] **Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit` (or the project's type-check script)
Expected: No errors.

- [ ] **Step 3: Review all changes**

Run: `git diff main --stat` and review the full diff.
Verify:

- No unintended changes outside the scope
- All new code follows existing patterns
- JSDoc comments are accurate
- No `as any` or double casts
