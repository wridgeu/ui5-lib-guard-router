import DataType from "sap/ui/base/DataType";
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
import type { Router$RouteMatchedEvent } from "sap/ui/core/routing/Router";
import type { Route$PatternMatchedEvent } from "sap/ui/core/routing/Route";
import {
	addGuardUnsafe,
	addLeaveGuardUnsafe,
	addRouteGuardUnsafe,
	assertBlocked,
	GuardRouterClass,
	initHashChanger,
	nextTick,
	removeGuardUnsafe,
	removeLeaveGuardUnsafe,
	removeRouteGuardUnsafe,
	waitForRoute,
} from "./testHelpers";

function createRouter(): GuardRouter {
	return new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
			{ name: "forbidden", pattern: "forbidden" },
			{ name: "detail", pattern: "detail/{id}" },
		],
		{
			async: true,
		},
	);
}

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

const safeDestroyHooks = {
	beforeEach: standardHooks.beforeEach,
	afterEach: function () {
		try {
			router.destroy();
		} catch {
			/* already destroyed */
		}
		HashChanger.getInstance().setHash("");
	},
};

// ============================================================
// Module: Library integration
// ============================================================
QUnit.module("Router - Library integration");

QUnit.test("NavigationOutcome is registered as a UI5 enum", function (assert: Assert) {
	const type = DataType.getType("ui5.guard.router.NavigationOutcome");

	assert.ok(type, "Enum type is discoverable via DataType.getType()");
	assert.strictEqual(type?.isValid(NavigationOutcome.Committed), true, "Known enum values are accepted");
	assert.strictEqual(type?.isValid("pending"), false, "Unknown enum values are rejected");
});

// ============================================================
// Module: Drop-in replacement (no guards)
// ============================================================
QUnit.module("Router - Drop-in replacement (no guards)", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
		router.initialize();
	},
	afterEach: standardHooks.afterEach,
});

QUnit.test("Router is an instance of sap.m.routing.Router", function (assert: Assert) {
	assert.ok(router.isA("sap.m.routing.Router"), "Router extends sap.m.routing.Router");
});

QUnit.test("Router has its own UI5 class identity", function (assert: Assert) {
	assert.ok(router.isA("ui5.guard.router.Router"), "isA() recognises the guard router class");
	assert.strictEqual(
		router.getMetadata().getName(),
		"ui5.guard.router.Router",
		"getMetadata().getName() returns the fully qualified class name",
	);
});

QUnit.test("navTo navigates to named route", async function (assert: Assert) {
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(HashChanger.getInstance().getHash(), "protected", "Hash updated to protected");
});

QUnit.test("navTo with parameters", async function (assert: Assert) {
	let matchedArgs: Record<string, string> = {};
	router.getRoute("detail")!.attachPatternMatched((event: Route$PatternMatchedEvent) => {
		matchedArgs = event.getParameter("arguments") as Record<string, string>;
	});
	router.navTo("detail", { id: "42" });
	await waitForRoute(router, "detail");
	assert.strictEqual(HashChanger.getInstance().getHash(), "detail/42", "Hash contains route parameter");
	assert.strictEqual(matchedArgs.id, "42", "Route argument propagated to matched event");
});

QUnit.test("routeMatched event fires", async function (assert: Assert) {
	let firedForProtected = false;
	router.attachRouteMatched((event: Router$RouteMatchedEvent) => {
		if (event.getParameter("name") === "protected") {
			firedForProtected = true;
		}
	});
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.ok(firedForProtected, "routeMatched fired for protected route");
});

QUnit.test("beforeRouteMatched event fires", async function (assert: Assert) {
	let fired = false;
	router.attachBeforeRouteMatched(() => {
		fired = true;
	});
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.ok(fired, "beforeRouteMatched fired");
});

QUnit.test("getRoute returns route by name", function (assert: Assert) {
	assert.ok(router.getRoute("home"), "getRoute returns the home route");
});

QUnit.test("getRoute returns undefined for unknown route", function (assert: Assert) {
	assert.notOk(router.getRoute("nonexistent"), "getRoute returns undefined for unknown route");
});

// ============================================================
// Module: Guard API
// ============================================================
QUnit.module("Router - Guard API", safeDestroyHooks);

QUnit.test("addGuard / removeGuard affect navigation behavior", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	const guard: GuardFn = () => false;
	router.addGuard(guard);

	// Guard is active: navigation should be blocked
	await assertBlocked(assert, router, () => router.navTo("protected"), "Guard blocks after addGuard");

	router.removeGuard(guard);

	// Guard removed: navigation should succeed
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(HashChanger.getInstance().getHash(), "protected", "Navigation allowed after removeGuard");
});

QUnit.test("addRouteGuard / removeRouteGuard affect navigation behavior", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	const guard: GuardFn = () => false;
	router.addRouteGuard("protected", guard);

	// Route guard is active: navigation should be blocked
	await assertBlocked(assert, router, () => router.navTo("protected"), "Route guard blocks after addRouteGuard");

	router.removeRouteGuard("protected", guard);

	// Route guard removed: navigation should succeed
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(HashChanger.getInstance().getHash(), "protected", "Navigation allowed after removeRouteGuard");
});

QUnit.test("addGuard returns this for chaining", function (assert: Assert) {
	assert.strictEqual(
		router.addGuard(() => true),
		router,
		"addGuard returns this",
	);
});

QUnit.test("addRouteGuard returns this for chaining", function (assert: Assert) {
	assert.strictEqual(
		router.addRouteGuard("home", () => true),
		router,
		"addRouteGuard returns this",
	);
});

QUnit.test("addRouteGuard ignores invalid runtime guard input", async function (assert: Assert) {
	addRouteGuardUnsafe(router, "protected", null);
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(HashChanger.getInstance().getHash(), "protected", "Invalid runtime guard input was ignored");
});

QUnit.test("addRouteGuard object form ignores invalid leave guard input", async function (assert: Assert) {
	addRouteGuardUnsafe(router, "protected", {
		beforeLeave: "nope",
	});
	router.initialize();
	await waitForRoute(router, "home");
	router.navTo("protected");
	await waitForRoute(router, "protected");
	router.navTo("home");
	await waitForRoute(router, "home");
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Invalid leave guard input was ignored");
});

