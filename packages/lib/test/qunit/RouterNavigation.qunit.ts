import sinon from "sinon";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type {
	GuardContext,
	GuardFn,
	GuardRedirect,
	GuardRouter,
	Router$NavigationSettledEvent,
} from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import {
	assertBlocked,
	captureErrorsAsync,
	captureWarningsAsync,
	createRouter,
	getHash,
	initHashChanger,
	nextTick,
	waitForRoute,
} from "./testHelpers";

let router: GuardRouter;

const standardHooks = {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
};

// ============================================================
// Module: Hash change simulation (direct URL entry)
// ============================================================
QUnit.module("Router - Hash change (direct URL entry)", standardHooks);

QUnit.test("Direct hash change to guarded route is blocked", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await assertBlocked(
		assert,
		router,
		() => HashChanger.getInstance().setHash("protected"),
		"Direct hash change was blocked by guard",
	);
});

QUnit.test("Direct hash change to unguarded route proceeds", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	// Navigate to forbidden (unguarded) so we're away from home
	router.navTo("forbidden");
	await waitForRoute(router, "forbidden");

	// Direct hash change to home (unguarded) should proceed
	HashChanger.getInstance().setHash("");
	await waitForRoute(router, "home");
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Unguarded route matched via hash change");
});

QUnit.test("Direct hash change with redirect restores correct hash", async function (assert: Assert) {
	router.addRouteGuard("forbidden", () => "home");
	router.initialize();
	await waitForRoute(router, "home");

	HashChanger.getInstance().setHash("forbidden");
	await waitForRoute(router, "home");
	await nextTick(50);

	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Hash was restored to home route");
});

// ============================================================
// Module: Sequential navigation with dynamic guard state
// ============================================================
QUnit.module("Router - Sequential navigation with changing guards", standardHooks);

QUnit.test("Guard state change between navigations is respected", async function (assert: Assert) {
	let allowNavigation = false;
	router.addRouteGuard("protected", () => (allowNavigation ? true : "home"));
	router.initialize();

	let homeMatchCount = 0;
	router.getRoute("home")!.attachPatternMatched(() => {
		homeMatchCount++;
	});

	router.navTo("protected");
	await waitForRoute(router, "home");
	assert.ok(homeMatchCount > 0, "First attempt redirected to home");

	allowNavigation = true;
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(HashChanger.getInstance().getHash(), "protected", "Second attempt allowed after state change");
});

QUnit.test("Adding guard mid-session blocks subsequent navigations", async function (assert: Assert) {
	router.initialize();

	// First nav: no guards, should work
	router.navTo("protected");
	await waitForRoute(router, "protected");

	// Now add a guard
	router.addRouteGuard("protected", () => false);

	// Navigate away and back
	router.navTo("home");
	await waitForRoute(router, "home");
	await assertBlocked(assert, router, () => router.navTo("protected"), "Guard added mid-session blocked navigation");
});

QUnit.test("Removing guard mid-session allows subsequent navigations", async function (assert: Assert) {
	const guard: GuardFn = () => false;
	router.addRouteGuard("protected", guard);
	router.initialize();

	// First attempt: blocked
	router.navTo("protected");
	await router.navigationSettled();

	// Remove the guard
	router.removeRouteGuard("protected", guard);

	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(HashChanger.getInstance().getHash(), "protected", "Navigation allowed after guard removed");
});

// ============================================================
// Module: Guard re-entrancy (guard triggers navigation)
// ============================================================
QUnit.module("Router - Guard re-entrancy", standardHooks);

QUnit.test("Guard that returns redirect does not cause infinite loop", async function (assert: Assert) {
	let guardCallCount = 0;
	router.addRouteGuard("forbidden", () => {
		guardCallCount++;
		return "home";
	});
	router.initialize();

	router.navTo("forbidden");
	await router.navigationSettled();
	assert.strictEqual(guardCallCount, 1, "Guard only called once (no infinite loop)");
});

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

