import Log from "sap/base/Log";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardContext, GuardFn, GuardRouter, LeaveGuardFn, RouteGuardConfig } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import {
	addLeaveGuardUnsafe,
	assertBlocked,
	createPromiseLike,
	flushPromises,
	logMessages,
	type SinonTestContext,
	waitForRoute,
	routerHooks,
	getHash,
} from "../../testHelpers";

let router: GuardRouter;

const standardHooks = routerHooks(
	(created) => {
		router = created;
	},
	() => router,
);

// ============================================================
// Module: Leave guard invalid return values
// ============================================================
QUnit.module("Router - Leave guard invalid values", standardHooks);

QUnit.test("Leave guard returning null treats as block", async function (assert: Assert) {
	addLeaveGuardUnsafe(router, "home", () => null);
	router.initialize();
	await waitForRoute(router, "home");
	await assertBlocked(assert, router, () => router.navTo("protected"), "Null leave guard return treated as block");
});

QUnit.test("Async leave guard returning undefined treats as block", async function (assert: Assert) {
	addLeaveGuardUnsafe(router, "home", async () => undefined);
	router.initialize();
	await waitForRoute(router, "home");
	await assertBlocked(
		assert,
		router,
		() => router.navTo("protected"),
		"Async undefined leave guard return treated as block",
	);
});

QUnit.test(
	"Leave guard returning false blocks without warning",
	async function (this: SinonTestContext, assert: Assert) {
		const warning = this.stub(Log, "warning");
		router.addLeaveGuard("home", () => false);
		router.initialize();
		await waitForRoute(router, "home");
		await assertBlocked(assert, router, () => router.navTo("protected"), "False leave guard blocks navigation");
		assert.deepEqual(logMessages(warning), [], "No warning for a legitimate false return");
	},
);

QUnit.test("Leave guard returning non-boolean logs a warning", async function (this: SinonTestContext, assert: Assert) {
	const warning = this.stub(Log, "warning");
	addLeaveGuardUnsafe(router, "home", () => 42);
	router.initialize();
	await waitForRoute(router, "home");
	await assertBlocked(assert, router, () => router.navTo("protected"), "Non-boolean leave guard blocks");
	assert.deepEqual(
		logMessages(warning),
		["Leave guard returned non-boolean value, treating as block"],
		"One warning for the non-boolean leave guard return",
	);
});

// ============================================================
// Module: Leave Guards
// ============================================================
QUnit.module("Router - Leave Guards", standardHooks);

QUnit.test("Leave guard returning true allows navigation", async function (assert: Assert) {
	const leaveGuard: LeaveGuardFn = () => true;
	router.addLeaveGuard("home", leaveGuard);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(getHash(), "protected", "Navigation allowed by leave guard");
});

QUnit.test("Leave guard returning false blocks navigation", async function (assert: Assert) {
	const leaveGuard: LeaveGuardFn = () => false;
	router.addLeaveGuard("home", leaveGuard);
	router.initialize();
	await waitForRoute(router, "home");

	await assertBlocked(assert, router, () => router.navTo("protected"), "Leave guard blocked navigation");
});

QUnit.test("Async leave guard returning true allows navigation", async function (assert: Assert) {
	const leaveGuard: LeaveGuardFn = async () => true;
	router.addLeaveGuard("home", leaveGuard);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(getHash(), "protected", "Async leave guard allowed navigation");
});

QUnit.test("Promise-like leave guard returning true allows navigation", async function (assert: Assert) {
	const promiseLike = createPromiseLike(true);
	router.addLeaveGuard("home", () => promiseLike);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(getHash(), "protected", "Promise-like leave guard allowed navigation");
});

QUnit.test("Promise-like leave guard returning false blocks navigation", async function (assert: Assert) {
	const promiseLike = createPromiseLike(false);
	router.addLeaveGuard("home", () => promiseLike);
	router.initialize();
	await waitForRoute(router, "home");
	await assertBlocked(assert, router, () => router.navTo("protected"), "Promise-like leave guard blocked navigation");
});

QUnit.test("Async leave guard returning false blocks navigation", async function (assert: Assert) {
	const leaveGuard: LeaveGuardFn = async () => false;
	router.addLeaveGuard("home", leaveGuard);
	router.initialize();
	await waitForRoute(router, "home");

	await assertBlocked(assert, router, () => router.navTo("protected"), "Async leave guard blocked navigation");
});