QUnit.test("destroy cleans up guards so they no longer run", async function (assert: Assert) {
	let guardCalled = false;
	router.addGuard(() => {
		guardCalled = true;
		return false;
	});
	router.addRouteGuard("protected", () => {
		guardCalled = true;
		return false;
	});
	router.destroy();

	// Re-create and verify guards are gone
	router = createRouter();
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.notOk(guardCalled, "Guards from destroyed router instance were not called");
});

QUnit.test("addGuard ignores non-function input", async function (assert: Assert) {
	addGuardUnsafe(router, null);
	addGuardUnsafe(router, 42);
	addGuardUnsafe(router, "not a function");
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"protected",
		"Non-function inputs to addGuard were ignored",
	);
});

QUnit.test("removeGuard ignores non-function input", async function (assert: Assert) {
	// Register a real blocking guard, then try to remove it with invalid input
	const guard: GuardFn = () => false;
	router.addGuard(guard);
	removeGuardUnsafe(router, null);
	removeGuardUnsafe(router, "not a function");
	router.initialize();
	// Guard should still be active because invalid removes were no-ops
	await assertBlocked(
		assert,
		router,
		() => router.navTo("protected"),
		"Guard still blocks after invalid removeGuard calls",
	);
});

QUnit.test("removeGuard for a never-added guard is a no-op", async function (assert: Assert) {
	const neverAdded: GuardFn = () => false;
	router.removeGuard(neverAdded);
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"protected",
		"Removing a never-added guard did not break anything",
	);
});

QUnit.test("addLeaveGuard ignores non-function input", async function (assert: Assert) {
	addLeaveGuardUnsafe(router, "home", null);
	addLeaveGuardUnsafe(router, "home", 42);
	router.initialize();
	await waitForRoute(router, "home");
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"protected",
		"Non-function inputs to addLeaveGuard were ignored",
	);
});

QUnit.test("removeLeaveGuard ignores non-function input", async function (assert: Assert) {
	// Register a blocking leave guard, then try to remove with invalid input
	router.addLeaveGuard("home", () => false);
	removeLeaveGuardUnsafe(router, "home", null);
	removeLeaveGuardUnsafe(router, "home", "not a function");
	router.initialize();
	await waitForRoute(router, "home");
	await assertBlocked(
		assert,
		router,
		() => router.navTo("protected"),
		"Leave guard still blocks after invalid removeLeaveGuard calls",
	);
});

QUnit.test("removeLeaveGuard for a never-added guard is a no-op", async function (assert: Assert) {
	const neverAdded: LeaveGuardFn = () => false;
	router.removeLeaveGuard("home", neverAdded);
	router.initialize();
	await waitForRoute(router, "home");
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"protected",
		"Removing a never-added leave guard did not break anything",
	);
});

QUnit.test("removeRouteGuard ignores non-function input", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	removeRouteGuardUnsafe(router, "protected", null);
	removeRouteGuardUnsafe(router, "protected", "not a function");
	router.initialize();
	await assertBlocked(
		assert,
		router,
		() => router.navTo("protected"),
		"Route guard still blocks after invalid removeRouteGuard calls",
	);
});

QUnit.test("removeRouteGuard for a never-added guard is a no-op", async function (assert: Assert) {
	const neverAdded: GuardFn = () => false;
	router.removeRouteGuard("protected", neverAdded);
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"protected",
		"Removing a never-added route guard did not break anything",
	);
});

QUnit.test("addRouteGuard with empty config object is a no-op", async function (assert: Assert) {
	addRouteGuardUnsafe(router, "protected", {});
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(HashChanger.getInstance().getHash(), "protected", "Empty config object registered no guards");
});

QUnit.test(
	"addRouteGuard object form with only beforeEnter registers enter guard only",
	async function (assert: Assert) {
		let enterCalled = false;
		router.addRouteGuard("protected", {
			beforeEnter: () => {
				enterCalled = true;
				return true;
			},
		});
		router.initialize();
		await waitForRoute(router, "home");

		router.navTo("protected");
		await waitForRoute(router, "protected");
		assert.ok(enterCalled, "beforeEnter ran");

		// Navigate away: no leave guard should block
		router.navTo("home");
		await waitForRoute(router, "home");
		assert.strictEqual(
			HashChanger.getInstance().getHash(),
			"",
			"No leave guard registered, navigation away succeeded",
		);
	},
);

QUnit.test(
	"addRouteGuard object form with only beforeLeave registers leave guard only",
	async function (assert: Assert) {
		let leaveCalled = false;
		router.addRouteGuard("home", {
			beforeLeave: () => {
				leaveCalled = true;
				return true;
			},
		});
		router.initialize();
		await waitForRoute(router, "home");

		// No enter guard on "home", so navigate to protected and back without issue
		router.navTo("protected");
		await waitForRoute(router, "protected");
		assert.ok(leaveCalled, "beforeLeave ran when leaving home");
	},
);

// ============================================================
// Module: Router lifecycle
// ============================================================
QUnit.module("Router - Lifecycle", standardHooks);

QUnit.test("Guards still work after stop and re-initialize", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	// Guard blocks before stop
	await assertBlocked(assert, router, () => router.navTo("protected"), "Guard blocks before stop");

	// Stop and re-initialize
	router.stop();
	assert.notOk(router.isInitialized(), "Router stopped");
	router.initialize();
	assert.ok(router.isInitialized(), "Router re-initialized");

	// Guard should still block after restart
	await assertBlocked(
		assert,
		router,
		() => router.navTo("protected"),
		"Guard still blocks after stop and re-initialize",
	);
});

QUnit.test("Double initialize is safe and guards still work", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	router.initialize(); // second call should be a no-op
	await waitForRoute(router, "home");

	await assertBlocked(assert, router, () => router.navTo("protected"), "Guard blocks after double initialize");
});

QUnit.test("Re-initialize after stop fires routeMatched like native router", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	router.stop();
	assert.notOk(router.isInitialized(), "Router stopped");

	router.initialize();
	assert.ok(router.isInitialized(), "Router re-initialized");

	// Native router fires routeMatched on re-init; guard router must match.
	await waitForRoute(router, "home");
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"",
		"Re-initialize fires routeMatched for current hash (native parity)",
	);
});

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