// ============================================================
// Module: GuardRedirect with componentTargetInfo
// ============================================================
QUnit.module("Router - GuardRedirect with componentTargetInfo", standardHooks);

QUnit.test("GuardRedirect with componentTargetInfo redirects and arrives at target", async function (assert: Assert) {
	router.addRouteGuard(
		"forbidden",
		(): GuardRedirect => ({
			route: "detail",
			parameters: { id: "cti-1" },
			componentTargetInfo: {},
		}),
	);
	router.initialize();
	router.navTo("forbidden");
	await waitForRoute(router, "detail");
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"detail/cti-1",
		"Redirect with componentTargetInfo landed with correct params",
	);
});

QUnit.test("GuardRedirect forwards non-empty componentTargetInfo to navTo", async function (assert: Assert) {
	const expectedCTI = { detail: { route: "sub", parameters: { subId: "x" } } };
	const navToSpy = sinon.spy(router, "navTo");

	try {
		router.addRouteGuard(
			"forbidden",
			(): GuardRedirect => ({
				route: "detail",
				parameters: { id: "cti-2" },
				componentTargetInfo: expectedCTI,
			}),
		);
		router.initialize();
		router.navTo("forbidden");
		await waitForRoute(router, "detail");

		const redirectCall = navToSpy.getCalls().find((c) => c.args[0] === "detail");
		assert.ok(redirectCall, "navTo was called with redirect target 'detail'");
		assert.deepEqual(
			redirectCall!.args[2],
			expectedCTI,
			"Non-empty componentTargetInfo forwarded to navTo during redirect",
		);
	} finally {
		navToSpy.restore();
	}
});

// ============================================================
// Module: Nested navigation from routeMatched handler
// ============================================================
QUnit.module("Router - Nested navigation from routeMatched handler", standardHooks);

QUnit.test("navTo from routeMatched handler runs leave guards for the NEW route", async function (assert: Assert) {
	// Scenario: home → protected (routeMatched fires, handler calls navTo("forbidden"))
	// The leave guard on "protected" should run, NOT the leave guard on "home" a second time
	let homeLeaveGuardCallCount = 0;
	let protectedLeaveGuardCallCount = 0;

	router.addLeaveGuard("home", () => {
		homeLeaveGuardCallCount++;
		return true;
	});
	router.addLeaveGuard("protected", () => {
		protectedLeaveGuardCallCount++;
		return true;
	});

	router.initialize();
	await waitForRoute(router, "home");

	// Reset counts after initial navigation
	homeLeaveGuardCallCount = 0;
	protectedLeaveGuardCallCount = 0;

	// Navigate to protected, then immediately navigate to forbidden from the handler
	router.getRoute("protected")!.attachPatternMatched(function handler() {
		router.getRoute("protected")!.detachPatternMatched(handler);
		// This navTo happens inside the routeMatched event for "protected"
		// Leave guards for "protected" should run (we're leaving protected to go to forbidden)
		router.navTo("forbidden");
	});

	router.navTo("protected");
	await waitForRoute(router, "forbidden");

	// The home leave guard should have run ONCE (when leaving home to go to protected)
	assert.strictEqual(homeLeaveGuardCallCount, 1, "Home leave guard ran exactly once (home → protected)");
	// The protected leave guard should run ONCE (when leaving protected to go to forbidden)
	assert.strictEqual(
		protectedLeaveGuardCallCount,
		1,
		"Protected leave guard ran exactly once (protected → forbidden from routeMatched handler)",
	);
});

// ============================================================
// Module: navTo preflight
// ============================================================
QUnit.module("Router - navTo preflight", standardHooks);

QUnit.test("blocked programmatic navTo does not change the hash", function (assert) {
	router.addGuard(() => false);
	router.initialize();

	const hashBefore = getHash();
	router.navTo("protected");

	assert.strictEqual(getHash(), hashBefore, "Hash unchanged after blocked navTo");
});

QUnit.test("blocked programmatic navTo settles as Blocked", async function (assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Settlement is Blocked");
	assert.strictEqual(result.route, "home", "Route stays on home");
});

