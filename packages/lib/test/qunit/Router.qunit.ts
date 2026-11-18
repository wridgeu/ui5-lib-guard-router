import Log from "sap/base/Log";
import DataType from "sap/ui/base/DataType";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardFn, GuardRouter, LeaveGuardFn, NavigationResult } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { Router$RouteMatchedEvent } from "sap/ui/core/routing/Router";
import type { Route$PatternMatchedEvent } from "sap/ui/core/routing/Route";
import {
	addGuardUnsafe,
	addLeaveGuardUnsafe,
	addRouteGuardUnsafe,
	assertBlocked,
	callUnsafe,
	captureHashWrites,
	captureWarnings,
	captureWarningsAsync,
	changeHashSilently,
	createRouter,
	flushPromises,
	getHash,
	GuardRouterClass,
	initHashChanger,
	recordSettlements,
	type SinonTestContext,
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
	const routes: (string | undefined)[] = [];
	router.attachBeforeRouteMatched((event) => {
		routes.push(event.getParameter("name"));
	});
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.deepEqual(routes, ["protected"], "beforeRouteMatched fired once, for the route");
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

QUnit.test(
	"addRouteGuard logs an info only for a config without handlers",
	function (this: SinonTestContext, assert: Assert) {
		const info = this.stub(Log, "info");
		addRouteGuardUnsafe(router, "home", {});
		router.addRouteGuard("home", { beforeEnter: () => true });
		router.addRouteGuard("home", { beforeLeave: () => true });

		assert.deepEqual(
			info.args,
			[["addRouteGuard: config has no beforeEnter or beforeLeave", "home", "ui5.guard.router.Router"]],
			"One info for the empty config, under the router's log component",
		);
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
	const matched: (string | undefined)[] = [];
	router.attachRouteMatched((event: Router$RouteMatchedEvent) => {
		matched.push(event.getParameter("name"));
	});

	router.initialize();
	assert.ok(router.isInitialized(), "Router re-initialized");

	// Native router fires routeMatched on re-init; guard router must match.
	await waitForRoute(router, "home");
	assert.deepEqual(matched, ["home"], "Re-initialize fires routeMatched once for the current hash");
});

QUnit.test("the hash changer UI5 passes to the router of a nested component is used", async function (assert: Assert) {
	// createSubHashChanger() is protected in UI5: a component target calls it for its component.
	const subHashChanger = callUnsafe(router.getHashChanger(), "createSubHashChanger", "child") as object;
	router.destroy();
	try {
		// UIComponent passes it as fifth argument when the component is loaded as a routing target.
		router = Reflect.construct(GuardRouterClass, [
			[
				{ name: "home", pattern: "" },
				{ name: "protected", pattern: "protected" },
			],
			{ async: true },
			undefined,
			undefined,
			subHashChanger,
		]);
		assert.ok(router.getHashChanger() === subHashChanger, "the router uses the hash changer it was given");

		router.initialize();
		await waitForRoute(router, "home");
		router.navTo("protected");
		await waitForRoute(router, "protected");

		assert.strictEqual(callUnsafe(subHashChanger, "getHash"), "protected", "the route's hash is the nested one");
		assert.ok(
			getHash().endsWith("&/child/protected"),
			`the browser hash carries it under the prefix: "${getHash()}"`,
		);
	} finally {
		router.destroy();
		callUnsafe(subHashChanger, "destroy");
	}
});

QUnit.test("initialize(true) does not parse the current hash", async function (assert: Assert) {
	let guardCalls = 0;
	router.addGuard(() => {
		guardCalls++;
		return true;
	});
	HashChanger.getInstance().setHash("protected");
	const statuses = recordSettlements(router);

	router.initialize(true);
	await flushPromises();

	assert.ok(router.isInitialized(), "the router is initialized");
	assert.strictEqual(guardCalls, 0, "no guard ran for the initial hash");
	assert.deepEqual(statuses, [], "nothing settled");

	router.navTo("forbidden");
	await waitForRoute(router, "forbidden");
	assert.strictEqual(guardCalls, 1, "the router handles navigation from then on");
});

QUnit.test(
	"navTo() before initialize() only sets the hash, and its guards run when the router starts",
	async function (assert: Assert) {
		let matched = false;
		router.getRoute("protected")!.attachMatched(() => {
			matched = true;
		});
		const statuses = recordSettlements(router);

		router.navTo("protected");
		assert.strictEqual(getHash(), "protected", "the hash is set, as the native router does");
		assert.deepEqual(statuses, [], "nothing settled: the router does not handle navigation yet");

		// Registered after the navTo(), like a manifest guard that initialize() registers.
		router.addRouteGuard("protected", () => false);
		router.initialize();
		await waitForRoute(router, "home");

		assert.deepEqual(
			statuses,
			[NavigationOutcome.Blocked, NavigationOutcome.Committed],
			"the guard blocked the hash, then the router fell back to the empty hash",
		);
		assert.notOk(matched, "the guarded route was never displayed");
		assert.strictEqual(getHash(), "");
	},
);

QUnit.test("navTo() on a stopped router does nothing, like the native router", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");
	router.stop();

	let matched = false;
	router.getRoute("protected")!.attachMatched(() => {
		matched = true;
	});
	const statuses = recordSettlements(router);

	router.navTo("protected");
	await flushPromises();

	assert.deepEqual(statuses, [], "nothing settled");
	assert.notOk(matched, "the route was not displayed");
	assert.strictEqual(getHash(), "", "the hash is unchanged");
});

