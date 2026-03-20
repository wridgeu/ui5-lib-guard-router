import sinon from "sinon";
import DataType from "sap/ui/base/DataType";
import Log from "sap/base/Log";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type {
	GuardContext,
	GuardFn,
	GuardRouterOptions,
	GuardRedirect,
	GuardRouter,
	LeaveGuardFn,
	RouteGuardConfig,
	Router$NavigationSettledEvent,
} from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { Router$BypassedEvent, Router$RouteMatchedEvent } from "sap/ui/core/routing/Router";
import type { Route$PatternMatchedEvent } from "sap/ui/core/routing/Route";
import {
	addGuardUnsafe,
	addLeaveGuardUnsafe,
	addRouteGuardUnsafe,
	assertBlocked,
	captureWarnings,
	captureWarningsAsync,
	GuardRouterClass,
	initHashChanger,
	nextTick,
	getHash,
	removeGuardUnsafe,
	removeLeaveGuardUnsafe,
	removeRouteGuardUnsafe,
	waitForRoute,
} from "./testHelpers";

function createRouter(config?: { async?: boolean; guardRouter?: GuardRouterOptions }): GuardRouter {
	return new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
			{ name: "forbidden", pattern: "forbidden" },
			{ name: "detail", pattern: "detail/{id}" },
		],
		{
			async: true,
			...config,
		},
	);
}

let router: GuardRouter;

function recreateRouter(guardRouter?: GuardRouterOptions): GuardRouter {
	try {
		router.destroy();
	} catch {
		/* already destroyed */
	}
	router = createRouter(guardRouter ? { guardRouter } : undefined);
	return router;
}

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
	assert.strictEqual(type?.isValid(NavigationOutcome.Bypassed), true, "Bypassed enum value is accepted");
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

QUnit.test("addRouteGuard warns for unknown route but still registers the guard", function (assert: Assert) {
	const guard: GuardFn = () => true;
	const warnings = captureWarnings(() => {
		router.addRouteGuard("missing", guard);
	});

	assert.strictEqual(warnings.length, 1, "One warning was logged");
	assert.strictEqual(
		warnings[0]?.message,
		"addRouteGuard called for unknown route; guard will still register. If the route is added later via addRoute(), this warning can be ignored.",
		"Warning message explains the non-blocking behavior",
	);
	assert.strictEqual(warnings[0]?.details, "missing", "Warning includes the route name");

	const enterGuards = Reflect.get(router, "_enterGuards") as Map<string, GuardFn[]>;
	assert.strictEqual(enterGuards.get("missing")?.[0], guard, "Guard still registered for the unknown route");
});

QUnit.test(
	"addRouteGuard object form warns once for unknown route and registers both guards",
	function (assert: Assert) {
		const enterGuard: GuardFn = () => true;
		const leaveGuard: LeaveGuardFn = () => true;
		const warnings = captureWarnings(() => {
			router.addRouteGuard("missing", { beforeEnter: enterGuard, beforeLeave: leaveGuard });
		});

		assert.strictEqual(warnings.length, 1, "Object form logs only one warning");

		const enterGuards = Reflect.get(router, "_enterGuards") as Map<string, GuardFn[]>;
		const leaveGuards = Reflect.get(router, "_leaveGuards") as Map<string, LeaveGuardFn[]>;
		assert.strictEqual(enterGuards.get("missing")?.[0], enterGuard, "Enter guard registered");
		assert.strictEqual(leaveGuards.get("missing")?.[0], leaveGuard, "Leave guard registered");
	},
);

QUnit.test("addLeaveGuard warns for unknown route but still registers the guard", function (assert: Assert) {
	const guard: LeaveGuardFn = () => true;
	const warnings = captureWarnings(() => {
		router.addLeaveGuard("missing", guard);
	});

	assert.strictEqual(warnings.length, 1, "One warning was logged");
	assert.strictEqual(
		warnings[0]?.message,
		"addLeaveGuard called for unknown route; guard will still register. If the route is added later via addRoute(), this warning can be ignored.",
		"Warning message explains the non-blocking behavior",
	);
	assert.strictEqual(warnings[0]?.details, "missing", "Warning includes the route name");

	const leaveGuards = Reflect.get(router, "_leaveGuards") as Map<string, LeaveGuardFn[]>;
	assert.strictEqual(leaveGuards.get("missing")?.[0], guard, "Guard still registered for the unknown route");
});

QUnit.test("constructor strips custom guardRouter config from the base router config", function (assert: Assert) {
	recreateRouter({
		unknownRouteGuardRegistration: "ignore",
		navToPreflight: "off",
	});

	const baseConfig = Reflect.get(router, "_oConfig") as Record<string, unknown>;
	assert.strictEqual(baseConfig.async, true, "Native config values are still forwarded");
	assert.notOk(
		Object.prototype.hasOwnProperty.call(baseConfig, "guardRouter"),
		"Custom guardRouter config does not leak into the base router config",
	);
});