QUnit.test("redirected programmatic navTo does not create intermediate hash", function (assert) {
	router.addRouteGuard("protected", () => "home");
	router.initialize();

	const hashBefore = getHash();
	router.navTo("protected");

	assert.strictEqual(getHash(), hashBefore, "Hash did not visit intermediate protected route");
});

QUnit.test("redirected programmatic navTo settles as Redirected", async function (assert) {
	router.addRouteGuard("protected", () => "home");
	router.initialize();

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Redirected, "Settlement is Redirected");
	assert.strictEqual(result.route, "home", "Route is home after redirect");
});

QUnit.test("allowed programmatic navTo is not double-guarded in parse", async function (assert) {
	let guardCallCount = 0;
	router.addGuard(() => {
		guardCallCount++;
		return true;
	});
	router.initialize();
	guardCallCount = 0; // reset after initialize fires parse

	router.navTo("protected");
	await router.navigationSettled();

	assert.strictEqual(guardCallCount, 1, "Guard ran exactly once, not in both navTo and parse");
});

QUnit.test("async blocked programmatic navTo does not change the hash", async function (assert) {
	router.addGuard(() => Promise.resolve(false));
	router.initialize();

	const hashBefore = getHash();
	router.navTo("protected");
	await router.navigationSettled();

	assert.strictEqual(getHash(), hashBefore, "Hash unchanged after async blocked navTo");
});

QUnit.test("async redirected programmatic navTo settles as Redirected", async function (assert) {
	router.addRouteGuard("protected", () => Promise.resolve("home"));
	router.initialize();

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Redirected, "Settlement is Redirected");
	assert.strictEqual(result.route, "home", "Route is home after async redirect");
});

QUnit.test(
	"same-hash redirect via navTo forwards componentTargetInfo without rematching the top-level route",
	async function (assert) {
		const expectedCTI = { detail: { route: "sub", parameters: { subId: "x" } } };
		const calls: unknown[][] = [];
		let homePatternMatched = 0;

		router.getRoute("home")!.attachPatternMatched(() => {
			homePatternMatched++;
		});

		const originalNavTo = Reflect.get(router, "navTo") as (...args: unknown[]) => unknown;
		Reflect.set(router, "navTo", function (this: unknown, ...args: unknown[]) {
			calls.push(args);
			if (args[0] === "home") {
				return router;
			}
			return Reflect.apply(originalNavTo, this, args);
		});

		try {
			router.addRouteGuard(
				"forbidden",
				(): GuardRedirect => ({
					route: "home",
					componentTargetInfo: expectedCTI,
				}),
			);
			router.initialize();
			await waitForRoute(router, "home");
			calls.length = 0;
			homePatternMatched = 0;

			const homeMatched = waitForRoute(router, "home");
			router.navTo("forbidden");
			await homeMatched;
			const result = await router.navigationSettled();

			assert.strictEqual(result.status, NavigationOutcome.Redirected, "Settlement is Redirected");
			assert.ok(calls.length >= 2, "navTo called at least twice (trigger + redirect)");
			const redirectCall = calls[calls.length - 1];
			assert.strictEqual(redirectCall[0], "home", "Redirect targeted the current top-level route");
			assert.deepEqual(redirectCall[2], expectedCTI, "componentTargetInfo forwarded on same-hash redirect");
			assert.strictEqual(homePatternMatched, 1, "Top-level route was re-matched once for the redirect");
		} finally {
			Reflect.set(router, "navTo", originalNavTo);
		}
	},
);

