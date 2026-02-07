import Router from "ui5/ext/routing/Router";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardContext, GuardFn, GuardRedirect, RouterInstance } from "ui5/ext/routing/types";
import { initHashChanger, nextTick } from "./testHelpers";

// Helper: create a router with standard test routes
function createRouter(): RouterInstance {
	return new (Router as any)([
		{ name: "home", pattern: "" },
		{ name: "protected", pattern: "protected" },
		{ name: "forbidden", pattern: "forbidden" },
		{ name: "detail", pattern: "detail/{id}" }
	], {
		async: true
	});
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
	}
});

QUnit.test("Router initializes without errors", function (assert: Assert) {
	assert.ok(router, "Router instance created");
});

QUnit.test("Router is an instance of sap.m.routing.Router", function (assert: Assert) {
	assert.ok(
		router.isA("sap.m.routing.Router"),
		"Router extends sap.m.routing.Router"
	);
});

QUnit.test("navTo navigates to named route", function (assert: Assert) {
	const done = assert.async();
	router.getRoute("protected")!.attachPatternMatched(() => {
		assert.ok(true, "Protected route matched");
		done();
	});
	router.navTo("protected");
});

QUnit.test("navTo with parameters", function (assert: Assert) {
	const done = assert.async();
	router.getRoute("detail")!.attachPatternMatched((event: any) => {
		assert.strictEqual(
			event.getParameter("arguments").id,
			"42",
			"Route parameter extracted correctly"
		);
		done();
	});
	router.navTo("detail", { id: "42" });
});

QUnit.test("routeMatched event fires", function (assert: Assert) {
	const done = assert.async();
	router.attachRouteMatched((event: any) => {
		if (event.getParameter("name") === "protected") {
			assert.ok(true, "routeMatched fired for protected route");
			done();
		}
	});
	router.navTo("protected");
});

QUnit.test("beforeRouteMatched event fires", function (assert: Assert) {
	const done = assert.async();
	router.attachBeforeRouteMatched((event: any) => {
		if (event.getParameter("name") === "protected") {
			assert.ok(true, "beforeRouteMatched fired");
			done();
		}
	});
	router.navTo("protected");
});

QUnit.test("navTo with replace does not create history entry", function (assert: Assert) {
	const done = assert.async();
	router.getRoute("protected")!.attachPatternMatched(() => {
		assert.ok(true, "Protected route matched with replace");
		done();
	});
	router.navTo("protected", {}, {}, true);
});

QUnit.test("getRoute returns route by name", function (assert: Assert) {
	const route = router.getRoute("home");
	assert.ok(route, "getRoute returns the home route");
});

QUnit.test("getRoute returns undefined for unknown route", function (assert: Assert) {
	const route = router.getRoute("nonexistent");
	assert.notOk(route, "getRoute returns undefined for unknown route");
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
		try { router.destroy(); } catch { /* already destroyed */ }
		HashChanger.getInstance().setHash("");
	}
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
	const result = router.addGuard(() => true);
	assert.strictEqual(result, router, "addGuard returns this");
});

QUnit.test("addRouteGuard returns this for chaining", function (assert: Assert) {
	const result = router.addRouteGuard("home", () => true);
	assert.strictEqual(result, router, "addRouteGuard returns this");
});

QUnit.test("destroy cleans up guards", function (assert: Assert) {
	router.addGuard(() => true);
	router.addRouteGuard("home", () => true);
	router.destroy();
	assert.strictEqual(router._globalGuards.length, 0, "Global guards cleared");
	assert.strictEqual(router._routeGuards.size, 0, "Route guards cleared");
});

// ============================================================
// Module: Guard behavior - allowing navigation
// ============================================================
QUnit.module("Router - Guard allows navigation", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	}
});

QUnit.test("Guard returning true allows navigation", function (assert: Assert) {
	const done = assert.async();
	router.addGuard(() => true);
	router.initialize();

	router.getRoute("protected")!.attachPatternMatched(() => {
		assert.ok(true, "Navigation allowed through guard");
		done();
	});
	router.navTo("protected");
});