QUnit.test("invalid guardRouter config values warn and fall back to defaults", async function (assert: Assert) {
	router.destroy();

	const warnings: Array<{ message: string; details?: string }> = [];
	const originalWarning = Log.warning;
	Log.warning = (message: string, details?: string) => {
		warnings.push({ message, details });
	};

	try {
		router = createRouter({
			guardRouter: {
				unknownRouteGuardRegistration:
					"invalid" as unknown as GuardRouterOptions["unknownRouteGuardRegistration"],
				navToPreflight: "invalid" as unknown as GuardRouterOptions["navToPreflight"],
			},
		});
	} finally {
		Log.warning = originalWarning;
	}

	assert.deepEqual(
		warnings,
		[
			{
				message: 'Invalid guardRouter.unknownRouteGuardRegistration value, falling back to "warn"',
				details: "invalid",
			},
			{
				message: 'Invalid guardRouter.navToPreflight value, falling back to "guard"',
				details: "invalid",
			},
		],
		"Invalid config values emitted fallback warnings",
	);

	const warnAgain: Array<{ message: string; details?: string }> = [];
	Log.warning = (message: string, details?: string) => {
		warnAgain.push({ message, details });
	};
	try {
		router.addRouteGuard("missing", () => true);
	} finally {
		Log.warning = originalWarning;
	}

	assert.strictEqual(warnAgain.length, 1, "Unknown-route registration fell back to warn");
	assert.strictEqual(
		warnAgain[0]?.message,
		"addRouteGuard called for unknown route; guard will still register. If the route is added later via addRoute(), this warning can be ignored.",
		"Fallback warning behavior matches the default policy",
	);

	router.initialize();
	await waitForRoute(router, "home");
	router.addGuard(() => false);
	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"Programmatic navigation still falls back to guarded preflight",
	);
});

QUnit.test("non-object guardRouter config warns and falls back to defaults", function (assert: Assert) {
	router.destroy();

	const warnings: Array<{ message: string; details?: string }> = [];
	const originalWarning = Log.warning;
	Log.warning = (message: string, details?: string) => {
		warnings.push({ message, details });
	};

	try {
		router = createRouter({
			guardRouter: "invalid" as unknown as GuardRouterOptions,
		});
	} finally {
		Log.warning = originalWarning;
	}

	assert.deepEqual(
		warnings,
		[
			{
				message: "Invalid guardRouter config value, falling back to defaults",
				details: "invalid",
			},
		],
		"Non-object guardRouter config emits a fallback warning",
	);
});

QUnit.test("unknown route registration policy 'ignore' registers route guard silently", function (assert: Assert) {
	recreateRouter({ unknownRouteGuardRegistration: "ignore" });

	const guard: GuardFn = () => true;
	const warnings: Array<{ message: string; details?: string }> = [];
	const originalWarning = Log.warning;
	Log.warning = (message: string, details?: string) => {
		warnings.push({ message, details });
	};

	try {
		router.addRouteGuard("missing", guard);
	} finally {
		Log.warning = originalWarning;
	}

	assert.strictEqual(warnings.length, 0, "No warning was logged");
	const enterGuards = Reflect.get(router, "_enterGuards") as Map<string, GuardFn[]>;
	assert.strictEqual(enterGuards.get("missing")?.[0], guard, "Guard registered silently");
});

QUnit.test("unknown route registration policy 'ignore' registers leave guard silently", function (assert: Assert) {
	recreateRouter({ unknownRouteGuardRegistration: "ignore" });

	const guard: LeaveGuardFn = () => true;
	const warnings: Array<{ message: string; details?: string }> = [];
	const originalWarning = Log.warning;
	Log.warning = (message: string, details?: string) => {
		warnings.push({ message, details });
	};

	try {
		router.addLeaveGuard("missing", guard);
	} finally {
		Log.warning = originalWarning;
	}

	assert.strictEqual(warnings.length, 0, "No warning was logged");
	const leaveGuards = Reflect.get(router, "_leaveGuards") as Map<string, LeaveGuardFn[]>;
	assert.strictEqual(leaveGuards.get("missing")?.[0], guard, "Leave guard registered silently");
});

QUnit.test("unknown route registration policy 'throw' rejects direct route guards", function (assert: Assert) {
	recreateRouter({ unknownRouteGuardRegistration: "throw" });

	const guard: GuardFn = () => true;
	assert.throws(
		() => router.addRouteGuard("missing", guard),
		/unknown route "missing"/,
		"Unknown route registration throws synchronously",
	);

	const enterGuards = Reflect.get(router, "_enterGuards") as Map<string, GuardFn[]>;
	assert.notOk(enterGuards.has("missing"), "Guard was not registered");
});

