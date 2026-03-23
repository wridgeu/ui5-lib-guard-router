import sinon from "sinon";
import Log from "sap/base/Log";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type {
	GuardContext,
	GuardFn,
	GuardRedirect,
	GuardRouter,
	LeaveGuardFn,
	RouteGuardConfig,
} from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { Route$PatternMatchedEvent } from "sap/ui/core/routing/Route";
import {
	addGuardUnsafe,
	addLeaveGuardUnsafe,
	addRouteGuardUnsafe,
	assertBlocked,
	createRouter,
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
// Module: Guard allows navigation
// ============================================================
QUnit.module("Router - Guard allows navigation", standardHooks);

QUnit.test("Guard returning true allows navigation", async function (assert: Assert) {
	router.addGuard(() => true);
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(HashChanger.getInstance().getHash(), "protected", "Guard allowed navigation to protected");
});

QUnit.test("Async guard returning true allows navigation", async function (assert: Assert) {
	router.addGuard(async () => {
		await nextTick(10);
		return true;
	});
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(HashChanger.getInstance().getHash(), "protected", "Async guard allowed navigation");
});

QUnit.test("Promise-like guard returning true allows navigation", async function (assert: Assert) {
	const promiseLike: PromiseLike<boolean> = {
		// oxlint-disable-next-line unicorn/no-thenable
		then(onfulfilled, onrejected) {
			return Promise.resolve(true).then(onfulfilled, onrejected);
		},
	};
	router.addGuard(() => promiseLike);
	router.initialize();
	await waitForRoute(router, "home");
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(HashChanger.getInstance().getHash(), "protected", "Promise-like guard allowed navigation");
});

QUnit.test("Promise-like guard returning false blocks navigation", async function (assert: Assert) {
	const promiseLike: PromiseLike<boolean> = {
		// oxlint-disable-next-line unicorn/no-thenable
		then(onfulfilled, onrejected) {
			return Promise.resolve(false).then(onfulfilled, onrejected);
		},
	};
	router.initialize();
	await waitForRoute(router, "home");
	router.addGuard(() => promiseLike);
	await assertBlocked(assert, router, () => router.navTo("protected"), "Promise-like guard blocked navigation");
});

QUnit.test("Route-specific guard returning true allows navigation", async function (assert: Assert) {
	router.addRouteGuard("protected", () => true);
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(HashChanger.getInstance().getHash(), "protected", "Route guard allowed navigation");
});

// ============================================================
// Module: Guard blocks navigation
// ============================================================
QUnit.module("Router - Guard blocks navigation", standardHooks);

QUnit.test("Guard returning false blocks navigation", async function (assert: Assert) {
	router.addGuard(() => false);
	router.initialize();
	await assertBlocked(assert, router, () => router.navTo("protected"), "Navigation was blocked");
});

QUnit.test("Async guard returning false blocks navigation", async function (assert: Assert) {
	router.addGuard(async () => {
		await nextTick(10);
		return false;
	});
	router.initialize();
	await assertBlocked(assert, router, () => router.navTo("protected"), "Async guard blocked navigation");
});

QUnit.test("Route-specific guard returning false blocks navigation", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await assertBlocked(assert, router, () => router.navTo("protected"), "Route guard blocked navigation");
});

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

QUnit.test("Guard returning rejected Promise produces Error settlement", async function (assert: Assert) {
	const rejectedError = new Error("Rejected");
	router.addGuard(() => Promise.reject(rejectedError));
	router.initialize();
	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Error, "Status is Error");
	assert.strictEqual(result.error, rejectedError, "Error is the rejected value");
});

// ============================================================
// Module: Guard redirects
// ============================================================
QUnit.module("Router - Guard redirects", standardHooks);

QUnit.test("Guard returning string redirects to named route", async function (assert: Assert) {
	router.addRouteGuard("forbidden", () => "home");
	router.initialize();
	await waitForRoute(router, "home"); // init settles on home

	router.navTo("forbidden");
	await waitForRoute(router, "home");
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Redirected to home route");
});