QUnit.test("navTo with replace=true works through preflight with guards", async function (assert) {
	let guardCallCount = 0;
	router.addGuard(() => {
		guardCallCount++;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");
	guardCallCount = 0;

	// Navigate to protected first (creates history entry)
	router.navTo("protected");
	await router.navigationSettled();
	assert.strictEqual(getHash(), "protected", "Navigated to protected");
	assert.strictEqual(guardCallCount, 1, "Guard ran for first navigation");

	// Navigate with replace=true (3-arg overload)
	router.navTo("forbidden", {}, true);
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "Navigation committed");
	assert.strictEqual(getHash(), "forbidden", "Hash updated to forbidden");
	assert.strictEqual(guardCallCount, 2, "Guard ran for replace navigation");
});

QUnit.test("navTo with replace=true works through preflight (4-arg overload)", async function (assert) {
	router.addGuard(() => true);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await router.navigationSettled();

	// Navigate with replace=true (4-arg overload)
	router.navTo("forbidden", {}, {}, true);
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "Navigation committed");
	assert.strictEqual(getHash(), "forbidden", "Hash updated to forbidden");
});

QUnit.test("navTo returns this for chaining", function (assert) {
	router.initialize();
	const result = router.navTo("home");
	assert.strictEqual(result, router, "navTo returns this");
});

QUnit.test("navTo to unknown route falls through to parent without error", function (assert) {
	router.initialize();

	// Unknown routes bypass preflight and delegate to super.navTo().
	// UI5 sets the hash to "" for unknown routes, which triggers same-hash
	// dedup in parse(). The router does not throw.
	router.navTo("nonexistent");
	assert.ok(true, "navTo to unknown route did not throw");
});

QUnit.test("navTo to unknown route cancels pending async guard pipeline", async function (assert) {
	let resolveGuard!: (value: boolean) => void;
	router.addGuard(
		() =>
			new Promise<boolean>((r) => {
				resolveGuard = r;
			}),
	);
	router.initialize();

	// Start an async preflight to a guarded route.
	router.navTo("protected");
	const settled = router.navigationSettled();

	// While the async guard is pending, navTo to an unknown route.
	// This must cancel the pending navigation so settlement resolvers drain.
	router.navTo("nonexistent");

	// Resolve the now-stale guard to prove it is discarded.
	resolveGuard(true);

	const result = await settled;
	assert.strictEqual(
		result.status,
		NavigationOutcome.Cancelled,
		"Pending navigation cancelled when unknown-route navTo supersedes it",
	);
});

QUnit.test("navTo to unknown route then real route works after cancellation", async function (assert) {
	let resolveGuard!: (value: boolean) => void;
	router.addGuard((context) => {
		if (context.toRoute === "forbidden") {
			return true;
		}
		return new Promise<boolean>((r) => {
			resolveGuard = r;
		});
	});
	router.initialize();

	// Start async preflight.
	router.navTo("protected");
	const firstSettled = router.navigationSettled();

	// Unknown route supersedes.
	router.navTo("nonexistent");
	resolveGuard(true);

	const cancelResult = await firstSettled;
	assert.strictEqual(cancelResult.status, NavigationOutcome.Cancelled, "First navigation cancelled");

	// Subsequent navTo to a real route must work normally.
	router.navTo("forbidden");
	const secondResult = await router.navigationSettled();
	assert.strictEqual(secondResult.status, NavigationOutcome.Committed, "Subsequent navigation commits");
	assert.strictEqual(secondResult.route, "forbidden", "Landed on forbidden");
});

QUnit.test("async preflight superseded by second navTo cancels first", async function (assert) {
	let resolveGuard!: (value: boolean) => void;
	router.addGuard(
		() =>
			new Promise<boolean>((r) => {
				resolveGuard = r;
			}),
	);
	router.initialize();

	router.navTo("protected"); // starts async preflight
	const settled = router.navigationSettled();
	router.navTo("forbidden"); // supersedes first

	resolveGuard(true); // resolves the second guard (shared variable was overwritten by navTo("forbidden"))

	const result = await settled;
	assert.strictEqual(result.status, NavigationOutcome.Cancelled, "First navigation cancelled");
});

QUnit.test("duplicate navTo to same pending hash is a no-op", async function (assert) {
	let guardCallCount = 0;
	router.addGuard(() => {
		guardCallCount++;
		return new Promise<boolean>((r) => setTimeout(() => r(true), 20));
	});
	router.initialize();
	guardCallCount = 0;

	router.navTo("protected");
	router.navTo("protected"); // same hash, should be deduped
	await router.navigationSettled();

	assert.strictEqual(guardCallCount, 1, "Guard ran only once despite duplicate navTo");
});

