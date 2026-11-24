import Log from "sap/base/Log";
import DataType from "sap/ui/base/DataType";
import type { GuardFn, GuardRouter, LeaveGuardFn } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { Router$RouteMatchedEvent } from "sap/ui/core/routing/Router";
import type { Route$PatternMatchedEvent } from "sap/ui/core/routing/Route";
import {
	addGuardUnsafe,
	addLeaveGuardUnsafe,
	addRouteGuardUnsafe,
	assertBlocked,
	captureWarnings,
	captureWarningsAsync,
	createRouter,
	initHashChanger,
	type SinonTestContext,
	removeGuardUnsafe,
	removeLeaveGuardUnsafe,
	removeRouteGuardUnsafe,
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

QUnit.module("Router - Library integration");

QUnit.test("NavigationOutcome is registered as a UI5 enum", function (assert: Assert) {
	const type = DataType.getType("ui5.guard.router.NavigationOutcome");

	assert.ok(type, "Enum type is discoverable via DataType.getType()");
	assert.strictEqual(type?.isValid(NavigationOutcome.Committed), true, "Known enum values are accepted");
	assert.strictEqual(type?.isValid(NavigationOutcome.Bypassed), true, "Bypassed enum value is accepted");
	assert.strictEqual(type?.isValid("pending"), false, "Unknown enum values are rejected");
});

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
	assert.strictEqual(getHash(), "protected", "Hash updated to protected");
});

QUnit.test("navTo with parameters", async function (assert: Assert) {
	let matchedArgs: object | undefined;
	router.getRoute("detail")!.attachPatternMatched((event: Route$PatternMatchedEvent) => {
		matchedArgs = event.getParameter("arguments");
	});
	router.navTo("detail", { id: "42" });
	await waitForRoute(router, "detail");
	assert.strictEqual(getHash(), "detail/42", "Hash contains route parameter");
	assert.deepEqual(matchedArgs, { id: "42" }, "Route argument propagated to matched event");
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

QUnit.module("Router - Guard API", standardHooks);

QUnit.test("addGuard / removeGuard affect navigation behavior", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	const guard: GuardFn = () => false;
	router.addGuard(guard);

	await assertBlocked(assert, router, () => router.navTo("protected"), "Guard blocks after addGuard");

	router.removeGuard(guard);

	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(getHash(), "protected", "Navigation allowed after removeGuard");
});

QUnit.test("addRouteGuard / removeRouteGuard affect navigation behavior", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	const guard: GuardFn = () => false;
	router.addRouteGuard("protected", guard);

	await assertBlocked(assert, router, () => router.navTo("protected"), "Route guard blocks after addRouteGuard");

	router.removeRouteGuard("protected", guard);

	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(getHash(), "protected", "Navigation allowed after removeRouteGuard");
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
	assert.strictEqual(getHash(), "protected", "Invalid runtime guard input was ignored");
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

	assert.strictEqual(getHash(), "", "Invalid leave guard input was ignored");
	assert.strictEqual(warnings.length, 1, "One warning was logged");
	assert.strictEqual(
		warnings[0]?.message,
		"addRouteGuard: not a function, ignoring",
		"Warning names the addRouteGuard object-form entrypoint",
	);
	assert.strictEqual(warnings[0]?.details, "protected", "Warning includes the route name");
});

QUnit.test("addGuard ignores non-function input", async function (assert: Assert) {
	addGuardUnsafe(router, null);
	addGuardUnsafe(router, 42);
	addGuardUnsafe(router, "not a function");
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(getHash(), "protected", "Non-function inputs to addGuard were ignored");
});

QUnit.test("addLeaveGuard ignores non-function input", async function (assert: Assert) {
	addLeaveGuardUnsafe(router, "home", null);
	addLeaveGuardUnsafe(router, "home", 42);
	router.initialize();
	await waitForRoute(router, "home");
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(getHash(), "protected", "Non-function inputs to addLeaveGuard were ignored");
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
	assert.strictEqual(getHash(), "protected", "Empty config object registered no guards");
});

QUnit.test(
	"addRouteGuard object form with only beforeEnter registers enter guard only",
	async function (assert: Assert) {
		let calls = 0;
		router.addRouteGuard("protected", {
			beforeEnter: () => {
				calls++;
				return true;
			},
		});
		router.initialize();
		await waitForRoute(router, "home");

		router.navTo("protected");
		await waitForRoute(router, "protected");
		assert.strictEqual(calls, 1, "beforeEnter ran when entering");

		router.navTo("home");
		await waitForRoute(router, "home");
		assert.strictEqual(calls, 1, "beforeEnter did not run as a leave guard");
	},
);

QUnit.test(
	"addRouteGuard object form with only beforeLeave registers leave guard only",
	async function (assert: Assert) {
		let calls = 0;
		router.addRouteGuard("protected", {
			beforeLeave: () => {
				calls++;
				return true;
			},
		});
		router.initialize();
		await waitForRoute(router, "home");

		router.navTo("protected");
		await waitForRoute(router, "protected");
		assert.strictEqual(calls, 0, "beforeLeave did not run as an enter guard");

		router.navTo("home");
		await waitForRoute(router, "home");
		assert.strictEqual(calls, 1, "beforeLeave ran when leaving");
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