QUnit.test(
	"unknown route registration policy 'throw' rejects object form without partial registration",
	function (assert: Assert) {
		recreateRouter({ unknownRouteGuardRegistration: "throw" });

		const enterGuard: GuardFn = () => true;
		const leaveGuard: LeaveGuardFn = () => true;
		assert.throws(
			() => router.addRouteGuard("missing", { beforeEnter: enterGuard, beforeLeave: leaveGuard }),
			/unknown route "missing"/,
			"Object-form registration throws synchronously",
		);

		const enterGuards = Reflect.get(router, "_enterGuards") as Map<string, GuardFn[]>;
		const leaveGuards = Reflect.get(router, "_leaveGuards") as Map<string, LeaveGuardFn[]>;
		assert.notOk(enterGuards.has("missing"), "Enter guard was not partially registered");
		assert.notOk(leaveGuards.has("missing"), "Leave guard was not partially registered");
	},
);

QUnit.test("addRouteGuard ignores invalid runtime guard input", async function (assert: Assert) {
	addRouteGuardUnsafe(router, "protected", null);
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(HashChanger.getInstance().getHash(), "protected", "Invalid runtime guard input was ignored");
});

QUnit.test("addRouteGuard object form ignores invalid leave guard input", async function (assert: Assert) {
	const warnings = await captureWarningsAsync(async () => {
		addRouteGuardUnsafe(router, "protected", {
			beforeLeave: "nope",
		});

		router.initialize();
		await waitForRoute(router, "home");
		router.navTo("protected");
		await waitForRoute(router, "protected");
		router.navTo("home");
		await waitForRoute(router, "home");
	});

	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Invalid leave guard input was ignored");
	assert.strictEqual(warnings.length, 1, "One warning was logged");
	assert.strictEqual(
		warnings[0]?.message,
		"addRouteGuard called with invalid guard, ignoring",
		"Warning names the addRouteGuard object-form entrypoint",
	);
	assert.strictEqual(warnings[0]?.details, "protected", "Warning includes the route name");
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

	await router.navigationSettled();
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

	await router.navigationSettled();
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
	await router.navigationSettled();
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

	await waitForRoute(router, "detail");
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

	await waitForRoute(router, "detail");
	assert.strictEqual(matchedRoutes.length, 1, "Only one navigation settled");
	assert.strictEqual(matchedRoutes[0], "detail", "The last navigation won");
});

// ============================================================
// Module: Returning to current route during pending guard
// ============================================================
QUnit.module("Router - Returning to current route during pending guard", standardHooks);

QUnit.test("Navigating back to current route cancels a pending async guard", async function (assert: Assert) {
	let guardResolved = false;
	const guardDone = new Promise<void>((resolve) => {
		router.addRouteGuard("protected", async () => {
			await nextTick(200);
			guardResolved = true;
			resolve();
			return true;
		});
	});
	router.initialize();
	await waitForRoute(router, "home");

	let protectedMatched = false;
	router.getRoute("protected")!.attachPatternMatched(() => {
		protectedMatched = true;
	});

	// Navigate to protected (triggers slow async guard)
	router.navTo("protected");

	// While guard is pending, navigate back to home (same-hash dedup cancels preflight).
	// With navTo preflight, the hash never changed to "protected", so
	// HashChanger.setHash("") would be a no-op. Use navTo("home") to
	// exercise the same-hash dedup in the navTo override.
	await nextTick(10);
	router.navTo("home");

	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Cancelled, "Navigation was cancelled");

	// Wait for the guard to actually finish its async work
	await guardDone;
	assert.ok(guardResolved, "Guard did resolve its async work");
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

	await router.navigationSettled();
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

	// Navigate back to current route while guard is pending.
	// With navTo preflight, the hash never changed to "protected", so
	// HashChanger.setHash("") would be a no-op. Use navTo("home") to
	// exercise the same-hash dedup.
	router.navTo("home");
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
	// the leave guard again because _redirecting bypasses all guards
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

QUnit.test("Resolves with 'bypassed' for unmatched hash without guards", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	HashChanger.getInstance().setHash("some/unknown/path");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Bypassed, "Unmatched hash settles as bypassed");
	assert.strictEqual(result.route, "", "Route is empty when no route matched");
	assert.strictEqual(result.hash, "some/unknown/path", "Hash is the attempted unmatched hash");
});

QUnit.test("Resolves with 'bypassed' when leave guard allows unmatched hash", async function (assert: Assert) {
	router.addLeaveGuard("home", () => true);
	router.initialize();
	await waitForRoute(router, "home");

	HashChanger.getInstance().setHash("some/unknown/path");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Bypassed, "Allowed unmatched hash settles as bypassed");
	assert.strictEqual(result.route, "", "Route is empty when no route matched");
	assert.strictEqual(result.hash, "some/unknown/path", "Hash is the attempted unmatched hash");
});