QUnit.test("Guard throwing an error blocks navigation", async function (assert: Assert) {
	router.addGuard(() => {
		throw new Error("Guard error");
	});
	router.initialize();
	await assertBlocked(assert, router, () => router.navTo("protected"), "Navigation blocked on guard error");
});

QUnit.test("Guard returning rejected Promise blocks navigation", async function (assert: Assert) {
	router.addGuard(() => Promise.reject(new Error("Rejected")));
	router.initialize();
	await assertBlocked(assert, router, () => router.navTo("protected"), "Navigation blocked on rejected promise");
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
	await nextTick(500);
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
	await nextTick(500);
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
	await nextTick(500);

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
	await nextTick(500);
	assert.strictEqual(guardCallCount, 1, "Guard only called once (no infinite loop)");
});

QUnit.test("Multiple route guards with cross-redirects settle correctly", async function (assert: Assert) {
	// forbidden → redirects to protected, protected → redirects to home
	// But redirect is re-entrant (_redirecting=true) so it bypasses guards.
	// We should end up on protected, not home.
	router.addRouteGuard("forbidden", () => "protected");
	router.addRouteGuard("protected", () => "home");
	router.initialize();

	router.navTo("forbidden");
	await waitForRoute(router, "protected");
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"protected",
		"Cross-redirect settled on protected (re-entrant bypass)",
	);
});

// ============================================================
// Module: Mixed sync/async guard pipelines
// ============================================================
QUnit.module("Router - Mixed sync/async guard pipelines", standardHooks);

QUnit.test("Sync global guard allows, async route guard allows", async function (assert: Assert) {
	router.addGuard(() => true);
	router.addRouteGuard("protected", async () => {
		await nextTick(10);
		return true;
	});
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"protected",
		"Navigation allowed through sync global + async route guard",
	);
});

QUnit.test("Sync global guard allows, async route guard blocks", async function (assert: Assert) {
	router.addGuard(() => true);
	router.addRouteGuard("protected", async () => {
		await nextTick(10);
		return false;
	});
	router.initialize();
	await assertBlocked(
		assert,
		router,
		() => router.navTo("protected"),
		"Async route guard blocked after sync global allowed",
	);
});

QUnit.test("Async global guard allows, sync route guard allows", async function (assert: Assert) {
	router.addGuard(async () => {
		await nextTick(10);
		return true;
	});
	router.addRouteGuard("protected", () => true);
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"protected",
		"Navigation allowed through async global + sync route guard",
	);
});

QUnit.test("Async global guard allows, sync route guard blocks", async function (assert: Assert) {
	router.addGuard(async () => {
		await nextTick(10);
		return true;
	});
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await assertBlocked(
		assert,
		router,
		() => router.navTo("protected"),
		"Sync route guard blocked after async global allowed",
	);
});

QUnit.test("Async global guard allows, sync route guard redirects", async function (assert: Assert) {
	router.addGuard(async () => {
		await nextTick(10);
		return true;
	});
	router.addRouteGuard("forbidden", () => "home");
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("forbidden");
	await waitForRoute(router, "home");
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"",
		"Sync route guard redirected after async global allowed",
	);
});

// ============================================================
// Module: Overlapping async navigations
// ============================================================
QUnit.module("Router - Overlapping async navigations", standardHooks);

QUnit.test("Slower first navigation is superseded by faster second navigation", async function (assert: Assert) {
	router.addRouteGuard("protected", async () => {
		await nextTick(200);
		return true;
	});
	router.addRouteGuard("detail", async () => {
		await nextTick(10);
		return true;
	});
	router.initialize();

	let protectedMatched = false;
	router.getRoute("protected")!.attachPatternMatched(() => {
		protectedMatched = true;
	});

	router.navTo("protected");
	router.navTo("detail", { id: "1" });

	await nextTick(500);
	assert.notOk(protectedMatched, "Slow first navigation was superseded");
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"detail/1",
		"Hash reflects the second (winning) navigation",
	);
});

QUnit.test("Superseded async guard result does not apply", async function (assert: Assert) {
	const slowGuard: GuardFn = async () => {
		await nextTick(200);
		return "forbidden"; // This redirect should be discarded
	};
	router.addGuard(slowGuard);
	router.initialize();

	// First navigation triggers slow guard
	router.navTo("protected");

	// Remove guard and navigate again before first resolves
	await nextTick(50);
	router.removeGuard(slowGuard);
	router.navTo("detail", { id: "2" });

	await nextTick(500);
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"detail/2",
		"Second navigation won, redirect from first was discarded",
	);
});

// ============================================================
// Module: Guard context across navigations
// ============================================================
QUnit.module("Router - Guard context across navigations", standardHooks);

QUnit.test("Guard context has correct fromRoute and fromHash after prior navigation", async function (assert: Assert) {
	let capturedContext: GuardContext | null = null;
	router.initialize();

	// Navigate to detail/42 first (no guards)
	router.navTo("detail", { id: "42" });
	await waitForRoute(router, "detail");

	// Now add a guard that captures context
	router.addGuard((context: GuardContext) => {
		capturedContext = context;
		return true;
	});
	router.navTo("protected");
	await waitForRoute(router, "protected");

	assert.ok(capturedContext, "Context was captured");
	assert.strictEqual(capturedContext!.fromRoute, "detail", "fromRoute is correct");
	assert.strictEqual(capturedContext!.fromHash, "detail/42", "fromHash is correct");
	assert.strictEqual(capturedContext!.toRoute, "protected", "toRoute is correct");
	assert.strictEqual(capturedContext!.toHash, "protected", "toHash is correct");
});