// Hash restoration pairs: same guard scenario, setHash (parse path) vs navTo (preflight).
// Parse path: hash already changed, must be restored after block.
// Preflight: hash never changed, stays unchanged.

QUnit.test("blocked via setHash restores the hash", async function (assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	HashChanger.getInstance().setHash("protected");
	await router.navigationSettled();
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Hash was restored after block");
});

QUnit.test("blocked via navTo leaves hash unchanged", async function (assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await router.navigationSettled();
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Hash unchanged - preflight never changed it");
});

QUnit.test("rejected async guard via navTo leaves hash unchanged", async function (assert) {
	router.addRouteGuard("protected", () => Promise.reject(new Error("guard error")));
	router.initialize();
	await waitForRoute(router, "home");

	const hashBefore = getHash();
	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Error, "Rejected guard settles as Error");
	assert.strictEqual(getHash(), hashBefore, "Hash unchanged after rejected async preflight guard");
});

QUnit.test(
	"external hash change to same pending hash during async preflight restores hash on block",
	async function (assert) {
		let resolveGuard!: (value: boolean) => void;
		router.addRouteGuard(
			"protected",
			() =>
				new Promise<boolean>((r) => {
					resolveGuard = r;
				}),
		);
		router.initialize();
		await waitForRoute(router, "home");

		const hashBefore = getHash();
		router.navTo("protected"); // async preflight, hash unchanged

		// Simulate external navigation to the same hash (URL bar, bookmark, etc.)
		// while the async preflight is still pending. parse() must not silently
		// drop this; it should cancel the preflight and take over.
		HashChanger.getInstance().setHash("protected");

		// Now block the guard.
		resolveGuard(false);
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Blocked, "Navigation blocked");
		assert.strictEqual(getHash(), hashBefore, "Hash restored after block - browser URL matches router state");
	},
);