QUnit.test("Unmatched hash settles as 'bypassed' and still fires UI5 bypassed event", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	const bypassedEventPromise = new Promise<string>((resolve) => {
		const onBypassed = (event: Router$BypassedEvent) => {
			resolve(event.getParameter("hash") as string);
		};
		router.attachBypassed(onBypassed);
	});

	HashChanger.getInstance().setHash("some/unknown/path");
	const [result, bypassedHash] = await Promise.all([router.navigationSettled(), bypassedEventPromise]);

	assert.strictEqual(result.status, NavigationOutcome.Bypassed, "Settlement reports bypassed");
	assert.strictEqual(result.route, "", "Settlement route is empty");
	assert.strictEqual(result.hash, "some/unknown/path", "Settlement hash is the unmatched hash");
	assert.strictEqual(bypassedHash, "some/unknown/path", "UI5 bypassed event still fires with the same hash");
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

QUnit.test("Idle replay returns the most recent settlement, not a stale one", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	// First: blocked
	router.navTo("protected");
	await router.navigationSettled();

	// Second: committed (overrides _lastSettlement)
	router.navTo("forbidden");
	await router.navigationSettled();

	// Idle replay should return the latest (committed), not the earlier (blocked)
	const replay = await router.navigationSettled();
	assert.strictEqual(replay.status, NavigationOutcome.Committed, "Replay returns latest settlement");
	assert.strictEqual(replay.route, "forbidden", "Replay route is from latest navigation");
});

QUnit.test("Idle replay after bypassed returns bypassed status", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	HashChanger.getInstance().setHash("some/unknown/path");
	const first = await router.navigationSettled();
	const second = await router.navigationSettled();

	assert.strictEqual(first.status, NavigationOutcome.Bypassed, "First call returns bypassed");
	assert.strictEqual(second.status, NavigationOutcome.Bypassed, "Idle replay returns bypassed");
	assert.strictEqual(second.route, "", "Idle replay keeps empty route");
	assert.strictEqual(second.hash, "some/unknown/path", "Idle replay keeps unmatched hash");
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

QUnit.test("Idle call after stop returns synthetic committed with empty state", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await router.navigationSettled();
	router.stop();

	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "Idle fallback uses committed status");
	assert.strictEqual(result.route, "", "Idle fallback clears the route after stop()");
	assert.strictEqual(result.hash, "", "Idle fallback clears the hash after stop()");
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

	// Navigate back to current hash -- cancels without starting a new pipeline.
	// With navTo preflight, the hash never changed, so use navTo("home") for
	// same-hash dedup cancellation.
	router.navTo("home");

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
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"",
		"Browser hash unchanged (preflight blocked before hash update)",
	);
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

// ============================================================
// Module: Restore and settlement invariants
// ============================================================
QUnit.module("Router - Restore and settlement invariants", standardHooks);

QUnit.test("Blocked setHash restores hash through a single suppressed parse cycle", async function (assert: Assert) {
	let guardCalls = 0;
	let matched = false;

	router.addRouteGuard("protected", () => {
		guardCalls++;
		return false;
	});
	router.initialize();
	await waitForRoute(router, "home");

	const flushSpy = sinon.spy(router as unknown as { _flushSettlement: () => void }, "_flushSettlement");
	router.getRoute("protected")!.attachPatternMatched(() => {
		matched = true;
	});

	try {
		// Use setHash to go through the parse() path where the hash actually
		// changes before guards run. This exercises _restoreHash and the
		// suppressed parse cycle that undoes the hash change.
		HashChanger.getInstance().setHash("protected");
		const result = await router.navigationSettled();
		await nextTick();

		assert.strictEqual(result.status, NavigationOutcome.Blocked, "Navigation settled as blocked");
		assert.strictEqual(result.route, "home", "Current route stayed on home");
		assert.strictEqual(result.hash, "", "Settlement hash stayed on the previous hash");
		assert.strictEqual(HashChanger.getInstance().getHash(), "", "Browser hash was restored to the previous value");
		assert.strictEqual(guardCalls, 1, "Guard pipeline ran exactly once for the blocked navigation");
		assert.notOk(matched, "Suppressed restore parse did not fire patternMatched on the blocked target");
		assert.strictEqual(flushSpy.callCount, 1, "Suppressed restore parse did not emit a second settlement");
	} finally {
		flushSpy.restore();
	}
});

// ============================================================
// Module: Destroy during redirect
// ============================================================
QUnit.module("Router - Destroy during redirect", safeDestroyHooks);

QUnit.test(
	"Destroying router while async guard is evaluating a redirect does not throw",
	async function (assert: Assert) {
		router.addRouteGuard("protected", async () => {
			await nextTick(50);
			return "forbidden"; // redirect
		});
		router.initialize();
		await waitForRoute(router, "home");

		router.navTo("protected");
		await nextTick(10); // guard still pending (50ms)
		router.destroy();

		// Wait for the guard promise to resolve in the background
		await nextTick(200);
		assert.ok(true, "No errors thrown after destroy during pending redirect");
	},
);