QUnit.test(
	"stop() and initialize(true) keep the route the user is on, as the native router does",
	async function (assert: Assert) {
		const leaveContexts: string[] = [];
		let allowLeave = false;
		router.addLeaveGuard("protected", (context) => {
			leaveContexts.push(`${context.fromRoute}|${context.fromHash}|${context.toRoute}`);
			return allowLeave;
		});
		router.addRouteGuard("detail", () => false);
		router.initialize();
		await waitForRoute(router, "home");
		router.navTo("protected");
		await waitForRoute(router, "protected");
		let homeMatched = false;
		router.getRoute("home")!.attachMatched(() => {
			homeMatched = true;
		});

		// What the Fiori launchpad does around a cross-app navigation that the user cancels.
		router.stop();
		// UI5 warns about a second stop(), which must not forget the route.
		captureWarnings(() => router.stop());
		router.initialize(true);
		assert.deepEqual(
			await router.navigationSettled(),
			{ status: NavigationOutcome.Committed, route: "protected", hash: "protected" },
			"the router is on the route it resumed",
		);
		const statuses = recordSettlements(router);

		router.navTo("forbidden");
		assert.deepEqual(leaveContexts, ["protected|protected|forbidden"], "the leave guard of that route runs");
		assert.deepEqual(statuses, [NavigationOutcome.Blocked], "and blocks");

		allowLeave = true;
		HashChanger.getInstance().setHash("detail/1");
		await flushPromises();
		assert.deepEqual(statuses, [NavigationOutcome.Blocked, NavigationOutcome.Blocked], "the enter guard blocks");
		assert.strictEqual(getHash(), "protected", "a blocked hash change goes back to the hash of that route");
		assert.notOk(homeMatched, "and not to the default route");
	},
);

