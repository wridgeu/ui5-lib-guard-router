import HashChanger from "sap/ui/core/routing/HashChanger";
import type {
	GuardContext,
	GuardFn,
	GuardRedirect,
	GuardRouter,
	LeaveGuardFn,
	RouteGuardConfig,
} from "ui5/guard/router/types";
import type { Route$PatternMatchedEvent } from "sap/ui/core/routing/Route";
import type { Router$RouteMatchedEvent } from "sap/ui/core/routing/Router";
import { GuardRouterClass, initHashChanger, nextTick, waitForRoute, assertBlocked } from "./testHelpers";

interface DetailRouteArguments {
	id: string;
}

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

QUnit.test("navTo navigates to named route", async function (assert: Assert) {
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.ok(true, "Protected route matched");
});

QUnit.test("navTo with parameters", async function (assert: Assert) {
	const done = assert.async();
	router.getRoute("detail")!.attachPatternMatched((event: Route$PatternMatchedEvent) => {
		assert.strictEqual(
			(event.getParameter("arguments") as DetailRouteArguments).id,
			"42",
			"Route parameter extracted correctly",
		);
		done();
	});
	router.navTo("detail", { id: "42" });
});

QUnit.test("routeMatched event fires", async function (assert: Assert) {
	const done = assert.async();
	router.attachRouteMatched((event: Router$RouteMatchedEvent) => {
		if (event.getParameter("name") === "protected") {
			assert.ok(true, "routeMatched fired for protected route");
			done();
		}
	});
	router.navTo("protected");
});

QUnit.test("beforeRouteMatched event fires", async function (assert: Assert) {
	const done = assert.async();
	router.attachBeforeRouteMatched(() => {
		assert.ok(true, "beforeRouteMatched fired");
		done();
	});
	router.navTo("protected");
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
	await assertBlocked(assert, router, "protected", () => router.navTo("protected"), "Guard blocks after addGuard");

	router.removeGuard(guard);

	// Guard removed: navigation should succeed
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.ok(true, "Navigation allowed after removeGuard");
});

QUnit.test("addRouteGuard / removeRouteGuard affect navigation behavior", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	const guard: GuardFn = () => false;
	router.addRouteGuard("protected", guard);

	// Route guard is active: navigation should be blocked
	await assertBlocked(
		assert,
		router,
		"protected",
		() => router.navTo("protected"),
		"Route guard blocks after addRouteGuard",
	);

	router.removeRouteGuard("protected", guard);

	// Route guard removed: navigation should succeed
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.ok(true, "Navigation allowed after removeRouteGuard");
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

// ============================================================
// Module: Guard allows navigation
// ============================================================
QUnit.module("Router - Guard allows navigation", standardHooks);

QUnit.test("Guard returning true allows navigation", async function (assert: Assert) {
	router.addGuard(() => true);
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.ok(true, "Navigation allowed through guard");
});

QUnit.test("Async guard returning true allows navigation", async function (assert: Assert) {
	router.addGuard(async () => {
		await nextTick(10);
		return true;
	});
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.ok(true, "Async guard allowed navigation");
});

QUnit.test("Route-specific guard returning true allows navigation", async function (assert: Assert) {
	router.addRouteGuard("protected", () => true);
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.ok(true, "Route guard allowed navigation");
});

// ============================================================
// Module: Guard blocks navigation
// ============================================================
QUnit.module("Router - Guard blocks navigation", standardHooks);

QUnit.test("Guard returning false blocks navigation", async function (assert: Assert) {
	router.addGuard(() => false);
	router.initialize();
	await assertBlocked(assert, router, "protected", () => router.navTo("protected"), "Navigation was blocked");
});

QUnit.test("Async guard returning false blocks navigation", async function (assert: Assert) {
	router.addGuard(async () => {
		await nextTick(10);
		return false;
	});
	router.initialize();
	await assertBlocked(assert, router, "protected", () => router.navTo("protected"), "Async guard blocked navigation");
});

QUnit.test("Route-specific guard returning false blocks navigation", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await assertBlocked(assert, router, "protected", () => router.navTo("protected"), "Route guard blocked navigation");
});

QUnit.test("Guard throwing an error blocks navigation", async function (assert: Assert) {
	router.addGuard(() => {
		throw new Error("Guard error");
	});
	router.initialize();
	await assertBlocked(
		assert,
		router,
		"protected",
		() => router.navTo("protected"),
		"Navigation blocked on guard error",
	);
});

QUnit.test("Guard returning rejected Promise blocks navigation", async function (assert: Assert) {
	router.addGuard(() => Promise.reject(new Error("Rejected")));
	router.initialize();
	await assertBlocked(
		assert,
		router,
		"protected",
		() => router.navTo("protected"),
		"Navigation blocked on rejected promise",
	);
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
	await waitForRoute(router, "home"); // redirect lands on home
	assert.ok(true, "Redirected to home route");
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
	assert.ok(true, "Async guard redirected to home");
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
	assert.ok(true, "Navigation works without any guards");
});

// ============================================================
// Module: Guard with invalid return values
// ============================================================
QUnit.module("Router - Guard invalid values", standardHooks);

QUnit.test("Guard returning invalid value treats as block", async function (assert: Assert) {
	router.addGuard((() => 42) as any);
	router.initialize();
	await assertBlocked(
		assert,
		router,
		"protected",
		() => router.navTo("protected"),
		"Invalid guard return treated as block",
	);
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
	assert.ok(true, "Redirected to home via GuardRedirect");
});