QUnit.test("Async guard returning string redirects", async function (assert: Assert) {
	router.addRouteGuard("forbidden", async () => {
		await nextTick(10);
		return "home";
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("forbidden");
	await waitForRoute(router, "home");
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Async guard redirected to home");
});

// ============================================================
// Module: Guard context
// ============================================================
QUnit.module("Router - Guard context", standardHooks);

QUnit.test("Guard receives correct context", async function (assert: Assert) {
	let capturedContext: GuardContext | null = null;
	router.addGuard((context: GuardContext) => {
		capturedContext = context;
		return true;
	});
	router.initialize();
	router.navTo("detail", { id: "99" });
	await waitForRoute(router, "detail");

	assert.ok(capturedContext, "Context was captured");
	assert.strictEqual(capturedContext!.toRoute, "detail", "toRoute is correct");
	assert.strictEqual(capturedContext!.toHash, "detail/99", "toHash is correct");
	assert.deepEqual(capturedContext!.toArguments, { id: "99" }, "toArguments is correct");
});

// ============================================================
// Module: Guard execution order
// ============================================================
QUnit.module("Router - Guard execution order", standardHooks);

QUnit.test("Multiple global guards run sequentially, first rejection wins", async function (assert: Assert) {
	const order: number[] = [];
	router.initialize();
	await waitForRoute(router, "home");

	router.addGuard(() => {
		order.push(1);
		return true;
	});
	router.addGuard(() => {
		order.push(2);
		return false;
	});
	router.addGuard(() => {
		order.push(3);
		return true;
	});

	router.navTo("protected");
	await router.navigationSettled();
	assert.deepEqual(order, [1, 2], "Guards ran sequentially and stopped at first rejection");
});

QUnit.test("Global guards run before route-specific guards", async function (assert: Assert) {
	const order: string[] = [];
	router.addGuard(() => {
		order.push("global");
		return true;
	});
	router.addRouteGuard("protected", () => {
		order.push("route");
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	order.length = 0;
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.deepEqual(order, ["global", "route"], "Global guard ran before route guard");
});

QUnit.test("Route guard only runs for its route", async function (assert: Assert) {
	let protectedGuardCalled = false;
	router.addRouteGuard("protected", () => {
		protectedGuardCalled = true;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");
	assert.notOk(protectedGuardCalled, "Protected route guard did not run for home route");
});

QUnit.test("No guards behaves identically to native router", async function (assert: Assert) {
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(HashChanger.getInstance().getHash(), "protected", "Navigation works without any guards");
});

// ============================================================
// Module: Guard with invalid return values
// ============================================================
QUnit.module("Router - Guard invalid values", standardHooks);

QUnit.test("Guard returning invalid value treats as block", async function (assert: Assert) {
	addGuardUnsafe(router, () => 42);
	router.initialize();
	await assertBlocked(assert, router, () => router.navTo("protected"), "Invalid guard return treated as block");
});

QUnit.test("Guard returning invalid redirect object treats as block", async function (assert: Assert) {
	addRouteGuardUnsafe(router, "protected", () => ({ route: "" }));
	router.initialize();
	await waitForRoute(router, "home");
	await assertBlocked(assert, router, () => router.navTo("protected"), "Invalid redirect object treated as block");
});

// ============================================================
// Module: Leave guard invalid return values
// ============================================================
QUnit.module("Router - Leave guard invalid values", standardHooks);

QUnit.test("Leave guard returning non-boolean value treats as block", async function (assert: Assert) {
	addLeaveGuardUnsafe(router, "home", () => 42);
	router.initialize();
	await waitForRoute(router, "home");
	await assertBlocked(
		assert,
		router,
		() => router.navTo("protected"),
		"Non-boolean leave guard return treated as block",
	);
});

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

QUnit.test("Leave guard returning false blocks without warning", async function (assert: Assert) {
	const warningSpy = sinon.spy(Log, "warning");
	try {
		router.addLeaveGuard("home", () => false);
		router.initialize();
		await waitForRoute(router, "home");
		await assertBlocked(assert, router, () => router.navTo("protected"), "False leave guard blocks navigation");
		const leaveGuardWarnings = warningSpy
			.getCalls()
			.filter((call) => String(call.args[0]).includes("Leave guard returned non-boolean"));
		assert.strictEqual(leaveGuardWarnings.length, 0, "No non-boolean warning for a legitimate false return");
	} finally {
		warningSpy.restore();
	}
});

QUnit.test("Leave guard returning non-boolean logs a warning", async function (assert: Assert) {
	const warningSpy = sinon.spy(Log, "warning");
	try {
		addLeaveGuardUnsafe(router, "home", () => 42);
		router.initialize();
		await waitForRoute(router, "home");
		await assertBlocked(assert, router, () => router.navTo("protected"), "Non-boolean leave guard blocks");
		const leaveGuardWarnings = warningSpy
			.getCalls()
			.filter((call) => String(call.args[0]).includes("Leave guard returned non-boolean"));
		assert.strictEqual(leaveGuardWarnings.length, 1, "Warning logged for non-boolean leave guard return");
	} finally {
		warningSpy.restore();
	}
});

// ============================================================
// Module: GuardRedirect object
// ============================================================
QUnit.module("Router - GuardRedirect object", standardHooks);

QUnit.test("Guard returning GuardRedirect object redirects to route", async function (assert: Assert) {
	router.addRouteGuard("forbidden", (): GuardRedirect => ({ route: "home" }));
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("forbidden");
	await waitForRoute(router, "home");
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Redirected to home via GuardRedirect");
});

QUnit.test("Guard returning GuardRedirect with parameters redirects correctly", async function (assert: Assert) {
	let matchedArgs: Record<string, string> = {};
	router.getRoute("detail")!.attachPatternMatched((event: Route$PatternMatchedEvent) => {
		matchedArgs = event.getParameter("arguments") as Record<string, string>;
	});
	router.addRouteGuard(
		"forbidden",
		(): GuardRedirect => ({
			route: "detail",
			parameters: { id: "error-403" },
		}),
	);
	router.initialize();
	router.navTo("forbidden");
	await waitForRoute(router, "detail");
	assert.strictEqual(HashChanger.getInstance().getHash(), "detail/error-403", "Redirect landed with correct params");
	assert.strictEqual(matchedArgs.id, "error-403", "Redirect parameters propagated to matched event");
});

QUnit.test("Async guard returning GuardRedirect works", async function (assert: Assert) {
	router.addRouteGuard("protected", async (): Promise<GuardRedirect> => {
		await nextTick(10);
		return { route: "home" };
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "home");
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Async GuardRedirect redirected to home");
});

// ============================================================
// Module: Initial navigation recovery
// ============================================================
QUnit.module("Router - Initial navigation recovery", standardHooks);

QUnit.test("Blocked initial navigation falls back to the default hash", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	HashChanger.getInstance().setHash("protected");
	router.initialize();
	await waitForRoute(router, "home");
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Blocked initial navigation restored the default hash");
});

QUnit.test("Blocked default route on initial navigation stays blocked", async function (assert: Assert) {
	router.addRouteGuard("home", () => false);
	await assertBlocked(assert, router, () => router.initialize(), "Blocked default route did not match");
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Hash stays on the default target");
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
	assert.strictEqual(HashChanger.getInstance().getHash(), "protected", "Navigation allowed by leave guard");
});

QUnit.test("Leave guard returning false blocks navigation", async function (assert: Assert) {
	const leaveGuard: LeaveGuardFn = () => false;
	router.addLeaveGuard("home", leaveGuard);
	router.initialize();
	await waitForRoute(router, "home");

	await assertBlocked(assert, router, () => router.navTo("protected"), "Leave guard blocked navigation");
});

QUnit.test("Async leave guard returning true allows navigation", async function (assert: Assert) {
	const leaveGuard: LeaveGuardFn = async () => {
		await nextTick(10);
		return true;
	};
	router.addLeaveGuard("home", leaveGuard);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(HashChanger.getInstance().getHash(), "protected", "Async leave guard allowed navigation");
});

QUnit.test("Promise-like leave guard returning true allows navigation", async function (assert: Assert) {
	const promiseLike: PromiseLike<boolean> = {
		// oxlint-disable-next-line unicorn/no-thenable
		then(onfulfilled, onrejected) {
			return Promise.resolve(true).then(onfulfilled, onrejected);
		},
	};
	router.addLeaveGuard("home", () => promiseLike);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(HashChanger.getInstance().getHash(), "protected", "Promise-like leave guard allowed navigation");
});

QUnit.test("Promise-like leave guard returning false blocks navigation", async function (assert: Assert) {
	const promiseLike: PromiseLike<boolean> = {
		// oxlint-disable-next-line unicorn/no-thenable
		then(onfulfilled, onrejected) {
			return Promise.resolve(false).then(onfulfilled, onrejected);
		},
	};
	router.addLeaveGuard("home", () => promiseLike);
	router.initialize();
	await waitForRoute(router, "home");
	await assertBlocked(assert, router, () => router.navTo("protected"), "Promise-like leave guard blocked navigation");
});

QUnit.test("Async leave guard returning false blocks navigation", async function (assert: Assert) {
	const leaveGuard: LeaveGuardFn = async () => {
		await nextTick(10);
		return false;
	};
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
	let guardCalled = false;
	router.addLeaveGuard("home", () => {
		guardCalled = true;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");
	assert.notOk(guardCalled, "Leave guard did not run on initial navigation");
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
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"protected",
		"Navigation allowed after leave guard removed",
	);
});

QUnit.test("destroy() clears leave guards", async function (assert: Assert) {
	router.addLeaveGuard("home", () => false);
	router.initialize();
	await waitForRoute(router, "home");
	router.destroy();

	router = createRouter();
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(HashChanger.getInstance().getHash(), "protected", "No leave guard after destroy and re-create");
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
		await nextTick(10);

		// Navigate to "forbidden" instead. This supersedes the first navigation.
		// Both navigations leave "home", so the guard fires twice.
		router.navTo("forbidden");
		await nextTick(10);

		// Allow the second (active) navigation to proceed
		assert.strictEqual(resolvers.length, 2, "Both leave guard invocations captured");
		resolvers[1](true);
		await waitForRoute(router, "forbidden");
		assert.strictEqual(HashChanger.getInstance().getHash(), "forbidden", "Second navigation reached forbidden");

		// Now resolve the first stale guard. It should have no effect.
		resolvers[0](true);
		await nextTick(100);

		assert.strictEqual(
			HashChanger.getInstance().getHash(),
			"forbidden",
			"Stale leave guard did not change the route",
		);
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
	assert.strictEqual(HashChanger.getInstance().getHash(), "protected", "Enter guard removed via object form");

	// Leave guard was removed: navigation away from protected should succeed
	router.navTo("home");
	await waitForRoute(router, "home");
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Leave guard removed via object form");
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
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"protected",
		"Enter guard removed, leave guard still active",
	);

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
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Hash was restored after leave guard blocked");
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
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"some/unknown/path",
		"Navigation to unmatched hash proceeded",
	);
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