QUnit.test("initialize(true) on a router that is running changes nothing", async function (assert: Assert) {
	let leaveCalls = 0;
	router.addLeaveGuard("protected", () => {
		leaveCalls++;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");
	router.navTo("protected");
	await waitForRoute(router, "protected");

	// UI5 warns and does nothing.
	captureWarnings(() => router.initialize(true));
	router.navTo("forbidden");
	await waitForRoute(router, "forbidden");

	assert.strictEqual(leaveCalls, 1, "the router is still on the route it was on");
});

QUnit.test(
	"a hash change blocked after a first initialize(true) restores the ignored hash",
	async function (assert: Assert) {
		router.addRouteGuard("forbidden", () => false);
		HashChanger.getInstance().setHash("protected");
		router.initialize(true);
		const statuses = recordSettlements(router);

		HashChanger.getInstance().setHash("forbidden");
		await flushPromises();

		assert.deepEqual(statuses, [NavigationOutcome.Blocked], "nothing but the block settles");
		assert.strictEqual(getHash(), "protected", "the URL is back on the hash the router started on");
	},
);

/**
 * What the Fiori launchpad does around a cross-app navigation that the user cancels in its
 * unsaved-data prompt: it stops the router, initializes it again while the URL still shows the
 * target, and then puts the URL back without a hash change event.
 */
async function cancelCrossAppNavigation(): Promise<void> {
	router.stop();
	await changeHashSilently((hasher) => hasher.setHash("forbidden"));
	router.initialize(true);
	await changeHashSilently((hasher) => hasher.replaceHash("protected"));
}

for (const { guard, register } of [
	{ guard: "leave guard", register: (): unknown => router.addLeaveGuard("protected", () => false) },
	{ guard: "enter guard", register: (): unknown => router.addRouteGuard("detail", () => false) },
]) {
	QUnit.test(
		`a hash change that a ${guard} blocks after a cancelled cross-app navigation returns to the URL as it was`,
		async function (assert: Assert) {
			router.initialize();
			await waitForRoute(router, "home");
			router.navTo("protected");
			await waitForRoute(router, "protected");
			await cancelCrossAppNavigation();
			register();
			const settlements: NavigationResult[] = [];
			router.attachNavigationSettled((event) => settlements.push(event.getParameters()));

			const hashChanger = HashChanger.getInstance();
			const writes = await captureHashWrites(hashChanger, () => hashChanger.setHash("detail/1"));

			assert.deepEqual(
				writes,
				["set:detail/1", "replace:protected"],
				"the entry is replaced with the hash that the URL showed before the change",
			);
			assert.deepEqual(
				settlements,
				[{ status: NavigationOutcome.Blocked, route: "protected", hash: "protected" }],
				"the navigation is blocked, and nothing else is navigated to",
			);
			assert.strictEqual(getHash(), "protected", "the URL is back");
		},
	);
}

QUnit.test(
	"a blocked hash change returns to a URL that had changed without a hash change event",
	async function (assert: Assert) {
		router.addRouteGuard("detail", () => false);
		router.initialize();
		await waitForRoute(router, "home");
		router.navTo("protected");
		await waitForRoute(router, "protected");
		router.stop();
		HashChanger.getInstance().setHash("forbidden");
		// The router resumes "protected" on the hash "forbidden", which the URL does not show for long.
		router.initialize(true);
		await changeHashSilently((hasher) => hasher.replaceHash("protected"));
		const settlements: NavigationResult[] = [];
		router.attachNavigationSettled((event) => settlements.push(event.getParameters()));

		HashChanger.getInstance().setHash("detail/1");
		await flushPromises();

		assert.strictEqual(getHash(), "protected", "the URL is back on what it showed before the change");
		assert.deepEqual(
			settlements,
			[{ status: NavigationOutcome.Blocked, route: "protected", hash: "protected" }],
			"the router is on the hash that its hash changer reports then",
		);
		assert.deepEqual(await router.navigationSettled(), settlements[0], "and stays on it");

		let leftHash: string | undefined;
		router.addLeaveGuard("protected", (context) => {
			leftHash = context.fromHash;
			return true;
		});
		router.navTo("home");
		await waitForRoute(router, "home");
		assert.strictEqual(leftHash, "protected", "the next navigation leaves that hash");
	},
);

QUnit.test(
	"a hash that arrives while the router puts the URL back is not undone as a whole",
	async function (this: SinonTestContext, assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");
		router.navTo("protected");
		await waitForRoute(router, "protected");
		router.addLeaveGuard("protected", () => false);
		const statuses = recordSettlements(router);
		const hashChanger = HashChanger.getInstance();
		// A hash changer that writes another hash than the one the router puts the URL back to, once.
		const replaceHash = this.stub(hashChanger, "replaceHash").callsFake(() => {
			replaceHash.restore();
			hashChanger.replaceHash("forbidden", "Unknown");
		});

		hashChanger.setHash("detail/1");
		await flushPromises();

		assert.deepEqual(
			statuses,
			[NavigationOutcome.Blocked, NavigationOutcome.Blocked],
			"both hashes are blocked, and the second one causes no further undo",
		);
		assert.strictEqual(getHash(), "protected", "the URL is on the hash of the route that is shown");
		assert.deepEqual(
			await router.navigationSettled(),
			{ status: NavigationOutcome.Blocked, route: "protected", hash: "protected" },
			"which is the hash of the router",
		);
	},
);

QUnit.test(
	"a hash change that is blocked while no navigation has committed ends on the empty hash",
	async function (assert: Assert) {
		router.addGuard(() => false);
		router.initialize();
		const statuses = recordSettlements(router);

		HashChanger.getInstance().setHash("protected");
		await flushPromises();

		assert.deepEqual(
			statuses,
			[NavigationOutcome.Blocked, NavigationOutcome.Blocked],
			"the hash is blocked, and so is the empty hash that the router falls back to",
		);
		assert.strictEqual(getHash(), "", "the URL does not go back to the hash that was blocked");
		assert.deepEqual(
			await router.navigationSettled(),
			{ status: NavigationOutcome.Blocked, route: "", hash: "" },
			"the router is on no route",
		);
	},
);