QUnit.test("setHash during async preflight supersedes the preflight", async function (assert) {
	router.addRouteGuard("protected", async () => {
		await nextTick(200);
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const settledPromise = router.navigationSettled();

	// Browser back / direct hash change while async preflight is pending.
	// parse() bumps the generation counter, cancelling the preflight.
	await nextTick(10);
	HashChanger.getInstance().setHash("forbidden");

	const result = await settledPromise;
	assert.strictEqual(result.status, NavigationOutcome.Cancelled, "Preflight cancelled by parse");

	// The parse-driven navigation should proceed normally.
	await waitForRoute(router, "forbidden");
	assert.strictEqual(getHash(), "forbidden", "parse-driven navigation committed");
});

QUnit.test("redirect to nonexistent via setHash restores the hash", async function (assert) {
	router.addRouteGuard("protected", () => "nonExistentRoute");
	router.initialize();
	await waitForRoute(router, "home");

	HashChanger.getInstance().setHash("protected");
	await router.navigationSettled();
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Hash was restored after block");
});

QUnit.test("redirect to nonexistent via navTo leaves hash unchanged", async function (assert) {
	router.addRouteGuard("protected", () => "nonExistentRoute");
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await router.navigationSettled();
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Hash unchanged - preflight never changed it");
});

QUnit.test("async redirect to nonexistent via navTo leaves hash unchanged", async function (assert) {
	router.addRouteGuard("protected", () => Promise.resolve("nonExistentRoute" as const));
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await router.navigationSettled();
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Hash unchanged - preflight never changed it");
});

// ============================================================
// Module: Redirect edge cases
// ============================================================
QUnit.module("Router - Redirect edge cases", standardHooks);

QUnit.test("Global guard redirect short-circuits route-specific guard", async function (assert: Assert) {
	router.addGuard((context: GuardContext) => {
		if (context.toRoute === "protected") return "forbidden";
		return true;
	});
	let routeGuardCalled = false;
	router.addRouteGuard("protected", () => {
		routeGuardCalled = true;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Redirected, "Global guard redirect took effect");
	assert.strictEqual(result.route, "forbidden", "Redirected to forbidden");
	assert.notOk(routeGuardCalled, "Route guard was short-circuited by global guard redirect");
});

QUnit.test("Redirect target's own guard is evaluated (not bypassed)", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Redirect target's blocking guard blocks the chain");
});

// ============================================================
// Module: Redirect guard bypass regression
// ============================================================
QUnit.module("Router - Redirect guard bypass regression", standardHooks);

QUnit.test("navTo from navigationSettled handler during redirect still runs guards", async function (assert: Assert) {
	// A guard on "forbidden" redirects to "home".
	// A navigationSettled handler calls navTo("protected") when it sees the Redirected status.
	// A global guard blocks everything except "home".
	//
	// Regression guard: _flushSettlement fires the navigationSettled event
	// synchronously. The phase is set to idle before _flushSettlement, so
	// navTo() from the handler enters the full guard pipeline.
	router.addRouteGuard("forbidden", () => "home");
	router.addGuard((ctx: GuardContext) => ctx.toRoute === "home");

	router.initialize();
	await waitForRoute(router, "home");

	let nestedNavFired = false;
	const handler = (evt: Router$NavigationSettledEvent): void => {
		if (evt.getParameter("status") === NavigationOutcome.Redirected && !nestedNavFired) {
			nestedNavFired = true;
			// This fires synchronously during _flushSettlement while _phase is idle.
			// The guard should still block this navTo, but the bug bypasses it.
			router.navTo("protected");
		}
	};

	router.attachNavigationSettled(handler);

	router.navTo("forbidden");
	await nextTick();
	await router.navigationSettled();

	assert.strictEqual(getHash(), "", "Hash stayed on home -- guard blocked the nested navTo('protected')");
});

// ============================================================
// Module: Guards on redirect targets
// ============================================================
QUnit.module("Router - Guards on redirect targets", standardHooks);

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

QUnit.test("Redirect loop (A -> B -> A) is detected and blocked", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => "protected");
	router.initialize();
	await waitForRoute(router, "home");

	const errors = await captureErrorsAsync(async () => {
		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Blocked, "Loop blocked");
	});
	assert.ok(
		errors.some((e) => e.message.includes("redirect loop detected")),
		"Error logged about redirect loop",
	);
});

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

QUnit.test("Self-redirect (A -> A) detected as loop", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "protected");
	router.initialize();
	await waitForRoute(router, "home");

	const errors = await captureErrorsAsync(async () => {
		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Blocked, "Self-redirect blocked");
	});
	assert.ok(
		errors.some((e) => e.message.includes("redirect loop detected")),
		"Loop detection error logged",
	);
});

QUnit.test("Redirect to unknown route is treated as blocked", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "nonexistent");
	router.initialize();
	await waitForRoute(router, "home");

	const warnings = await captureWarningsAsync(async () => {
		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Blocked, "Unknown redirect target blocked");
	});
	assert.ok(
		warnings.some((w) => w.message.includes("did not produce a navigation")),
		"Warning logged about failed redirect",
	);
});

QUnit.test("Guard on redirect target that throws settles as Error", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => {
		throw new Error("guard explosion");
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Error, "Chain settles as Error when guard throws");
});

QUnit.test("Async guard rejecting during redirect chain settles as Error", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", async () => {
		await nextTick(10);
		throw new Error("async guard explosion in redirect chain");
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(
		result.status,
		NavigationOutcome.Error,
		"Async rejection in redirect chain settles as Error, not Blocked",
	);
	assert.ok(result.error instanceof Error, "error is captured on result");
});

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
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Blocked, "Depth exceeded blocked");
	});
	// 1 initial guard call + MAX_REDIRECT_DEPTH (10) redirect hops = 11 total
	assert.ok(callCount <= 11, `Guard called at most 11 times (was ${callCount})`);
	assert.ok(
		errors.some((e) => e.message.includes("maximum depth")),
		"Error logged about max depth",
	);
});

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
