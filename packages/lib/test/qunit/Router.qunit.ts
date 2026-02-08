import Router from "ui5/ext/routing/Router";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardContext, GuardFn, GuardRedirect, RouterInstance } from "ui5/ext/routing/types";
import type { Route$PatternMatchedEvent } from "sap/ui/core/routing/Route";
import type { Router$RouteMatchedEvent } from "sap/ui/core/routing/Router";
import { initHashChanger, nextTick, waitForRoute, assertBlocked } from "./testHelpers";

interface DetailRouteArguments {
	id: string;
}

function createRouter(): RouterInstance {
	return new (Router as any)(
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

// ============================================================
// Module: Drop-in replacement (no guards)
// ============================================================
let router: RouterInstance;

QUnit.module("Router - Drop-in replacement (no guards)", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
		router.initialize();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
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
QUnit.module("Router - Guard API", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
	},
	afterEach: function () {
		try {
			router.destroy();
		} catch {
			/* already destroyed */
		}
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("addGuard / removeGuard register and deregister global guards", function (assert: Assert) {
	const guard: GuardFn = () => true;
	router.addGuard(guard);
	assert.strictEqual(router._globalGuards.length, 1, "Guard registered");

	router.removeGuard(guard);
	assert.strictEqual(router._globalGuards.length, 0, "Guard deregistered");
});

QUnit.test("addRouteGuard / removeRouteGuard register and deregister per-route guards", function (assert: Assert) {
	const guard: GuardFn = () => true;
	router.addRouteGuard("protected", guard);
	assert.strictEqual(router._routeGuards.get("protected")!.length, 1, "Route guard registered");

	router.removeRouteGuard("protected", guard);
	assert.notOk(router._routeGuards.has("protected"), "Route guard deregistered and map entry cleaned");
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

QUnit.test("destroy cleans up guards", function (assert: Assert) {
	router.addGuard(() => true);
	router.addRouteGuard("home", () => true);
	router.destroy();
	assert.strictEqual(router._globalGuards.length, 0, "Global guards cleared");
	assert.strictEqual(router._routeGuards.size, 0, "Route guards cleared");
});

// ============================================================
// Module: Guard allows navigation
// ============================================================
QUnit.module("Router - Guard allows navigation", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

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
QUnit.module("Router - Guard blocks navigation", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

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
QUnit.module("Router - Guard redirects", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

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
QUnit.module("Router - Guard context", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

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
QUnit.module("Router - Guard execution order", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("Multiple global guards run sequentially, first rejection wins", async function (assert: Assert) {
	const order: number[] = [];
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
	router.initialize();
	await waitForRoute(router, "home");

	order.length = 0;
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
QUnit.module("Router - Guard invalid values", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

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
QUnit.module("Router - GuardRedirect object", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

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
QUnit.module("Router - Hash change (direct URL entry)", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

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
QUnit.module("Router - Sequential navigation with changing guards", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

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
QUnit.module("Router - Guard re-entrancy", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

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
QUnit.module("Router - Mixed sync/async guard pipelines", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

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
// Module: Overlapping async navigations (generation counter)
// ============================================================
QUnit.module("Router - Overlapping async navigations", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

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
	let slowGuardCompleted = false;
	const slowGuard: GuardFn = async () => {
		await nextTick(200);
		slowGuardCompleted = true;
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
	assert.ok(slowGuardCompleted, "Slow guard did complete (but result discarded)");
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"detail/2",
		"Second navigation won, redirect from first was discarded",
	);
});

// ============================================================
// Module: Guard context across navigations
// ============================================================
QUnit.module("Router - Guard context across navigations", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

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
QUnit.module("Router - Async guard edge cases", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

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
	router.initialize();
	await waitForRoute(router, "home");

	order.length = 0;
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
QUnit.module("Router - Rapid sequential navigations", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

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
// Module: Same-hash dedup invalidates pending async guards
// ============================================================
QUnit.module("Router - Same-hash dedup invalidates async guards", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("Same-hash parse during async guard discards stale guard result", async function (assert: Assert) {
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
// Module: _suppressNextParse synchronous assumption
// ============================================================
QUnit.module("Router - _suppressNextParse synchronous assumption", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test(
	"replaceHash fires hashChanged synchronously (validates _suppressNextParse mechanism)",
	function (assert: Assert) {
		router.initialize();
		router.navTo("protected");

		let parseCalled = false;
		const origParse = router.parse.bind(router);
		router.parse = function (hash: string) {
			parseCalled = true;
			origParse(hash);
		};

		HashChanger.getInstance().replaceHash("forbidden", "Unknown");
		assert.ok(parseCalled, "replaceHash triggered parse() synchronously (same tick)");
	},
);
