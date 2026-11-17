import sinon from "sinon";
import Log from "sap/base/Log";
import DataType from "sap/ui/base/DataType";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardFn, GuardRouter, LeaveGuardFn } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { Router$RouteMatchedEvent } from "sap/ui/core/routing/Router";
import type { Route$PatternMatchedEvent } from "sap/ui/core/routing/Route";
import {
	addGuardUnsafe,
	addLeaveGuardUnsafe,
	addRouteGuardUnsafe,
	assertBlocked,
	callUnsafe,
	captureWarnings,
	captureWarningsAsync,
	createRouter,
	flushPromises,
	initHashChanger,
	removeGuardUnsafe,
	removeLeaveGuardUnsafe,
	removeRouteGuardUnsafe,
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

QUnit.test("NavigationOutcome values are the documented strings", function (assert: Assert) {
	assert.deepEqual(
		{ ...NavigationOutcome },
		{
			Committed: "committed",
			Bypassed: "bypassed",
			Blocked: "blocked",
			Redirected: "redirected",
			Cancelled: "cancelled",
			Error: "error",
		},
		"Apps comparing against the string values keep working",
	);
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
QUnit.module("Router - Guard API", standardHooks);

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

QUnit.test("addGuard and addRouteGuard return this for chaining", function (assert: Assert) {
	assert.strictEqual(
		router.addGuard(() => true),
		router,
		"addGuard returns this",
	);
	assert.strictEqual(
		router.addRouteGuard("home", () => true),
		router,
		"addRouteGuard returns this",
	);
});

QUnit.test(
	"addRouteGuard warns for unknown route but guard runs after route is added",
	async function (assert: Assert) {
		let guardCalled = false;
		const guard: GuardFn = () => {
			guardCalled = true;
			return true;
		};
		const warnings = captureWarnings(() => {
			router.addRouteGuard("missing", guard);
		});

		assert.strictEqual(warnings.length, 1, "One warning was logged");
		assert.strictEqual(
			warnings[0]?.message,
			"addRouteGuard: unknown route, guard registered anyway",
			"Warning message explains the non-blocking behavior",
		);
		assert.strictEqual(warnings[0]?.details, "missing", "Warning includes the route name");

		router.addRoute({ name: "missing", pattern: "missing" });
		router.initialize();
		router.navTo("missing");
		await router.navigationSettled();
		assert.ok(guardCalled, "Guard registered for unknown route runs after route is added");
	},
);

QUnit.test(
	"addRouteGuard object form warns once for unknown route and both guards run after route is added",
	async function (assert: Assert) {
		let enterCalled = false;
		let leaveCalled = false;
		const enterGuard: GuardFn = () => {
			enterCalled = true;
			return true;
		};
		const leaveGuard: LeaveGuardFn = () => {
			leaveCalled = true;
			return true;
		};
		const warnings = captureWarnings(() => {
			router.addRouteGuard("missing", { beforeEnter: enterGuard, beforeLeave: leaveGuard });
		});

		assert.deepEqual(
			warnings.map((w) => [w.message, w.details]),
			[["addRouteGuard: unknown route, guard registered anyway", "missing"]],
			"Object form logs only one warning, naming addRouteGuard and the route",
		);

		router.addRoute({ name: "missing", pattern: "missing" });
		router.initialize();

		router.navTo("missing");
		await router.navigationSettled();
		assert.ok(enterCalled, "Enter guard registered for unknown route runs");

		router.navTo("home");
		await router.navigationSettled();
		assert.ok(leaveCalled, "Leave guard registered for unknown route runs when leaving");
	},
);

QUnit.test(
	"addLeaveGuard warns for unknown route but guard runs after route is added",
	async function (assert: Assert) {
		let guardCalled = false;
		const guard: LeaveGuardFn = () => {
			guardCalled = true;
			return true;
		};
		const warnings = captureWarnings(() => {
			router.addLeaveGuard("missing", guard);
		});

		assert.strictEqual(warnings.length, 1, "One warning was logged");
		assert.strictEqual(
			warnings[0]?.message,
			"addLeaveGuard: unknown route, guard registered anyway",
			"Warning message explains the non-blocking behavior",
		);
		assert.strictEqual(warnings[0]?.details, "missing", "Warning includes the route name");

		router.addRoute({ name: "missing", pattern: "missing" });
		router.initialize();

		router.navTo("missing");
		await router.navigationSettled();

		router.navTo("home");
		await router.navigationSettled();
		assert.ok(guardCalled, "Leave guard registered for unknown route runs when leaving");
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
		"addRouteGuard: not a function, ignoring",
		"Warning names the addRouteGuard object-form entrypoint",
	);
	assert.strictEqual(warnings[0]?.details, "protected", "Warning includes the route name");
});

QUnit.test("guard API methods ignore non-function input", async function (assert: Assert) {
	// addGuard ignores non-function input
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
	router.destroy();

	// removeGuard ignores non-function input
	router = createRouter();
	initHashChanger();
	const guard: GuardFn = () => false;
	router.addGuard(guard);
	removeGuardUnsafe(router, null);
	removeGuardUnsafe(router, "not a function");
	router.initialize();
	await assertBlocked(
		assert,
		router,
		() => router.navTo("protected"),
		"Guard still blocks after invalid removeGuard calls",
	);
	router.destroy();

	// addLeaveGuard ignores non-function input
	router = createRouter();
	initHashChanger();
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
	router.destroy();

	// removeLeaveGuard ignores non-function input
	router = createRouter();
	initHashChanger();
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
	router.destroy();

	// removeRouteGuard ignores non-function input
	router = createRouter();
	initHashChanger();
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

QUnit.test("removing never-added guards leaves registered guards intact", async function (assert: Assert) {
	router.addGuard((context) => context.toRoute !== "forbidden");
	router.addRouteGuard("protected", () => false);
	router.addLeaveGuard("home", (context) => context.toRoute !== "detail");
	const neverAddedGuard: GuardFn = () => false;
	const neverAddedLeave: LeaveGuardFn = () => false;
	router.removeGuard(neverAddedGuard);
	router.removeRouteGuard("protected", neverAddedGuard);
	router.removeLeaveGuard("home", neverAddedLeave);
	router.initialize();
	await waitForRoute(router, "home");

	await assertBlocked(assert, router, () => router.navTo("forbidden"), "Global guard still registered");
	await assertBlocked(assert, router, () => router.navTo("protected"), "Route guard still registered");
	await assertBlocked(assert, router, () => router.navTo("detail", { id: "1" }), "Leave guard still registered");
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

QUnit.test("each guard API method warns under its own name for non-function input", function (assert: Assert) {
	const warnings = captureWarnings(() => {
		addGuardUnsafe(router, null);
		removeGuardUnsafe(router, null);
		addRouteGuardUnsafe(router, "home", null);
		addRouteGuardUnsafe(router, "home", { beforeEnter: "nope" });
		removeRouteGuardUnsafe(router, "home", null);
		addLeaveGuardUnsafe(router, "home", null);
		removeLeaveGuardUnsafe(router, "home", null);
	});

	assert.deepEqual(
		warnings.map((w) => [w.message, w.details]),
		[
			["addGuard: not a function, ignoring", undefined],
			["removeGuard: not a function, ignoring", undefined],
			["addRouteGuard: not a function, ignoring", "home"],
			["addRouteGuard: not a function, ignoring", "home"],
			["removeRouteGuard: not a function, ignoring", "home"],
			["addLeaveGuard: not a function, ignoring", "home"],
			["removeLeaveGuard: not a function, ignoring", "home"],
		],
		"One warning per call, naming the method and the route",
	);
});

QUnit.test("addRouteGuard object form ignores invalid enter guard input", async function (assert: Assert) {
	captureWarnings(() => addRouteGuardUnsafe(router, "protected", { beforeEnter: "nope" }));
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	assert.strictEqual(
		(await router.navigationSettled()).status,
		NavigationOutcome.Committed,
		"Invalid enter guard input was not registered",
	);
});

QUnit.test("addRouteGuard logs an info only for a config without handlers", function (assert: Assert) {
	const info = sinon.stub(Log, "info");
	try {
		addRouteGuardUnsafe(router, "home", {});
		router.addRouteGuard("home", { beforeEnter: () => true });
		router.addRouteGuard("home", { beforeLeave: () => true });
	} finally {
		info.restore();
	}

	assert.deepEqual(
		info.args,
		[["addRouteGuard: config has no beforeEnter or beforeLeave", "home", "ui5.guard.router.Router"]],
		"One info for the empty config, under the router's log component",
	);
});

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

QUnit.test("destroy() twice does nothing the second time, like the base router", function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	router.destroy();
	assert.strictEqual(router.destroy(), router, "the second call returns the router and does not throw");
});

QUnit.test("destroy() destroys the base router and detaches it from hash changes", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");
	let protectedMatched = false;
	router.getRoute("protected")!.attachPatternMatched(() => {
		protectedMatched = true;
	});

	router.destroy();
	assert.notOk(router.isInitialized(), "the base router is no longer initialized");

	HashChanger.getInstance().setHash("protected");
	await flushPromises();
	assert.notOk(protectedMatched, "a hash change no longer reaches the router");
});

QUnit.test(
	"a hash change delivered to a destroyed router only warns, like the base router",
	async function (assert: Assert) {
		let guardCalls = 0;
		router.addGuard(() => {
			guardCalls++;
			return true;
		});
		router.initialize();
		await waitForRoute(router, "home");
		let settlements = 0;
		router.attachNavigationSettled(() => {
			settlements++;
		});
		guardCalls = 0;
		router.destroy();

		// UI5 can deliver a hash change to a router destroyed earlier in the same event.
		const warnings = captureWarnings(() => callUnsafe(router, "parse", "protected"));

		assert.strictEqual(warnings.length, 1, "one warning");
		assert.ok(/destroyed while the hash changed/.test(warnings[0].message), "the base router's warning");
		assert.strictEqual(guardCalls, 0, "no guard ran");
		assert.strictEqual(settlements, 0, "nothing settled");
	},
);

QUnit.test("destroy() clears route metadata", function (assert: Assert) {
	router.setRouteMeta("", { root: true });
	router.destroy();
	assert.deepEqual(router.getRouteMeta(""), {}, "metadata set before destroy() is gone");
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