QUnit.test("Leave guard only runs when leaving its registered route", async function (assert: Assert) {
	let guardCallCount = 0;
	const leaveGuard: LeaveGuardFn = () => {
		guardCallCount++;
		return true;
	};
	router.addLeaveGuard("protected", leaveGuard);
	router.initialize();
	await waitForRoute(router, "home");

	// Navigate to protected (leave guard is on "protected", not "home")
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(guardCallCount, 0, "Leave guard did not run when entering its route");

	// Navigate away from protected
	router.navTo("home");
	await waitForRoute(router, "home");
	assert.strictEqual(guardCallCount, 1, "Leave guard ran when leaving its route");
});

QUnit.test("Leave guard does not run on initial navigation", async function (assert: Assert) {
	let guardCalls = 0;
	router.addLeaveGuard("home", () => {
		guardCalls++;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");
	assert.strictEqual(guardCalls, 0, "Leave guard did not run on initial navigation");

	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(guardCalls, 1, "It ran when the route was left");
});

QUnit.test("Leave guard does not run during redirects", async function (assert: Assert) {
	let leaveGuardCallCount = 0;
	router.addLeaveGuard("home", () => {
		leaveGuardCallCount++;
		return true;
	});
	// Enter guard on "forbidden" redirects to "home"
	router.addRouteGuard("forbidden", () => "home");
	router.initialize();
	await waitForRoute(router, "home");

	// Navigate to forbidden (enter guard redirects to home)
	// The leave guard on "home" should run once (for leaving home to go to forbidden)
	leaveGuardCallCount = 0;
	router.navTo("forbidden");
	const result = await router.navigationSettled();

	// The redirect from forbidden back to home should NOT trigger
	// the leave guard again because redirect hops use skipLeaveGuards
	assert.strictEqual(result.status, NavigationOutcome.Redirected, "Navigation resulted in redirect");
	assert.strictEqual(leaveGuardCallCount, 1, "Leave guard ran exactly once (for initial leave, not during redirect)");
});

QUnit.test("Multiple leave guards: first false short-circuits", async function (assert: Assert) {
	let secondCalled = false;
	router.addLeaveGuard("home", () => false);
	router.addLeaveGuard("home", () => {
		secondCalled = true;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	await assertBlocked(assert, router, () => router.navTo("protected"), "First leave guard blocked navigation");
	assert.notOk(secondCalled, "Second leave guard was not called");
});

QUnit.test("Leave guards run before enter guards (execution order)", async function (assert: Assert) {
	const order: string[] = [];
	router.addLeaveGuard("home", () => {
		order.push("leave");
		return true;
	});
	router.addRouteGuard("protected", () => {
		order.push("enter");
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.deepEqual(order, ["leave", "enter"], "Leave guard ran before enter guard");
});

QUnit.test("Leave guard blocks, enter guard never runs", async function (assert: Assert) {
	let enterCalled = false;
	router.addLeaveGuard("home", () => false);
	router.addRouteGuard("protected", () => {
		enterCalled = true;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	await assertBlocked(assert, router, () => router.navTo("protected"), "Leave guard blocked navigation");
	assert.notOk(enterCalled, "Enter guard did not run after leave guard blocked");
});

QUnit.test("Leave guard allows, enter guard blocks", async function (assert: Assert) {
	router.addLeaveGuard("home", () => true);
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	await assertBlocked(
		assert,
		router,
		() => router.navTo("protected"),
		"Enter guard blocked after leave guard allowed",
	);
});

QUnit.test("removeLeaveGuard prevents guard from running", async function (assert: Assert) {
	const leaveGuard: LeaveGuardFn = () => false;
	router.addLeaveGuard("home", leaveGuard);
	router.removeLeaveGuard("home", leaveGuard);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(getHash(), "protected", "Navigation allowed after leave guard removed");
});

QUnit.test(
	"Stale async leave guard resolution does not affect a superseding navigation",
	async function (assert: Assert) {
		// Capture each leave guard invocation's resolver so we can control timing
		const resolvers: Array<(value: boolean) => void> = [];
		router.addLeaveGuard(
			"home",
			() =>
				new Promise<boolean>((resolve) => {
					resolvers.push(resolve);
				}),
		);
		router.initialize();
		await waitForRoute(router, "home");

		// Navigate to "protected". Async leave guard is now pending.
		router.navTo("protected");

		// Navigate to "forbidden" instead. This supersedes the first navigation.
		// Both navigations leave "home", so the guard fires twice.
		router.navTo("forbidden");

		// Allow the second (active) navigation to proceed
		assert.strictEqual(resolvers.length, 2, "Both leave guard invocations captured");
		resolvers[1](true);
		await waitForRoute(router, "forbidden");
		assert.strictEqual(getHash(), "forbidden", "Second navigation reached forbidden");

		// Now resolve the first stale guard. It should have no effect.
		resolvers[0](true);
		await flushPromises();

		assert.strictEqual(getHash(), "forbidden", "Stale leave guard did not change the route");
	},
);

QUnit.test("Leave guard receives correct GuardContext", async function (assert: Assert) {
	let capturedContext: GuardContext | null = null;
	router.addLeaveGuard("home", (context: GuardContext) => {
		capturedContext = context;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("detail", { id: "99" });
	await waitForRoute(router, "detail");

	assert.ok(capturedContext !== null, "Guard received context");
	assert.strictEqual(capturedContext!.fromRoute, "home", "fromRoute is correct");
	assert.strictEqual(capturedContext!.fromHash, "", "fromHash is correct");
	assert.strictEqual(capturedContext!.toRoute, "detail", "toRoute is correct");
	assert.strictEqual(capturedContext!.toHash, "detail/99", "toHash is correct");
	assert.ok(capturedContext!.signal instanceof AbortSignal, "signal is an AbortSignal");
});

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

QUnit.test("addRouteGuard with object form registers both enter and leave guards", async function (assert: Assert) {
	const order: string[] = [];
	router.addRouteGuard("home", {
		beforeLeave: () => {
			order.push("leave-home");
			return true;
		},
	});
	router.addRouteGuard("protected", {
		beforeEnter: () => {
			order.push("enter-protected");
			return true;
		},
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.deepEqual(order, ["leave-home", "enter-protected"], "Both guards ran in correct order");
});

QUnit.test("addRouteGuard with object form: both beforeEnter and beforeLeave", async function (assert: Assert) {
	let enterCalled = false;
	let leaveCalled = false;
	router.addRouteGuard("protected", {
		beforeEnter: () => {
			enterCalled = true;
			return true;
		},
		beforeLeave: () => {
			leaveCalled = true;
			return true;
		},
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.ok(enterCalled, "beforeEnter ran when entering");
	assert.notOk(leaveCalled, "beforeLeave did not run when entering");

	router.navTo("home");
	await waitForRoute(router, "home");
	assert.ok(leaveCalled, "beforeLeave ran when leaving");
});

QUnit.test("Async leave guard rejecting produces Error settlement", async function (assert: Assert) {
	const rejectedError = new Error("Async leave guard rejection");
	router.addLeaveGuard("home", () => {
		return Promise.reject(rejectedError);
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Error, "Status is Error");
	assert.strictEqual(result.error, rejectedError, "Error is the rejected value");
});

QUnit.test("addLeaveGuard and removeLeaveGuard return router for chaining", function (assert: Assert) {
	const guard: LeaveGuardFn = () => true;
	const result1 = router.addLeaveGuard("home", guard);
	assert.strictEqual(result1, router, "addLeaveGuard returns router");
	const result2 = router.removeLeaveGuard("home", guard);
	assert.strictEqual(result2, router, "removeLeaveGuard returns router");
});

QUnit.test("removeRouteGuard with object form removes both enter and leave guards", async function (assert: Assert) {
	const config: RouteGuardConfig = {
		beforeEnter: () => false,
		beforeLeave: () => false,
	};
	router.addRouteGuard("protected", config);
	router.removeRouteGuard("protected", config);
	router.initialize();
	await waitForRoute(router, "home");

	// Enter guard was removed: navigation to protected should succeed
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(getHash(), "protected", "Enter guard removed via object form");

	// Leave guard was removed: navigation away from protected should succeed
	router.navTo("home");
	await waitForRoute(router, "home");
	assert.strictEqual(getHash(), "", "Leave guard removed via object form");
});

QUnit.test("removeRouteGuard with object form: partial config (beforeEnter only)", async function (assert: Assert) {
	const enterGuard: GuardFn = () => false;
	const leaveGuard: LeaveGuardFn = () => false;
	router.addRouteGuard("protected", { beforeEnter: enterGuard, beforeLeave: leaveGuard });

	// Remove only the enter guard via object form
	router.removeRouteGuard("protected", { beforeEnter: enterGuard });
	router.initialize();
	await waitForRoute(router, "home");

	// Enter guard removed: navigation to protected should succeed
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(getHash(), "protected", "Enter guard removed, leave guard still active");

	// Leave guard still active: should block
	await assertBlocked(assert, router, () => router.navTo("home"), "Leave guard still blocks after partial remove");
});

QUnit.test("removeRouteGuard with object form returns router for chaining", function (assert: Assert) {
	const config: RouteGuardConfig = {
		beforeEnter: () => true,
		beforeLeave: () => true,
	};
	router.addRouteGuard("home", config);
	const result = router.removeRouteGuard("home", config);
	assert.strictEqual(result, router, "removeRouteGuard with object form returns router");
});

// ============================================================
// Module: Leave guards with unmatched routes (FLP cross-app navigation)
// ============================================================
QUnit.module("Router - Leave guards with unmatched routes", standardHooks);

QUnit.test("Leave guard runs for navigation to an unmatched hash", async function (assert: Assert) {
	assert.expect(3);
	let guardCalled = false;
	router.addLeaveGuard("home", (context: GuardContext) => {
		guardCalled = true;
		assert.strictEqual(context.toRoute, "", "toRoute is empty for unmatched hash");
		assert.strictEqual(context.toHash, "some/unknown/path", "toHash is the raw hash");
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	HashChanger.getInstance().setHash("some/unknown/path");
	await router.navigationSettled();
	assert.ok(guardCalled, "Leave guard was called for unmatched hash navigation");
});

QUnit.test("Leave guard can block navigation to an unmatched hash", async function (assert: Assert) {
	router.addLeaveGuard("home", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	HashChanger.getInstance().setHash("some/unknown/path");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Settlement is blocked");
	assert.strictEqual(getHash(), "", "Hash was restored after leave guard blocked");
});

QUnit.test("Leave guard can allow navigation to an unmatched hash", async function (assert: Assert) {
	let guardCalled = false;
	router.addLeaveGuard("home", () => {
		guardCalled = true;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	HashChanger.getInstance().setHash("some/unknown/path");
	await router.navigationSettled();
	assert.ok(guardCalled, "Leave guard ran");
	assert.strictEqual(getHash(), "some/unknown/path", "Navigation to unmatched hash proceeded");
});

QUnit.test("Guard context has empty toRoute for unmatched hash but valid fromRoute", async function (assert: Assert) {
	let capturedContext: GuardContext | null = null;
	router.addLeaveGuard("protected", (context: GuardContext) => {
		capturedContext = context;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "protected");

	HashChanger.getInstance().setHash("cross-app-intent");
	await router.navigationSettled();

	assert.ok(capturedContext, "Guard context was captured");
	assert.strictEqual(capturedContext!.fromRoute, "protected", "fromRoute is the current route");
	assert.strictEqual(capturedContext!.fromHash, "protected", "fromHash is the current hash");
	assert.strictEqual(capturedContext!.toRoute, "", "toRoute is empty for unmatched hash");
	assert.strictEqual(capturedContext!.toHash, "cross-app-intent", "toHash is the raw intent hash");
});

// ============================================================
// Module: Settlement for leave guard scenarios
// ============================================================
QUnit.module("Router - Settlement for leave guard scenarios", standardHooks);

QUnit.test("Leave guard block settlement includes correct route and hash", async function (assert: Assert) {
	router.addLeaveGuard("home", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Status is blocked");
	assert.strictEqual(result.route, "home", "Route stayed on home");
	assert.strictEqual(result.hash, "", "Hash stayed empty");
	assert.strictEqual(getHash(), "", "Browser hash was restored");
});

QUnit.test("Leave guard allows then enter guard blocks: settlement is blocked", async function (assert: Assert) {
	router.addLeaveGuard("home", () => true);
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Leave allowed + enter blocked = blocked");
	assert.strictEqual(result.route, "home", "Route stayed on home");
});

QUnit.test(
	"Async leave guard allows then async enter guard redirects: settlement is redirected",
	async function (assert: Assert) {
		router.addLeaveGuard("home", async () => true);
		router.addRouteGuard("protected", async () => "forbidden");
		router.initialize();
		await waitForRoute(router, "home");

		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Redirected, "Leave allowed + enter redirect = redirected");
		assert.strictEqual(result.route, "forbidden", "Route is redirect target");
	},
);