QUnit.test("Destroy during redirect settles pending navigationSettled as cancelled", async function (assert: Assert) {
	router.addRouteGuard("protected", async () => {
		await nextTick(100);
		return "forbidden"; // redirect
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const settledPromise = router.navigationSettled();
	await nextTick(10); // guard still pending (100ms)
	router.destroy();

	const result = await settledPromise;
	assert.strictEqual(
		result.status,
		NavigationOutcome.Cancelled,
		"Settlement is cancelled on destroy during redirect",
	);
});

// ============================================================
// Module: navigationSettled after destroy
// ============================================================
QUnit.module("Router - navigationSettled after destroy", safeDestroyHooks);

QUnit.test("navigationSettled called after destroy resolves immediately", async function (assert: Assert) {
	router.addRouteGuard("protected", () => true);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await router.navigationSettled();
	router.destroy();

	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "Returns default Committed status");
	assert.strictEqual(result.route, "protected", "Route reflects last committed navigation");
	assert.strictEqual(result.hash, "protected", "Hash reflects last committed navigation");
});

QUnit.test("navigationSettled resolves for pending navigation when destroy is called", async function (assert: Assert) {
	router.addRouteGuard("protected", async () => {
		await nextTick(200);
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const settledPromise = router.navigationSettled();
	await nextTick(10); // guard still pending (200ms)
	router.destroy();

	const result = await settledPromise;
	assert.strictEqual(
		result.status,
		NavigationOutcome.Cancelled,
		"Pending settlement resolved as cancelled on destroy",
	);
});

// ============================================================
// Module: Guard error after signal abort
// ============================================================
QUnit.module("Router - Guard error after signal abort", standardHooks);

QUnit.test(
	"Enter guard rejecting after signal abort does not produce unhandled rejection",
	async function (assert: Assert) {
		const unhandledRejections: PromiseRejectionEvent[] = [];
		const rejectionHandler = (event: PromiseRejectionEvent): void => {
			unhandledRejections.push(event);
		};
		window.addEventListener("unhandledrejection", rejectionHandler);

		router.addGuard(async (context: GuardContext) => {
			await new Promise<void>((resolve, reject) => {
				context.signal.addEventListener("abort", () => {
					reject(new Error("Resource cleanup failed"));
				});
				setTimeout(resolve, 200);
			});
			return true;
		});
		router.initialize();
		await waitForRoute(router, "home");

		// Start navigation (guard waits 200ms)
		router.navTo("protected");
		// Supersede after 10ms -- aborts signal, guard rejects
		await nextTick(10);
		router.navTo("forbidden");
		await waitForRoute(router, "forbidden");

		// Allow time for any stale rejection to surface
		await nextTick(300);
		window.removeEventListener("unhandledrejection", rejectionHandler);
		assert.strictEqual(unhandledRejections.length, 0, "No unhandled rejections from guard error after abort");
	},
);

QUnit.test(
	"Leave guard rejecting after signal abort does not produce unhandled rejection",
	async function (assert: Assert) {
		const unhandledRejections: PromiseRejectionEvent[] = [];
		const rejectionHandler = (event: PromiseRejectionEvent): void => {
			unhandledRejections.push(event);
		};
		window.addEventListener("unhandledrejection", rejectionHandler);

		router.addLeaveGuard(
			"home",
			async (context: GuardContext) =>
				new Promise<boolean>((resolve, reject) => {
					context.signal.addEventListener("abort", () => {
						reject(new Error("Leave guard cleanup error"));
					});
					setTimeout(() => resolve(true), 200);
				}),
		);
		router.initialize();
		await waitForRoute(router, "home");

		// Navigate to protected (triggers leave guard on home, waits 200ms)
		router.navTo("protected");
		// Supersede after 10ms -- aborts signal, leave guard rejects
		await nextTick(10);
		router.navTo("forbidden");

		await router.navigationSettled();
		// Allow the stale leave guard promise (200ms timeout) to reject
		await nextTick(250);
		window.removeEventListener("unhandledrejection", rejectionHandler);
		assert.strictEqual(unhandledRejections.length, 0, "No unhandled rejections from leave guard error after abort");
	},
);

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
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Browser hash was restored");
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
		router.addLeaveGuard("home", async () => {
			await nextTick(10);
			return true;
		});
		router.addRouteGuard("protected", async () => {
			await nextTick(10);
			return "forbidden";
		});
		router.initialize();
		await waitForRoute(router, "home");

		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Redirected, "Leave allowed + enter redirect = redirected");
		assert.strictEqual(result.route, "forbidden", "Route is redirect target");
	},
);

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

QUnit.test("Redirect target's own guard is bypassed by _redirecting flag", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(
		result.status,
		NavigationOutcome.Redirected,
		"Redirect committed despite target's blocking guard",
	);
	assert.strictEqual(result.route, "forbidden", "Landed on forbidden (guard was bypassed)");
});

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
		const originalNavTo = Reflect.get(router, "navTo") as (...args: unknown[]) => unknown;
		let homePatternMatched = 0;

		router.getRoute("home")!.attachPatternMatched(() => {
			homePatternMatched++;
		});

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

// _restoreHash pairs: same guard scenario, setHash (parse path) vs navTo (preflight).
// Parse path: hash already changed, _restoreHash needed to undo it.
// Preflight: hash never changed, _restoreHash must be skipped.

QUnit.test("blocked via setHash calls _restoreHash", async function (assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	const restoreSpy = sinon.spy(router as unknown as { _restoreHash: () => void }, "_restoreHash");
	try {
		HashChanger.getInstance().setHash("protected");
		await router.navigationSettled();
		assert.strictEqual(restoreSpy.callCount, 1, "_restoreHash called to undo hash change");
	} finally {
		restoreSpy.restore();
	}
});