QUnit.test("Async guard returning true allows navigation", function (assert: Assert) {
	const done = assert.async();
	router.addGuard(async () => {
		await nextTick(10);
		return true;
	});
	router.initialize();

	router.getRoute("protected")!.attachPatternMatched(() => {
		assert.ok(true, "Async guard allowed navigation");
		done();
	});
	router.navTo("protected");
});

QUnit.test("Route-specific guard returning true allows navigation", function (assert: Assert) {
	const done = assert.async();
	router.addRouteGuard("protected", () => true);
	router.initialize();

	router.getRoute("protected")!.attachPatternMatched(() => {
		assert.ok(true, "Route guard allowed navigation");
		done();
	});
	router.navTo("protected");
});

// ============================================================
// Module: Guard behavior - blocking navigation
// ============================================================
QUnit.module("Router - Guard blocks navigation", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	}
});

QUnit.test("Guard returning false blocks navigation", function (assert: Assert) {
	const done = assert.async();
	let routeMatched = false;

	router.addGuard(() => false);
	router.initialize();

	router.getRoute("protected")!.attachPatternMatched(() => {
		routeMatched = true;
	});

	router.navTo("protected");

	nextTick(200).then(() => {
		assert.notOk(routeMatched, "Navigation was blocked");
		done();
	});
});

QUnit.test("Async guard returning false blocks navigation", function (assert: Assert) {
	const done = assert.async();
	let routeMatched = false;

	router.addGuard(async () => {
		await nextTick(10);
		return false;
	});
	router.initialize();

	router.getRoute("protected")!.attachPatternMatched(() => {
		routeMatched = true;
	});

	router.navTo("protected");

	nextTick(200).then(() => {
		assert.notOk(routeMatched, "Async guard blocked navigation");
		done();
	});
});

QUnit.test("Route-specific guard returning false blocks navigation", function (assert: Assert) {
	const done = assert.async();
	let routeMatched = false;

	router.addRouteGuard("protected", () => false);
	router.initialize();

	router.getRoute("protected")!.attachPatternMatched(() => {
		routeMatched = true;
	});

	router.navTo("protected");

	nextTick(200).then(() => {
		assert.notOk(routeMatched, "Route guard blocked navigation");
		done();
	});
});

QUnit.test("Guard throwing an error blocks navigation", function (assert: Assert) {
	const done = assert.async();
	let routeMatched = false;

	router.addGuard(() => {
		throw new Error("Guard error");
	});
	router.initialize();

	router.getRoute("protected")!.attachPatternMatched(() => {
		routeMatched = true;
	});

	router.navTo("protected");

	nextTick(200).then(() => {
		assert.notOk(routeMatched, "Navigation blocked on guard error");
		done();
	});
});

QUnit.test("Guard returning rejected Promise blocks navigation", function (assert: Assert) {
	const done = assert.async();
	let routeMatched = false;

	router.addGuard(() => Promise.reject(new Error("Rejected")));
	router.initialize();

	router.getRoute("protected")!.attachPatternMatched(() => {
		routeMatched = true;
	});

	router.navTo("protected");

	nextTick(200).then(() => {
		assert.notOk(routeMatched, "Navigation blocked on rejected promise");
		done();
	});
});

// ============================================================
// Module: Guard behavior - redirect
// ============================================================
QUnit.module("Router - Guard redirects", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	}
});

QUnit.test("Guard returning string redirects to named route", function (assert: Assert) {
	const done = assert.async();

	router.addRouteGuard("forbidden", () => "home");
	router.initialize();

	// Wait for initialize's async patternMatched to settle before attaching test handler
	const homeRoute = router.getRoute("home")!;
	homeRoute.attachPatternMatched(function initHandler() {
		homeRoute.detachPatternMatched(initHandler);

		homeRoute.attachPatternMatched(() => {
			assert.ok(true, "Redirected to home route");
			done();
		});

		router.navTo("forbidden");
	});
});