QUnit.test("Guard context fromRoute/fromHash are empty on initial navigation", async function (assert: Assert) {
	let capturedContext: GuardContext | null = null;
	router.addGuard((context: GuardContext) => {
		capturedContext = context;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	assert.ok(capturedContext, "Context was captured on init");
	assert.strictEqual(capturedContext!.fromRoute, "", "fromRoute is empty on initial nav");
	assert.strictEqual(capturedContext!.fromHash, "", "fromHash is empty on initial nav");
});

// ============================================================
// Module: Async guard edge cases
// ============================================================
QUnit.module("Router - Async guard edge cases", standardHooks);

QUnit.test("Async route-specific guard throwing error blocks navigation", async function (assert: Assert) {
	router.addRouteGuard("protected", async () => {
		await nextTick(10);
		throw new Error("Async route guard error");
	});
	router.initialize();
	await assertBlocked(assert, router, () => router.navTo("protected"), "Async route guard error blocked navigation");
});

QUnit.test("Async route-specific guard returning rejected promise blocks navigation", async function (assert: Assert) {
	router.addRouteGuard("protected", () => Promise.reject(new Error("Route guard rejected")));
	router.initialize();
	await assertBlocked(
		assert,
		router,
		() => router.navTo("protected"),
		"Rejected route guard promise blocked navigation",
	);
});

QUnit.test("Multiple async guards - first rejection short-circuits remaining", async function (assert: Assert) {
	const order: number[] = [];
	router.initialize();
	await waitForRoute(router, "home");

	router.addGuard(async () => {
		await nextTick(10);
		order.push(1);
		return true;
	});
	router.addGuard(async () => {
		await nextTick(10);
		order.push(2);
		return false;
	});
	router.addGuard(async () => {
		await nextTick(10);
		order.push(3);
		return true;
	});

	router.navTo("protected");
	await nextTick(500);
	assert.deepEqual(order, [1, 2], "Third guard was short-circuited after second rejected");
});

QUnit.test("Async route guard redirects", async function (assert: Assert) {
	router.addRouteGuard("protected", async () => {
		await nextTick(10);
		return "home";
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "home");
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Async route guard redirected to home");
});

QUnit.test("Guard returning null is treated as block", async function (assert: Assert) {
	addGuardUnsafe(router, () => null);
	router.initialize();
	await assertBlocked(assert, router, () => router.navTo("protected"), "Null guard return treated as block");
});

QUnit.test("Guard returning undefined is treated as block", async function (assert: Assert) {
	addGuardUnsafe(router, () => undefined);
	router.initialize();
	await assertBlocked(assert, router, () => router.navTo("protected"), "Undefined guard return treated as block");
});

QUnit.test("Async guard returning invalid value treats as block", async function (assert: Assert) {
	addGuardUnsafe(router, async () => {
		await nextTick(10);
		return 42;
	});
	router.initialize();
	await assertBlocked(assert, router, () => router.navTo("protected"), "Async invalid guard return treated as block");
});

QUnit.test("Async guard returning invalid redirect object treats as block", async function (assert: Assert) {
	addGuardUnsafe(router, async () => {
		await nextTick(10);
		return { route: "" };
	});
	router.initialize();
	await assertBlocked(
		assert,
		router,
		() => router.navTo("protected"),
		"Async invalid redirect object treated as block",
	);
});

// ============================================================
// Module: Rapid sequential navigations
// ============================================================
QUnit.module("Router - Rapid sequential navigations", standardHooks);

QUnit.test("Rapid sync navigations - last one wins", async function (assert: Assert) {
	const matchedRoutes: string[] = [];
	router.addGuard(() => true);
	router.initialize();
	await waitForRoute(router, "home");

	router.attachRouteMatched((event: Router$RouteMatchedEvent) => {
		matchedRoutes.push(event.getParameter("name")!);
	});

	router.navTo("protected");
	router.navTo("forbidden");
	router.navTo("detail", { id: "1" });

	await nextTick(500);
	const lastMatched = matchedRoutes[matchedRoutes.length - 1];
	assert.strictEqual(lastMatched, "detail", "Last rapid navigation won");
});

QUnit.test("Rapid async navigations - only last navigation settles", async function (assert: Assert) {
	const matchedRoutes: string[] = [];
	router.addGuard(async () => {
		await nextTick(50);
		return true;
	});
	router.initialize();

	router.attachRouteMatched((event: Router$RouteMatchedEvent) => {
		matchedRoutes.push(event.getParameter("name")!);
	});

	await nextTick(200);
	matchedRoutes.length = 0;
	router.navTo("protected");
	router.navTo("forbidden");
	router.navTo("detail", { id: "1" });

	await nextTick(500);
	assert.strictEqual(matchedRoutes.length, 1, "Only one navigation settled");
	assert.strictEqual(matchedRoutes[0], "detail", "The last navigation won");
});

// ============================================================
// Module: Returning to current route during pending guard
// ============================================================
QUnit.module("Router - Returning to current route during pending guard", standardHooks);

QUnit.test("Navigating back to current route cancels a pending async guard", async function (assert: Assert) {
	router.addRouteGuard("protected", async () => {
		await nextTick(200);
		return true;
	});
	router.initialize();
	await nextTick(100);

	let protectedMatched = false;
	router.getRoute("protected")!.attachPatternMatched(() => {
		protectedMatched = true;
	});

	// Navigate to protected (triggers slow async guard)
	router.navTo("protected");

	// While guard is pending, trigger same-hash parse (user pressed back to home)
	await nextTick(50);
	HashChanger.getInstance().setHash("");

	// Wait for the async guard to resolve
	await nextTick(300);
	assert.notOk(protectedMatched, "Stale async guard result was discarded after same-hash dedup");
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
	const calls: unknown[][] = [];
	const originalNavTo = Reflect.get(router, "navTo") as (...args: unknown[]) => unknown;
	Reflect.set(router, "navTo", function (this: unknown, ...args: unknown[]) {
		calls.push(args);
		return Reflect.apply(originalNavTo, this, args);
	});

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

	// First call: router.navTo("forbidden") from the test
	// Second call: this.navTo("detail", ...) from _redirect()
	assert.ok(calls.length >= 2, "navTo called at least twice (trigger + redirect)");
	const redirectCall = calls[calls.length - 1];
	assert.deepEqual(redirectCall[2], expectedCTI, "Non-empty componentTargetInfo forwarded to navTo during redirect");
});

// ============================================================
// Module: Destroy during pending async guard
// ============================================================
QUnit.module("Router - Destroy during pending async guard", safeDestroyHooks);

QUnit.test(
	"Destroying router while async guard is pending does not complete navigation",
	async function (assert: Assert) {
		router.addGuard(async () => {
			await nextTick(200);
			return true;
		});
		router.initialize();

		let routeMatched = false;
		router.getRoute("protected")!.attachPatternMatched(() => {
			routeMatched = true;
		});

		// Trigger navigation with slow async guard
		router.navTo("protected");

		// Destroy while guard is pending
		await nextTick(50);
		router.destroy();

		// Wait for the guard promise to resolve in the background
		await nextTick(300);
		assert.notOk(routeMatched, "Navigation did not complete after destroy");
	},
);

// ============================================================
// Module: Stop during pending async guard
// ============================================================
QUnit.module("Router - Stop during pending async guard", safeDestroyHooks);

QUnit.test(
	"Stopping router while async guard is pending aborts and prevents navigation",
	async function (assert: Assert) {
		let capturedSignal: AbortSignal | null = null;
		let routeMatched = false;

		router.initialize();
		await waitForRoute(router, "home");

		router.addGuard(async (context: GuardContext) => {
			capturedSignal = context.signal;
			await nextTick(200);
			return true;
		});

		router.getRoute("protected")!.attachPatternMatched(() => {
			routeMatched = true;
		});

		router.navTo("protected");
		await nextTick(50);
		router.stop();

		assert.ok(capturedSignal, "Signal was captured");
		assert.ok(capturedSignal!.aborted, "Signal was aborted on stop");
		assert.notOk(router.isInitialized(), "Router stayed stopped");

		await nextTick(250);
		assert.notOk(routeMatched, "Navigation did not complete after stop");
	},
);

// ============================================================
// Module: AbortSignal on GuardContext
// ============================================================
QUnit.module("Router - AbortSignal on GuardContext", safeDestroyHooks);

QUnit.test("Guard context includes an AbortSignal", async function (assert: Assert) {
	let capturedSignal: AbortSignal | null = null;
	router.addGuard((context: GuardContext) => {
		capturedSignal = context.signal;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	assert.ok(capturedSignal, "Signal was provided");
	assert.ok(capturedSignal! instanceof AbortSignal, "Signal is an AbortSignal");
	assert.notOk(capturedSignal!.aborted, "Signal is not aborted after successful navigation");
});

QUnit.test("Signal is aborted when a newer navigation supersedes", async function (assert: Assert) {
	let firstSignal: AbortSignal | null = null;
	let secondSignal: AbortSignal | null = null;
	let callCount = 0;

	router.addGuard(async (context: GuardContext) => {
		callCount++;
		if (callCount === 1) {
			firstSignal = context.signal;
			await nextTick(200); // slow guard
		} else {
			secondSignal = context.signal;
			await nextTick(10); // fast guard
		}
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");
	callCount = 0;

	// First navigation (slow)
	router.navTo("protected");
	// Second navigation supersedes first
	await nextTick(10);
	router.navTo("detail", { id: "1" });

	await nextTick(500);
	assert.ok(firstSignal, "First signal was captured");
	assert.ok(firstSignal!.aborted, "First signal was aborted by second navigation");
	assert.ok(secondSignal, "Second signal was captured");
	assert.notOk(secondSignal!.aborted, "Second signal remains active");
});

QUnit.test("Signal is aborted on router destroy", async function (assert: Assert) {
	let capturedSignal: AbortSignal | null = null;
	router.addGuard(async (context: GuardContext) => {
		capturedSignal = context.signal;
		await nextTick(200);
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");
	capturedSignal = null;

	router.navTo("protected");
	await nextTick(10);
	assert.ok(capturedSignal, "Signal was captured");
	assert.notOk(capturedSignal!.aborted, "Signal is not yet aborted");

	router.destroy();
	assert.ok(capturedSignal!.aborted, "Signal was aborted on destroy");
});

QUnit.test("Signal is aborted when navigating back to current route", async function (assert: Assert) {
	let capturedSignal: AbortSignal | null = null;
	router.addRouteGuard("protected", async (context: GuardContext) => {
		capturedSignal = context.signal;
		await nextTick(200);
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	// Navigate to protected (triggers slow route guard)
	router.navTo("protected");
	await nextTick(10);
	assert.ok(capturedSignal, "Signal was captured");

	// Navigate back to current route while guard is pending
	HashChanger.getInstance().setHash("");
	assert.ok(capturedSignal!.aborted, "Signal was aborted when returning to current route");
});

// ============================================================
// Module: Superseded navigation stops remaining guards
// ============================================================
QUnit.module("Router - Superseded navigation stops remaining guards", standardHooks);

QUnit.test("Guards for a superseded navigation stop executing", async function (assert: Assert) {
	const executed: number[] = [];

	// Use route-specific guards so they only run for "protected", not for "forbidden"
	router.addRouteGuard("protected", async () => {
		executed.push(1);
		await nextTick(10);
		return true;
	});
	router.addRouteGuard("protected", async () => {
		executed.push(2);
		await nextTick(100); // slow: will be superseded while waiting
		return true;
	});
	router.addRouteGuard("protected", async () => {
		executed.push(3); // should NOT run if superseded
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	// Start navigation that will be superseded
	router.navTo("protected");
	// Wait for guard 1 to finish and guard 2 to start
	await nextTick(30);
	// Supersede with a new navigation (no guards on "forbidden")
	router.navTo("forbidden");
	await waitForRoute(router, "forbidden");

	await nextTick(200); // let everything settle
	assert.ok(executed.includes(1), "Guard 1 ran");
	assert.ok(executed.includes(2), "Guard 2 ran (was already started)");
	assert.notOk(executed.includes(3), "Guard 3 was skipped (early bailout)");
});

QUnit.test(
	"Route guards do not start when navigation is superseded during global guard",
	async function (assert: Assert) {
		let routeGuardCalled = false;

		router.addGuard(async () => {
			await nextTick(100); // slow global guard
			return true;
		});
		router.addRouteGuard("protected", () => {
			routeGuardCalled = true;
			return true;
		});
		router.initialize();
		await waitForRoute(router, "home");

		// Start navigation to protected (triggers slow global guard)
		router.navTo("protected");
		// Supersede while global guard is pending
		await nextTick(30);
		router.navTo("forbidden");
		await waitForRoute(router, "forbidden");

		await nextTick(200);
		assert.notOk(routeGuardCalled, "Route guard was not started after superseded global guard");
	},
);

// ============================================================
// Module: Duplicate and overlapping navigation
// ============================================================
QUnit.module("Router - Duplicate and overlapping navigation", standardHooks);

QUnit.test(
	"Repeated navTo to same destination during pending guard runs guard only once",
	async function (assert: Assert) {
		let guardCallCount = 0;
		router.addRouteGuard("protected", async () => {
			guardCallCount++;
			await nextTick(100);
			return true;
		});
		router.initialize();
		await waitForRoute(router, "home");

		// First navTo triggers guard
		router.navTo("protected");
		// Second navTo to same destination while guard is pending, should be ignored
		await nextTick(10);
		router.navTo("protected");

		await waitForRoute(router, "protected");
		assert.strictEqual(guardCallCount, 1, "Guard only ran once (duplicate was deduped)");
	},
);

QUnit.test("navTo to different destination during pending guard supersedes the first", async function (assert: Assert) {
	router.addRouteGuard("protected", async () => {
		await nextTick(100);
		return true;
	});
	router.addRouteGuard("detail", async () => {
		await nextTick(10);
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	let protectedMatched = false;
	router.getRoute("protected")!.attachPatternMatched(() => {
		protectedMatched = true;
	});

	// First navTo triggers protected guard (slow)
	router.navTo("protected");
	// Different destination supersedes
	await nextTick(10);
	router.navTo("detail", { id: "1" });

	await waitForRoute(router, "detail");
	assert.notOk(protectedMatched, "First navigation was superseded");
	assert.strictEqual(HashChanger.getInstance().getHash(), "detail/1", "Second navigation won");
});

QUnit.test("Route is navigable again after a guarded navigation completes", async function (assert: Assert) {
	let guardCallCount = 0;
	router.addRouteGuard("protected", async () => {
		guardCallCount++;
		await nextTick(50);
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	// First navigation: guard runs and commits
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(guardCallCount, 1, "Guard ran for first navigation");

	// Navigate away
	router.navTo("home");
	await waitForRoute(router, "home");

	// Same destination again, should work (not stuck as "pending")
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(guardCallCount, 2, "Guard ran again for second navigation");
});

QUnit.test("AbortError from guard is silenced when navigation is superseded", async function (assert: Assert) {
	const unhandledRejections: PromiseRejectionEvent[] = [];
	const rejectionHandler = (event: PromiseRejectionEvent): void => {
		unhandledRejections.push(event);
	};
	window.addEventListener("unhandledrejection", rejectionHandler);

	router.addGuard(async (context: GuardContext) => {
		// Simulate a fetch that throws AbortError when signal is aborted
		await new Promise<void>((resolve, reject) => {
			if (context.signal.aborted) {
				reject(new DOMException("The operation was aborted.", "AbortError"));
				return;
			}
			context.signal.addEventListener("abort", () => {
				reject(new DOMException("The operation was aborted.", "AbortError"));
			});
			setTimeout(resolve, 200);
		});
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	// Start navigation (triggers guard with simulated fetch)
	router.navTo("protected");
	// Supersede quickly
	await nextTick(10);
	router.navTo("forbidden");
	await waitForRoute(router, "forbidden");

	// Wait for everything to settle; no unhandled errors should occur
	await nextTick(300);
	window.removeEventListener("unhandledrejection", rejectionHandler);
	assert.strictEqual(unhandledRejections.length, 0, "No unhandled promise rejections from AbortError");
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
	let leaveGuardCalled = false;
	router.addLeaveGuard("home", () => {
		leaveGuardCalled = true;
		return true;
	});
	// Enter guard on "forbidden" redirects to "home"
	router.addRouteGuard("forbidden", () => "home");
	router.initialize();
	await waitForRoute(router, "home");

	// Navigate to forbidden (enter guard redirects to home)
	// The leave guard on "home" should run once (for leaving home to go to forbidden)
	leaveGuardCalled = false;
	router.navTo("forbidden");
	await nextTick(100);

	// The redirect from forbidden back to home should NOT trigger
	// the leave guard again because _redirecting bypasses all guards
	assert.ok(leaveGuardCalled, "Leave guard ran for initial leave from home");
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

QUnit.test("Leave guard throwing error blocks navigation", async function (assert: Assert) {
	router.addLeaveGuard("home", () => {
		throw new Error("Leave guard error");
	});
	router.initialize();
	await waitForRoute(router, "home");

	await assertBlocked(assert, router, () => router.navTo("protected"), "Throwing leave guard blocked navigation");
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

QUnit.test("Async leave guard rejecting blocks navigation", async function (assert: Assert) {
	router.addLeaveGuard("home", () => {
		return Promise.reject(new Error("Async leave guard rejection"));
	});
	router.initialize();
	await waitForRoute(router, "home");

	await assertBlocked(
		assert,
		router,
		() => router.navTo("protected"),
		"Rejecting async leave guard blocked navigation",
	);
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
	await nextTick(50);
	assert.ok(guardCalled, "Leave guard was called for unmatched hash navigation");
});

QUnit.test("Leave guard can block navigation to an unmatched hash", async function (assert: Assert) {
	router.addLeaveGuard("home", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	HashChanger.getInstance().setHash("some/unknown/path");
	await nextTick(150);
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
	await nextTick(50);
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
	await nextTick(50);

	assert.ok(capturedContext, "Guard context was captured");
	assert.strictEqual(capturedContext!.fromRoute, "protected", "fromRoute is the current route");
	assert.strictEqual(capturedContext!.fromHash, "protected", "fromHash is the current hash");
	assert.strictEqual(capturedContext!.toRoute, "", "toRoute is empty for unmatched hash");
	assert.strictEqual(capturedContext!.toHash, "cross-app-intent", "toHash is the raw intent hash");
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
// Module: Abort controller cleanup (leak prevention)
// ============================================================
QUnit.module("Router - Abort controller cleanup", standardHooks);

QUnit.test(
	"Signal from a committed navigation is not retroactively aborted by the next navigation",
	async function (assert: Assert) {
		let firstSignal: AbortSignal | null = null;
		let callCount = 0;
		router.addGuard((context: GuardContext) => {
			callCount++;
			if (callCount === 1) {
				firstSignal = context.signal;
			}
			return true;
		});
		router.initialize();
		await waitForRoute(router, "home");
		callCount = 0;

		// First navigation commits successfully
		router.navTo("protected");
		await waitForRoute(router, "protected");
		assert.ok(firstSignal, "Signal was captured from first navigation");
		assert.notOk(firstSignal!.aborted, "Signal was not aborted after successful commit");

		// Second navigation should NOT retroactively abort the first signal
		router.navTo("forbidden");
		await waitForRoute(router, "forbidden");
		assert.notOk(firstSignal!.aborted, "First signal stays clean after second navigation commits");
	},
);

QUnit.test(
	"Signal from a blocked navigation is not retroactively aborted by the next navigation",
	async function (assert: Assert) {
		let blockedSignal: AbortSignal | null = null;
		let callCount = 0;
		router.addRouteGuard("protected", (context: GuardContext) => {
			callCount++;
			if (callCount === 1) {
				blockedSignal = context.signal;
			}
			return false;
		});
		router.initialize();
		await waitForRoute(router, "home");
		callCount = 0;

		// First navigation is blocked
		router.navTo("protected");
		await nextTick(150);
		assert.ok(blockedSignal, "Signal was captured from blocked navigation");
		assert.notOk(blockedSignal!.aborted, "Blocked signal is not aborted (guard ran to completion)");

		// Navigate to an unguarded route; the stale controller must not leak
		router.navTo("forbidden");
		await waitForRoute(router, "forbidden");
		assert.notOk(blockedSignal!.aborted, "Blocked signal stays clean after unguarded navigation");
	},
);

QUnit.test(
	"Signal from a redirected navigation is not retroactively aborted by the next navigation",
	async function (assert: Assert) {
		let redirectedSignal: AbortSignal | null = null;
		router.addRouteGuard("forbidden", (context: GuardContext) => {
			redirectedSignal = context.signal;
			return "home";
		});
		router.initialize();
		await waitForRoute(router, "home");

		// Navigation triggers redirect
		router.navTo("forbidden");
		await waitForRoute(router, "home");
		assert.ok(redirectedSignal, "Signal was captured from redirected navigation");
		assert.notOk(redirectedSignal!.aborted, "Signal was not aborted after redirect");

		// Subsequent navigation must not retroactively abort the old signal
		router.navTo("protected");
		await waitForRoute(router, "protected");
		assert.notOk(redirectedSignal!.aborted, "Redirected signal stays clean after subsequent navigation");
	},
);

// ============================================================
// Module: navigationSettled()
// ============================================================
QUnit.module("Router - navigationSettled()", standardHooks);

QUnit.test("Resolves immediately with 'committed' when nothing pending", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "Status is committed");
	assert.strictEqual(result.route, "home", "Route is current route");
	assert.strictEqual(result.hash, "", "Hash is current hash");
});

QUnit.test("Resolves with 'committed' when sync guard allows", async function (assert: Assert) {
	router.addRouteGuard("protected", () => true);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "Status is committed");
	assert.strictEqual(result.route, "protected", "Route is target route");
	assert.strictEqual(result.hash, "protected", "Hash is target hash");
});

QUnit.test("Resolves with 'blocked' when sync guard blocks", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Status is blocked");
	assert.strictEqual(result.route, "home", "Route stays on current route");
	assert.strictEqual(result.hash, "", "Hash stays on current hash");
});

QUnit.test("Resolves with 'redirected' when guard redirects (string)", async function (assert: Assert) {
	router.addRouteGuard("forbidden", () => "home");
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "protected");

	router.navTo("forbidden");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Redirected, "Status is redirected");
	assert.strictEqual(result.route, "home", "Route is redirect target");
});

QUnit.test("Resolves with 'committed' when async guard allows", async function (assert: Assert) {
	router.addRouteGuard("protected", () => Promise.resolve(true));
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "Status is committed");
	assert.strictEqual(result.route, "protected", "Route is target route");
});

QUnit.test("Resolves with 'blocked' when async guard blocks", async function (assert: Assert) {
	router.addRouteGuard("protected", () => Promise.resolve(false));
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Status is blocked");
	assert.strictEqual(result.route, "home", "Route stays on current route");
});

QUnit.test("Resolves with 'redirected' when async guard redirects", async function (assert: Assert) {
	router.addRouteGuard("forbidden", () => Promise.resolve("home"));
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "protected");

	router.navTo("forbidden");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Redirected, "Status is redirected");
	assert.strictEqual(result.route, "home", "Route is redirect target");
});

QUnit.test("Resolves with 'cancelled' when navigation is superseded", async function (assert: Assert) {
	router.addRouteGuard("protected", () => {
		return new Promise((resolve) => setTimeout(() => resolve(true), 100));
	});
	router.initialize();
	await waitForRoute(router, "home");

	// Start slow navigation
	router.navTo("protected");
	const settledPromise = router.navigationSettled();

	// Supersede with immediate navigation
	router.navTo("forbidden");
	await waitForRoute(router, "forbidden");

	const result = await settledPromise;
	assert.strictEqual(result.status, NavigationOutcome.Cancelled, "Status is cancelled");
	assert.strictEqual(result.route, "home", "Route is the route active when cancelled");
});

QUnit.test("Multiple callers receive the same result", async function (assert: Assert) {
	router.addRouteGuard("protected", () => Promise.resolve(true));
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const [result1, result2, result3] = await Promise.all([
		router.navigationSettled(),
		router.navigationSettled(),
		router.navigationSettled(),
	]);
	assert.strictEqual(result1.status, NavigationOutcome.Committed, "First caller gets committed");
	assert.strictEqual(result2.status, NavigationOutcome.Committed, "Second caller gets committed");
	assert.strictEqual(result3.status, NavigationOutcome.Committed, "Third caller gets committed");
	assert.strictEqual(result1.route, result2.route, "All callers get the same route");
	assert.strictEqual(result2.route, result3.route, "All callers get the same route");
});

QUnit.test("Status is NOT committed when guard blocks", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.notStrictEqual(result.status, NavigationOutcome.Committed, "Status is not committed");
	assert.notStrictEqual(result.status, NavigationOutcome.Redirected, "Status is not redirected");
	assert.notStrictEqual(result.status, NavigationOutcome.Cancelled, "Status is not cancelled");
});

QUnit.test("Status is NOT blocked when guard allows", async function (assert: Assert) {
	router.addRouteGuard("protected", () => true);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.notStrictEqual(result.status, NavigationOutcome.Blocked, "Status is not blocked");
	assert.notStrictEqual(result.status, NavigationOutcome.Redirected, "Status is not redirected");
	assert.notStrictEqual(result.status, NavigationOutcome.Cancelled, "Status is not cancelled");
});

QUnit.test("Resolves with 'redirected' when guard returns GuardRedirect object", async function (assert: Assert) {
	const target: GuardRedirect = { route: "detail", parameters: { id: "42" } };
	router.addRouteGuard("forbidden", () => target);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("forbidden");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Redirected, "Status is redirected");
	assert.strictEqual(result.route, "detail", "Route is redirect target");
	assert.strictEqual(result.hash, "detail/42", "Hash includes parameters");
});

QUnit.test("Leave guard block produces 'blocked' status", async function (assert: Assert) {
	router.addLeaveGuard("home", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Leave guard block is reflected");
	assert.strictEqual(result.route, "home", "Route stays on home");
});

QUnit.test("Async leave guard block produces 'blocked' status", async function (assert: Assert) {
	router.addLeaveGuard("home", () => Promise.resolve(false));
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Async leave guard block is reflected");
	assert.strictEqual(result.route, "home", "Route stays on home");
});

QUnit.test("Resolves with 'committed' for navigation without guards", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "No-guard navigation is committed");
	assert.strictEqual(result.route, "protected", "Route is target route");
});

QUnit.test("Successive navigations each produce independent results", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	// First: blocked
	router.navTo("protected");
	const result1 = await router.navigationSettled();
	assert.strictEqual(result1.status, NavigationOutcome.Blocked, "First navigation blocked");

	// Second: committed (different route, no guard)
	router.navTo("forbidden");
	const result2 = await router.navigationSettled();
	assert.strictEqual(result2.status, NavigationOutcome.Committed, "Second navigation committed");
	assert.strictEqual(result2.route, "forbidden", "Route is forbidden");
});

QUnit.test("Resolves with 'cancelled' when stop() is called during async guard", async function (assert: Assert) {
	router.addRouteGuard("protected", () => {
		return new Promise((resolve) => setTimeout(() => resolve(true), 200));
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const settledPromise = router.navigationSettled();
	router.stop();

	const result = await settledPromise;
	assert.strictEqual(result.status, NavigationOutcome.Cancelled, "stop() cancels pending navigation");
});

QUnit.test("Cancelled settlement sees an already-aborted signal", async function (assert: Assert) {
	let capturedSignal: AbortSignal | null = null;
	router.addRouteGuard("protected", async (context: GuardContext) => {
		capturedSignal = context.signal;
		await nextTick(200);
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const settledPromise = router.navigationSettled();
	await nextTick(10);
	router.navTo("forbidden");

	const result = await settledPromise;
	assert.strictEqual(result.status, NavigationOutcome.Cancelled, "Navigation was cancelled");
	assert.ok(capturedSignal, "Signal was captured");
	assert.ok(capturedSignal!.aborted, "Signal is already aborted when Cancelled settlement resolves");
});

QUnit.test("Idle call after Blocked replays Blocked status", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const first = await router.navigationSettled();
	assert.strictEqual(first.status, NavigationOutcome.Blocked, "First call returns Blocked");

	// Router is now idle -- second call should replay the last settlement
	const second = await router.navigationSettled();
	assert.strictEqual(second.status, NavigationOutcome.Blocked, "Idle replay returns Blocked");
	assert.strictEqual(second.route, "home", "Replayed route is correct");
	assert.strictEqual(second.hash, "", "Replayed hash is correct");
});

QUnit.test("Idle call after Cancelled replays Cancelled status", async function (assert: Assert) {
	router.addRouteGuard("protected", () => {
		return new Promise((resolve) => setTimeout(() => resolve(true), 100));
	});
	router.initialize();
	await waitForRoute(router, "home");

	// Start slow navigation
	router.navTo("protected");
	const settledPromise = router.navigationSettled();

	// Navigate back to current hash -- cancels without starting a new pipeline
	HashChanger.getInstance().setHash("");

	const first = await settledPromise;
	assert.strictEqual(first.status, NavigationOutcome.Cancelled, "Pending nav was cancelled");

	// Router is now idle -- second call should replay the last settlement
	const second = await router.navigationSettled();
	assert.strictEqual(second.status, NavigationOutcome.Cancelled, "Idle replay returns Cancelled");
	assert.strictEqual(second.route, "home", "Replayed route is correct");
});

QUnit.test("Redirect to nonexistent route settles as blocked", async function (assert: Assert) {
	router.addGuard((context: GuardContext) => {
		if (context.toRoute === "home") {
			return "nonExistentRoute";
		}
		return true;
	});
	router.initialize();

	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Failed redirect settles as blocked");
	assert.strictEqual(result.route, "", "Route reflects where the router stayed");
});

QUnit.test("Async redirect to nonexistent route settles as blocked", async function (assert: Assert) {
	router.addRouteGuard("protected", async () => {
		await nextTick(10);
		return "nonExistentRoute";
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Failed async redirect settles as blocked");
	assert.strictEqual(result.route, "home", "Route reflects where the router stayed");
});

QUnit.test("GuardRedirect object to nonexistent route settles as blocked", async function (assert: Assert) {
	router.addRouteGuard("protected", (): GuardRedirect => ({ route: "nonExistentRoute", parameters: { id: "1" } }));
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Failed GuardRedirect settles as blocked");
	assert.strictEqual(result.route, "home", "Route reflects where the router stayed");
});

QUnit.test("Blocked navigation does not fire patternMatched on target route", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	let matched = false;
	router.getRoute("protected")!.attachPatternMatched(() => {
		matched = true;
	});

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Navigation was blocked");

	await nextTick();
	assert.notOk(matched, "patternMatched never fired on the blocked target route");
});