QUnit.test("blocked via navTo does not call _restoreHash", async function (assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	const restoreSpy = sinon.spy(router as unknown as { _restoreHash: () => void }, "_restoreHash");
	try {
		router.navTo("protected");
		await router.navigationSettled();
		assert.strictEqual(restoreSpy.callCount, 0, "_restoreHash skipped - hash never changed");
	} finally {
		restoreSpy.restore();
	}
});

QUnit.test("rejected async guard via navTo does not call _restoreHash", async function (assert) {
	router.addRouteGuard("protected", () => Promise.reject(new Error("guard error")));
	router.initialize();
	await waitForRoute(router, "home");

	const hashBefore = getHash();
	const restoreSpy = sinon.spy(router as unknown as { _restoreHash: () => void }, "_restoreHash");
	try {
		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(restoreSpy.callCount, 0, "_restoreHash skipped - hash never changed");
		assert.strictEqual(result.status, NavigationOutcome.Blocked, "Rejected guard settles as Blocked");
		assert.strictEqual(getHash(), hashBefore, "Hash unchanged after rejected async preflight guard");
	} finally {
		restoreSpy.restore();
	}
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

QUnit.test("redirect to nonexistent via setHash calls _restoreHash", async function (assert) {
	router.addRouteGuard("protected", () => "nonExistentRoute");
	router.initialize();
	await waitForRoute(router, "home");

	const restoreSpy = sinon.spy(router as unknown as { _restoreHash: () => void }, "_restoreHash");
	try {
		HashChanger.getInstance().setHash("protected");
		await router.navigationSettled();
		assert.ok(restoreSpy.callCount >= 1, "_restoreHash called to undo hash change");
	} finally {
		restoreSpy.restore();
	}
});

QUnit.test("redirect to nonexistent via navTo does not call _restoreHash", async function (assert) {
	router.addRouteGuard("protected", () => "nonExistentRoute");
	router.initialize();
	await waitForRoute(router, "home");

	const restoreSpy = sinon.spy(router as unknown as { _restoreHash: () => void }, "_restoreHash");
	try {
		router.navTo("protected");
		await router.navigationSettled();
		assert.strictEqual(restoreSpy.callCount, 0, "_restoreHash skipped - hash never changed");
	} finally {
		restoreSpy.restore();
	}
});

QUnit.test("async redirect to nonexistent via navTo does not call _restoreHash", async function (assert) {
	router.addRouteGuard("protected", () => Promise.resolve("nonExistentRoute" as const));
	router.initialize();
	await waitForRoute(router, "home");

	const restoreSpy = sinon.spy(router as unknown as { _restoreHash: () => void }, "_restoreHash");
	try {
		router.navTo("protected");
		await router.navigationSettled();
		assert.strictEqual(restoreSpy.callCount, 0, "_restoreHash skipped - hash never changed");
	} finally {
		restoreSpy.restore();
	}
});

QUnit.module("Router - navTo options", standardHooks);

QUnit.test("navToPreflight 'bypass' skips guards for programmatic navTo", async function (assert) {
	recreateRouter({ navToPreflight: "bypass" });

	let guardCallCount = 0;
	router.addRouteGuard("protected", () => {
		guardCallCount++;
		return false;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Committed, "Programmatic navTo committed");
	assert.strictEqual(result.route, "protected", "Navigation reached the target route");
	assert.strictEqual(getHash(), "protected", "Hash updated to protected");
	assert.strictEqual(guardCallCount, 0, "Route guard did not run for bypassed navTo");
});

QUnit.test("navToPreflight 'bypass' still guards browser-driven hash changes", async function (assert) {
	recreateRouter({ navToPreflight: "bypass" });

	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	HashChanger.getInstance().setHash("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Browser hash change is still blocked");
	assert.strictEqual(result.route, "home", "Router stays on the current route");
	assert.strictEqual(getHash(), "", "Hash was restored to the previous route");
});

QUnit.test("navToPreflight 'off' defers programmatic navTo to parse fallback", async function (assert) {
	recreateRouter({ navToPreflight: "off" });

	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	const restoreSpy = sinon.spy(router as unknown as { _restoreHash: () => void }, "_restoreHash");
	try {
		router.navTo("protected");
		const result = await router.navigationSettled();

		assert.strictEqual(result.status, NavigationOutcome.Blocked, "Blocked navigation settled via parse");
		assert.strictEqual(restoreSpy.callCount, 1, "Hash restoration ran on the parse path");
		assert.strictEqual(getHash(), "", "Hash restored after blocked navigation");
	} finally {
		restoreSpy.restore();
	}
});

QUnit.test("skipGuards overrides default preflight via the replace overload", async function (assert) {
	router.initialize();
	await waitForRoute(router, "home");
	router.addGuard(() => false);

	router.navTo("detail", { id: "42" }, true, { skipGuards: true });
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Committed, "Navigation committed");
	assert.strictEqual(result.route, "detail", "Detail route became active");
	assert.strictEqual(getHash(), "detail/42", "Hash contains route parameters");
});

QUnit.test("skipGuards overrides navToPreflight 'off' via the full overload", async function (assert) {
	recreateRouter({ navToPreflight: "off" });

	router.initialize();
	await waitForRoute(router, "home");
	router.addGuard(() => false);

	const restoreSpy = sinon.spy(router as unknown as { _restoreHash: () => void }, "_restoreHash");
	try {
		router.navTo("forbidden", {}, {}, true, { skipGuards: true });
		const result = await router.navigationSettled();

		assert.strictEqual(result.status, NavigationOutcome.Committed, "Per-call bypass committed");
		assert.strictEqual(result.route, "forbidden", "Target route became active");
		assert.strictEqual(getHash(), "forbidden", "Hash updated to forbidden");
		assert.strictEqual(restoreSpy.callCount, 0, "Parse fallback did not restore the hash");
	} finally {
		restoreSpy.restore();
	}
});

QUnit.test(
	"combined ignore + bypass config keeps registration silent and bypasses navTo guards",
	async function (assert) {
		recreateRouter({
			unknownRouteGuardRegistration: "ignore",
			navToPreflight: "bypass",
		});

		const warnings: Array<{ message: string; details?: string }> = [];
		const originalWarning = Log.warning;
		Log.warning = (message: string, details?: string) => {
			warnings.push({ message, details });
		};

		try {
			router.addRouteGuard("missing", () => true);
			router.addRouteGuard("protected", () => false);
		} finally {
			Log.warning = originalWarning;
		}

		router.initialize();
		await waitForRoute(router, "home");

		router.navTo("protected");
		const result = await router.navigationSettled();

		assert.strictEqual(warnings.length, 0, "Unknown route registration stayed silent");
		assert.strictEqual(result.status, NavigationOutcome.Committed, "Programmatic navTo bypassed guards");
		assert.strictEqual(result.route, "protected", "Navigation reached protected");
	},
);

QUnit.test("combined throw + off config throws on registration and still uses parse fallback", async function (assert) {
	recreateRouter({
		unknownRouteGuardRegistration: "throw",
		navToPreflight: "off",
	});

	assert.throws(
		() => router.addLeaveGuard("missing", () => true),
		/unknown route "missing"/,
		"Unknown route registration threw under the combined config",
	);

	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	const restoreSpy = sinon.spy(router as unknown as { _restoreHash: () => void }, "_restoreHash");
	try {
		router.navTo("protected");
		const result = await router.navigationSettled();

		assert.strictEqual(result.status, NavigationOutcome.Blocked, "Blocked navigation still used parse fallback");
		assert.strictEqual(restoreSpy.callCount, 1, "Parse fallback restored the hash");
		assert.strictEqual(getHash(), "", "Hash restored to home");
	} finally {
		restoreSpy.restore();
	}
});

QUnit.module("Router - navigationSettled event", standardHooks);

QUnit.test("fires on committed navigation", async function (assert) {
	const events: { status: string; route: string; hash: string }[] = [];
	router.attachNavigationSettled((event) => {
		events.push({
			status: event.getParameter("status") as string,
			route: event.getParameter("route") as string,
			hash: event.getParameter("hash") as string,
		});
	});
	router.initialize();
	await waitForRoute(router, "home");

	assert.strictEqual(events.length, 1, "Event fired once");
	assert.strictEqual(events[0].status, NavigationOutcome.Committed, "Status is Committed");
	assert.strictEqual(events[0].route, "home", "Route is home");
});

QUnit.test("fires on blocked navigation", async function (assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	const events: { status: string; route: string }[] = [];
	router.attachNavigationSettled((event) => {
		events.push({
			status: event.getParameter("status") as string,
			route: event.getParameter("route") as string,
		});
	});

	router.navTo("protected");
	await router.navigationSettled();

	assert.strictEqual(events.length, 1, "Event fired once for blocked navigation");
	assert.strictEqual(events[0].status, NavigationOutcome.Blocked, "Status is Blocked");
	assert.strictEqual(events[0].route, "home", "Route stays home");
});

QUnit.test("fires on redirected navigation", async function (assert) {
	router.addRouteGuard("protected", () => "home");
	router.initialize();
	await waitForRoute(router, "home");

	const events: { status: string }[] = [];
	router.attachNavigationSettled((event) => {
		events.push({ status: event.getParameter("status") as string });
	});

	router.navTo("protected");
	await router.navigationSettled();

	assert.ok(
		events.some((e) => e.status === NavigationOutcome.Redirected),
		"At least one event has Redirected status",
	);
});

QUnit.test("fires on cancelled navigation", async function (assert) {
	router.addGuard(() => new Promise<boolean>((r) => setTimeout(() => r(true), 100)));
	router.initialize();
	await waitForRoute(router, "home");

	const events: { status: string }[] = [];
	router.attachNavigationSettled((event) => {
		events.push({ status: event.getParameter("status") as string });
	});

	router.navTo("protected");
	router.navTo("home"); // cancels first

	await router.navigationSettled();

	assert.ok(
		events.some((e) => e.status === NavigationOutcome.Cancelled),
		"Cancelled event fired",
	);
});

QUnit.test("fires on bypassed navigation", async function (assert) {
	router.initialize();
	await waitForRoute(router, "home");

	const events: { status: string; route: string; hash: string }[] = [];
	router.attachNavigationSettled((event) => {
		events.push({
			status: event.getParameter("status") as string,
			route: event.getParameter("route") as string,
			hash: event.getParameter("hash") as string,
		});
	});

	HashChanger.getInstance().setHash("nonexistent/route/that/matches/nothing");
	await router.navigationSettled();

	assert.strictEqual(events.length, 1, "Event fired once for bypassed navigation");
	assert.strictEqual(events[0].status, NavigationOutcome.Bypassed, "Status is Bypassed");
	assert.strictEqual(events[0].route, "", "Route is empty for bypassed");
});

QUnit.test("detachNavigationSettled stops delivery", async function (assert) {
	const events: string[] = [];
	const oListener = {};
	const handler = (event: Router$NavigationSettledEvent) => {
		events.push(event.getParameter("status") as string);
	};

	router.attachNavigationSettled(handler, oListener);
	router.initialize();
	await waitForRoute(router, "home");
	assert.strictEqual(events.length, 1, "Handler received initial settlement");

	router.detachNavigationSettled(handler, oListener);

	router.navTo("forbidden");
	await router.navigationSettled();
	assert.strictEqual(events.length, 1, "Handler no longer receives events after detach");
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
	// Bug: _flushSettlement fires the navigationSettled event synchronously while
	// _redirecting=true. Any navTo() from that handler sees _redirecting=true and
	// calls super.navTo() directly, bypassing the guard pipeline.
	router.addRouteGuard("forbidden", () => "home");
	router.addGuard((ctx: GuardContext) => ctx.toRoute === "home");

	router.initialize();
	await waitForRoute(router, "home");

	let nestedNavFired = false;
	const handler = (evt: Router$NavigationSettledEvent): void => {
		if (evt.getParameter("status") === NavigationOutcome.Redirected && !nestedNavFired) {
			nestedNavFired = true;
			// This fires synchronously during _flushSettlement while _redirecting=true.
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
// Module: Async leave guard abort check before enter phase
// ============================================================
QUnit.module("Router - Async leave guard abort check before enter phase", standardHooks);

QUnit.test(
	"enter guards do not run for superseded navigation after async leave guard resolves",
	async function (assert: Assert) {
		let enterGuardCalledWhileAborted = false;

		router.initialize();
		await waitForRoute(router, "home");

		// Async leave guard that resolves after manual trigger.
		// Track each promise so we can resolve the first (superseded) one.
		const leaveResolvers: Array<(value: boolean) => void> = [];
		router.addLeaveGuard(
			"home",
			() =>
				new Promise<boolean>((resolve) => {
					leaveResolvers.push(resolve);
				}),
		);

		// Enter guard on "protected" that tracks if it was called with an aborted signal
		router.addRouteGuard("protected", (ctx: GuardContext) => {
			if (ctx.signal.aborted) {
				enterGuardCalledWhileAborted = true;
			}
			return true;
		});

		// Start navigating to "protected" -- triggers async leave guard (leaveResolvers[0])
		router.navTo("protected");

		// Supersede: navigate via setHash so we bypass the leave guard path entirely
		// and land directly on "forbidden" through parse().
		// This cancels the first navigation's pipeline.
		HashChanger.getInstance().setHash("forbidden");
		// Resolve the second leave guard so "forbidden" can commit
		leaveResolvers[1](true);
		await waitForRoute(router, "forbidden");

		// Now resolve the FIRST (superseded) leave guard.
		// The enter guard for "protected" should NOT fire because the signal is aborted.
		leaveResolvers[0](true);
		await nextTick();

		assert.notOk(
			enterGuardCalledWhileAborted,
			"Enter guard was not called with an aborted signal for the superseded navigation",
		);
	},
);

// ============================================================
// Module: detachNavigationSettled oListener optional
// ============================================================
QUnit.module("Router - detachNavigationSettled oListener optional", standardHooks);

QUnit.test(
	"detachNavigationSettled works without oListener when attached without one",
	async function (assert: Assert) {
		const events: string[] = [];

		const handler = (event: Router$NavigationSettledEvent) => {
			events.push(event.getParameter("status") as string);
		};

		router.attachNavigationSettled(handler);
		router.initialize();
		await waitForRoute(router, "home");
		assert.strictEqual(events.length, 1, "Handler received initial settlement");

		// Detach without oListener -- this should compile and work at runtime
		(router as GuardRouter).detachNavigationSettled(handler);

		router.navTo("forbidden");
		await router.navigationSettled();
		assert.strictEqual(events.length, 1, "Handler no longer receives events after detach without oListener");
	},
);