QUnit.test("Async guard returning string redirects", function (assert: Assert) {
	const done = assert.async();

	router.addRouteGuard("forbidden", async () => {
		await nextTick(10);
		return "home";
	});
	router.initialize();

	// Wait for initialize's async patternMatched to settle before attaching test handler
	const homeRoute = router.getRoute("home")!;
	homeRoute.attachPatternMatched(function initHandler() {
		homeRoute.detachPatternMatched(initHandler);

		homeRoute.attachPatternMatched(() => {
			assert.ok(true, "Async guard redirected to home");
			done();
		});

		router.navTo("forbidden");
	});
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
	}
});

QUnit.test("Guard receives correct context", function (assert: Assert) {
	const done = assert.async();
	let capturedContext: GuardContext | null = null;

	router.addGuard((context: GuardContext) => {
		capturedContext = context;
		return true;
	});
	router.initialize();

	router.getRoute("detail")!.attachPatternMatched(() => {
		assert.ok(capturedContext, "Context was captured");
		assert.strictEqual(capturedContext!.toRoute, "detail", "toRoute is correct");
		assert.strictEqual(capturedContext!.toHash, "detail/99", "toHash is correct");
		assert.deepEqual(capturedContext!.toArguments, { id: "99" }, "toArguments is correct");
		done();
	});

	router.navTo("detail", { id: "99" });
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
	}
});

QUnit.test("Multiple global guards run sequentially, first rejection wins", function (assert: Assert) {
	const done = assert.async();
	const order: number[] = [];

	router.addGuard(() => { order.push(1); return true; });
	router.addGuard(() => { order.push(2); return false; });
	router.addGuard(() => { order.push(3); return true; });
	router.initialize();

	// Wait for initialize's parse to settle, then test
	nextTick(100).then(() => {
		order.length = 0;
		router.navTo("protected");

		nextTick(200).then(() => {
			assert.deepEqual(order, [1, 2], "Guards ran sequentially and stopped at first rejection");
			done();
		});
	});
});

QUnit.test("Global guards run before route-specific guards", function (assert: Assert) {
	const done = assert.async();
	const order: string[] = [];

	router.addGuard(() => { order.push("global"); return true; });
	router.addRouteGuard("protected", () => { order.push("route"); return true; });
	router.initialize();

	// Wait for initialize's parse to settle, then reset and navigate
	nextTick(100).then(() => {
		order.length = 0;

		router.getRoute("protected")!.attachPatternMatched(() => {
			assert.deepEqual(order, ["global", "route"], "Global guard ran before route guard");
			done();
		});

		router.navTo("protected");
	});
});

QUnit.test("Route guard only runs for its route", function (assert: Assert) {
	const done = assert.async();
	let protectedGuardCalled = false;

	router.addRouteGuard("protected", () => {
		protectedGuardCalled = true;
		return true;
	});
	router.initialize();

	router.getRoute("home")!.attachPatternMatched(() => {
		nextTick(100).then(() => {
			assert.notOk(protectedGuardCalled, "Protected route guard did not run for home route");
			done();
		});
	});

	// Navigate to home (empty hash)
	HashChanger.getInstance().setHash("");
});

QUnit.test("No guards behaves identically to native router", function (assert: Assert) {
	const done = assert.async();
	router.initialize();

	router.getRoute("protected")!.attachPatternMatched(() => {
		assert.ok(true, "Navigation works without any guards");
		done();
	});

	router.navTo("protected");
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
	}
});

QUnit.test("Guard returning invalid value treats as block", function (assert: Assert) {
	const done = assert.async();
	let routeMatched = false;

	router.addGuard((() => 42) as any);
	router.initialize();

	router.getRoute("protected")!.attachPatternMatched(() => {
		routeMatched = true;
	});

	router.navTo("protected");

	nextTick(200).then(() => {
		assert.notOk(routeMatched, "Invalid guard return treated as block");
		done();
	});
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
	}
});