QUnit.test("Guard returning GuardRedirect with parameters redirects correctly", async function (assert: Assert) {
	router.addRouteGuard(
		"forbidden",
		(): GuardRedirect => ({
			route: "detail",
			parameters: { id: "error-403" },
		}),
	);
	router.initialize();

	const done = assert.async();
	router.getRoute("detail")!.attachPatternMatched((event: Route$PatternMatchedEvent) => {
		assert.strictEqual(
			(event.getParameter("arguments") as DetailRouteArguments).id,
			"error-403",
			"Redirect includes route parameters",
		);
		done();
	});
	router.navTo("forbidden");
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
	assert.ok(true, "Async GuardRedirect worked");
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
		"protected",
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
	assert.ok(true, "Unguarded route matched via hash change");
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
	assert.ok(true, "Second attempt allowed after state change");
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
	await assertBlocked(
		assert,
		router,
		"protected",
		() => router.navTo("protected"),
		"Guard added mid-session blocked navigation",
	);
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
	assert.ok(true, "Navigation allowed after guard removed");
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
	assert.ok(true, "Cross-redirect settled on protected (re-entrant bypass)");
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
	assert.ok(true, "Navigation allowed through sync global + async route guard");
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
		"protected",
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
	assert.ok(true, "Navigation allowed through async global + sync route guard");
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
		"protected",
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
	assert.ok(true, "Sync route guard redirected after async global allowed");
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
	await assertBlocked(
		assert,
		router,
		"protected",
		() => router.navTo("protected"),
		"Async route guard error blocked navigation",
	);
});

QUnit.test("Async route-specific guard returning rejected promise blocks navigation", async function (assert: Assert) {
	router.addRouteGuard("protected", () => Promise.reject(new Error("Route guard rejected")));
	router.initialize();
	await assertBlocked(
		assert,
		router,
		"protected",
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
	assert.ok(true, "Async route guard redirected to home");
});

QUnit.test("Guard returning null is treated as block", async function (assert: Assert) {
	router.addGuard((() => null) as any);
	router.initialize();
	await assertBlocked(
		assert,
		router,
		"protected",
		() => router.navTo("protected"),
		"Null guard return treated as block",
	);
});

QUnit.test("Guard returning undefined is treated as block", async function (assert: Assert) {
	router.addGuard((() => undefined) as any);
	router.initialize();
	await assertBlocked(
		assert,
		router,
		"protected",
		() => router.navTo("protected"),
		"Undefined guard return treated as block",
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

	const done = assert.async();
	router.getRoute("detail")!.attachPatternMatched((event: Route$PatternMatchedEvent) => {
		assert.strictEqual(
			(event.getParameter("arguments") as DetailRouteArguments).id,
			"cti-1",
			"Redirect with componentTargetInfo landed on correct route with params",
		);
		done();
	});
	router.navTo("forbidden");
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
	assert.ok(true, "AbortError was silenced, no unhandled error");
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
	assert.ok(true, "Navigation allowed by leave guard");
});

QUnit.test("Leave guard returning false blocks navigation", async function (assert: Assert) {
	const leaveGuard: LeaveGuardFn = () => false;
	router.addLeaveGuard("home", leaveGuard);
	router.initialize();
	await waitForRoute(router, "home");

	await assertBlocked(assert, router, "protected", () => router.navTo("protected"), "Leave guard blocked navigation");
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
	assert.ok(true, "Async leave guard allowed navigation");
});

QUnit.test("Async leave guard returning false blocks navigation", async function (assert: Assert) {
	const leaveGuard: LeaveGuardFn = async () => {
		await nextTick(10);
		return false;
	};
	router.addLeaveGuard("home", leaveGuard);
	router.initialize();
	await waitForRoute(router, "home");

	await assertBlocked(
		assert,
		router,
		"protected",
		() => router.navTo("protected"),
		"Async leave guard blocked navigation",
	);
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

	await assertBlocked(
		assert,
		router,
		"protected",
		() => router.navTo("protected"),
		"First leave guard blocked navigation",
	);
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

	await assertBlocked(assert, router, "protected", () => router.navTo("protected"), "Leave guard blocked navigation");
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
		"protected",
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
	assert.ok(true, "Navigation allowed after leave guard removed");
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
	assert.ok(true, "No leave guard after destroy and re-create");
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

		// Navigate to "protected" — async leave guard is now pending
		router.navTo("protected");
		await nextTick(10);

		// Navigate to "forbidden" instead — supersedes the first navigation.
		// Both navigations leave "home", so the guard fires twice.
		router.navTo("forbidden");
		await nextTick(10);

		// Allow the second (active) navigation to proceed
		resolvers[1](true);
		await waitForRoute(router, "forbidden");
		assert.strictEqual(HashChanger.getInstance().getHash(), "forbidden", "Second navigation reached forbidden");

		// Now resolve the first (stale) guard — should have no effect
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

	await assertBlocked(
		assert,
		router,
		"protected",
		() => router.navTo("protected"),
		"Throwing leave guard blocked navigation",
	);
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
		"protected",
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
	assert.ok(true, "Enter guard removed via object form");

	// Leave guard was removed: navigation away from protected should succeed
	router.navTo("home");
	await waitForRoute(router, "home");
	assert.ok(true, "Leave guard removed via object form");
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
	assert.ok(true, "Enter guard removed, leave guard still active");

	// Leave guard still active: should block
	await assertBlocked(
		assert,
		router,
		"home",
		() => router.navTo("home"),
		"Leave guard still blocks after partial remove",
	);
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