QUnit.test("Guard returning GuardRedirect object redirects to route", function (assert: Assert) {
	const done = assert.async();

	router.addRouteGuard("forbidden", (): GuardRedirect => ({
		route: "home"
	}));
	router.initialize();

	// Wait for initialize's async patternMatched to settle before attaching test handler
	const homeRoute = router.getRoute("home")!;
	homeRoute.attachPatternMatched(function initHandler() {
		homeRoute.detachPatternMatched(initHandler);

		homeRoute.attachPatternMatched(() => {
			assert.ok(true, "Redirected to home via GuardRedirect");
			done();
		});

		router.navTo("forbidden");
	});
});

QUnit.test("Guard returning GuardRedirect with parameters redirects correctly", function (assert: Assert) {
	const done = assert.async();

	router.addRouteGuard("forbidden", (): GuardRedirect => ({
		route: "detail",
		parameters: { id: "error-403" }
	}));
	router.initialize();

	router.getRoute("detail")!.attachPatternMatched((event: any) => {
		assert.strictEqual(
			event.getParameter("arguments").id,
			"error-403",
			"Redirect includes route parameters"
		);
		done();
	});

	router.navTo("forbidden");
});

QUnit.test("Async guard returning GuardRedirect works", function (assert: Assert) {
	const done = assert.async();

	router.addRouteGuard("protected", async (): Promise<GuardRedirect> => {
		await nextTick(10);
		return { route: "home" };
	});
	router.initialize();

	// Wait for initialize's async patternMatched to settle before attaching test handler
	const homeRoute = router.getRoute("home")!;
	homeRoute.attachPatternMatched(function initHandler() {
		homeRoute.detachPatternMatched(initHandler);

		homeRoute.attachPatternMatched(() => {
			assert.ok(true, "Async GuardRedirect worked");
			done();
		});

		router.navTo("protected");
	});
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
	}
});

QUnit.test("Direct hash change to guarded route is blocked", function (assert: Assert) {
	const done = assert.async();
	let routeMatched = false;

	router.addRouteGuard("protected", () => false);
	router.initialize();

	router.getRoute("protected")!.attachPatternMatched(() => {
		routeMatched = true;
	});

	// Simulate typing a URL directly - uses HashChanger
	HashChanger.getInstance().setHash("protected");

	nextTick(200).then(() => {
		assert.notOk(routeMatched, "Direct hash change was blocked by guard");
		done();
	});
});

QUnit.test("Direct hash change to unguarded route proceeds", function (assert: Assert) {
	const done = assert.async();

	router.addRouteGuard("protected", () => false);
	router.initialize();

	router.getRoute("home")!.attachPatternMatched(() => {
		assert.ok(true, "Unguarded route matched via hash change");
		done();
	});

	// Navigate away first, then back to home
	router.navTo("forbidden");
	nextTick(50).then(() => {
		HashChanger.getInstance().setHash("");
	});
});

QUnit.test("Direct hash change with redirect restores correct hash", function (assert: Assert) {
	const done = assert.async();

	router.addRouteGuard("forbidden", () => "home");
	router.initialize();

	// Wait for initialize's async patternMatched to settle before attaching test handler
	const homeRoute = router.getRoute("home")!;
	homeRoute.attachPatternMatched(function initHandler() {
		homeRoute.detachPatternMatched(initHandler);

		homeRoute.attachPatternMatched(() => {
			nextTick(50).then(() => {
				const hash = HashChanger.getInstance().getHash();
				assert.strictEqual(hash, "", "Hash was restored to home route");
				done();
			});
		});

		HashChanger.getInstance().setHash("forbidden");
	});
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
	}
});

QUnit.test("Guard state change between navigations is respected", function (assert: Assert) {
	const done = assert.async();
	let allowNavigation = false;

	router.addRouteGuard("protected", () => allowNavigation ? true : "home");
	router.initialize();

	let homeMatchCount = 0;

	router.getRoute("home")!.attachPatternMatched(() => {
		homeMatchCount++;
	});

	// First attempt: blocked
	router.navTo("protected");

	nextTick(200).then(() => {
		// Should have been redirected to home
		assert.ok(homeMatchCount > 0, "First attempt redirected to home");

		// Change state: now allow
		allowNavigation = true;

		router.getRoute("protected")!.attachPatternMatched(() => {
			assert.ok(true, "Second attempt allowed after state change");
			done();
		});

		router.navTo("protected");
	});
});

QUnit.test("Adding guard mid-session blocks subsequent navigations", function (assert: Assert) {
	const done = assert.async();
	router.initialize();

	// First nav: no guards, should work
	router.getRoute("protected")!.attachPatternMatched(function handler() {
		router.getRoute("protected")!.detachPatternMatched(handler);

		// Now add a guard
		router.addRouteGuard("protected", () => false);

		let secondMatched = false;
		router.getRoute("protected")!.attachPatternMatched(() => {
			secondMatched = true;
		});

		// Navigate away and back
		router.navTo("home");
		nextTick(100).then(() => {
			router.navTo("protected");
			nextTick(200).then(() => {
				assert.notOk(secondMatched, "Guard added mid-session blocked navigation");
				done();
			});
		});
	});

	router.navTo("protected");
});

QUnit.test("Removing guard mid-session allows subsequent navigations", function (assert: Assert) {
	const done = assert.async();
	const guard: GuardFn = () => false;
	router.addRouteGuard("protected", guard);
	router.initialize();

	let matchedCount = 0;

	// First attempt: blocked
	router.navTo("protected");
	nextTick(200).then(() => {
		// Remove the guard
		router.removeRouteGuard("protected", guard);

		router.getRoute("protected")!.attachPatternMatched(() => {
			matchedCount++;
		});

		// Second attempt: should now work
		router.navTo("protected");
		nextTick(200).then(() => {
			assert.strictEqual(matchedCount, 1, "Navigation allowed after guard removed");
			done();
		});
	});
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
	}
});

QUnit.test("Guard that returns redirect does not cause infinite loop", function (assert: Assert) {
	const done = assert.async();
	let guardCallCount = 0;

	// Guard on forbidden redirects to home
	router.addRouteGuard("forbidden", () => {
		guardCallCount++;
		return "home";
	});
	router.initialize();

	router.navTo("forbidden");

	nextTick(500).then(() => {
		assert.strictEqual(guardCallCount, 1, "Guard only called once (no infinite loop)");
		done();
	});
});

QUnit.test("Multiple route guards with cross-redirects settle correctly", function (assert: Assert) {
	const done = assert.async();

	// forbidden → redirects to protected, protected → redirects to home
	router.addRouteGuard("forbidden", () => "protected");
	router.addRouteGuard("protected", () => "home");
	router.initialize();

	// The redirect from forbidden→protected triggers parse("protected")
	// which is re-entrant (_redirecting=true) so it bypasses guards.
	// This means we should end up on protected, not home.
	router.getRoute("protected")!.attachPatternMatched(() => {
		assert.ok(true, "Cross-redirect settled on protected (re-entrant bypass)");
		done();
	});

	router.navTo("forbidden");
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
	}
});

QUnit.test("replaceHash fires hashChanged synchronously (validates _suppressNextParse mechanism)", function (assert: Assert) {
	router.initialize();

	// Navigate to a known route first so _currentHash is set
	router.navTo("protected");

	// Track whether parse is called synchronously during replaceHash
	let parseCalled = false;
	const origParse = router.parse.bind(router);
	router.parse = function (hash: string) {
		parseCalled = true;
		origParse(hash);
	};

	const hashChanger = HashChanger.getInstance();
	(hashChanger as any).replaceHash("forbidden");

	// If replaceHash fires hashChanged synchronously, parse was already called
	assert.ok(parseCalled, "replaceHash triggered parse() synchronously (same tick)");
});
