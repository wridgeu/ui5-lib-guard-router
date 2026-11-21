import Log from "sap/base/Log";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardRouter } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import {
	captureWarnings,
	createRouter,
	createRouterWithOptions,
	createRouterUnsafe,
	createRouterWithOptionsUnsafe,
	HIERARCHICAL_ROUTES,
	initHashChanger,
	getHash,
	recordHashChanges,
	recordSettlements,
	waitForRoute,
	routerHooks,
	createdRouterHooks,
	type SinonTestContext,
} from "../../testHelpers";
import { isRecord } from "ui5/guard/router/GuardConfig";

let router: GuardRouter;

const standardHooks = routerHooks(
	(created) => {
		router = created;
	},
	() => router,
);

QUnit.module(
	"Router - Router options - constructor",
	createdRouterHooks(() => router),
);

QUnit.test("UI5 gets the caller's config object without guardRouter", function (assert: Assert) {
	const config: Record<string, unknown> = { async: true, guardRouter: { navToPreflight: "guard" } };
	router = createRouterUnsafe([{ name: "home", pattern: "" }], config);
	// The UI5-private member in which sap.ui.core.routing.Router keeps the config it was constructed with.
	const received: unknown = Reflect.get(router, "_oConfig");
	if (!isRecord(received)) throw new TypeError("the router has no config object");

	assert.notOk("guardRouter" in received, "guardRouter is not in the config");
	assert.ok("async" in received, "the caller's other properties are");
	assert.notOk("bypassed" in received, "a property the caller did not set is not");
	assert.deepEqual(
		Object.getOwnPropertyNames(received),
		Object.getOwnPropertyNames(config).filter((name) => name !== "guardRouter"),
		"guardRouter is not among the property names",
	);
	config.targetParent = "rootView";
	assert.strictEqual(received.targetParent, "rootView", "a property the caller adds later arrives");
});

QUnit.test("malformed guardRouter config warns and falls back to default behavior", function (assert: Assert) {
	const warnings = captureWarnings(() => {
		router = createRouterWithOptionsUnsafe("not-an-object");
	});

	assert.deepEqual(
		warnings,
		[{ message: "guardRouter config is not a plain object, using defaults", details: '"not-an-object"' }],
		"one warning for the non-object config",
	);

	// Registering for an unknown route logs a warning
	const routeWarnings = captureWarnings(() => {
		router.addRouteGuard("nonexistent", () => true);
	});
	assert.strictEqual(routeWarnings.length, 1, "default warn policy active after malformed config");
});

QUnit.test("invalid inheritance value warns and falls back to default", function (assert: Assert) {
	const warnings = captureWarnings(() => {
		router = createRouterWithOptionsUnsafe({
			inheritance: "invalid",
		});
	});

	assert.strictEqual(warnings.length, 1, "one warning for invalid inheritance option");

	router.destroy();
	router = createRouterUnsafe(HIERARCHICAL_ROUTES, {
		async: true,
		guardRouter: { inheritance: "invalid", routeMeta: { employees: { section: "hr" } } },
	});
	const meta = router.getRouteMeta("employee");
	assert.deepEqual(meta, {}, "metadata does not propagate with invalid inheritance (falls back to none)");
});

QUnit.test("logLevel raises the level of the router's log component", function (this: SinonTestContext, assert) {
	this.stub(Log, "getLevel").returns(Log.Level.ERROR);
	const setLevel = this.stub(Log, "setLevel");
	router = createRouterWithOptions({ logLevel: "warning" });
	assert.deepEqual(
		setLevel.getCalls().map((call) => call.args),
		[[Log.Level.WARNING, "ui5.guard.router.Router"]],
	);
});

QUnit.test(
	"logLevel is applied once, so a Log.setLevel() call after construction wins",
	async function (this: SinonTestContext, assert) {
		this.stub(Log, "getLevel").returns(Log.Level.ERROR);
		const setLevel = this.stub(Log, "setLevel");
		router = createRouterWithOptions({ logLevel: "debug" });
		Log.setLevel(Log.Level.ERROR, "ui5.guard.router.Router");

		router.initialize();
		await waitForRoute(router, "home");
		router.navTo("protected");
		await router.navigationSettled();

		assert.deepEqual(
			setLevel.getCalls().map((call) => call.args),
			[
				[Log.Level.DEBUG, "ui5.guard.router.Router"],
				[Log.Level.ERROR, "ui5.guard.router.Router"],
			],
			"the router does not apply its level again",
		);
	},
);

QUnit.module(
	"Router - unknownRouteRegistration",
	createdRouterHooks(() => router),
);

QUnit.test('"ignore" registers silently for unknown routes', function (assert: Assert) {
	router = createRouterWithOptions({ unknownRouteRegistration: "ignore" });

	const warnings = captureWarnings(() => {
		router.addRouteGuard("nonexistent", () => true);
		router.addLeaveGuard("nonexistent", () => true);
	});

	assert.strictEqual(warnings.length, 0, "no warnings logged");
});

/** Add the route that the throwing calls named, and enter and leave it: a guard they had registered would block. */
async function assertNoGuardRegistered(assert: Assert): Promise<void> {
	router.addRoute({ name: "nonexistent", pattern: "nonexistent" });
	router.initialize();
	await waitForRoute(router, "home");
	const statuses = recordSettlements(router);
	router.navTo("nonexistent");
	router.navTo("home");
	assert.deepEqual(
		statuses,
		[NavigationOutcome.Committed, NavigationOutcome.Committed],
		"the route is entered and left: the calls registered no guard",
	);
}

QUnit.test('"throw" prevents registration and throws', async function (assert: Assert) {
	router = createRouterWithOptions({ unknownRouteRegistration: "throw" });

	assert.throws(
		() => router.addRouteGuard("nonexistent", () => false),
		/^Error: addRouteGuard called for unknown route "nonexistent"\. Set guardRouter\.unknownRouteRegistration to "warn" or "ignore" to allow this\.$/,
		"addRouteGuard throws for unknown route and says how to allow it",
	);

	assert.throws(
		() => router.addLeaveGuard("nonexistent", () => false),
		/unknown route/i,
		"addLeaveGuard throws for unknown route",
	);
	await assertNoGuardRegistered(assert);
});

QUnit.test('"throw" with config object is all-or-nothing', async function (assert: Assert) {
	router = createRouterWithOptions({ unknownRouteRegistration: "throw" });

	assert.throws(
		() => router.addRouteGuard("nonexistent", { beforeEnter: () => false, beforeLeave: () => false }),
		/unknown route/i,
		"config form also throws for unknown route",
	);
	await assertNoGuardRegistered(assert);
});

QUnit.module(
	"Router - navToPreflight",
	createdRouterHooks(() => router),
);

QUnit.test('"bypass" skips guards for programmatic navTo', async function (assert: Assert) {
	router = createRouterWithOptions({ navToPreflight: "bypass" });
	router.initialize();
	await waitForRoute(router, "home");

	router.addGuard(() => false);

	router.navTo("protected");
	await waitForRoute(router, "protected");

	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "navigation committed despite blocking guard");
	assert.strictEqual(result.route, "protected", "reached target route");
});

QUnit.test('"bypass" still guards browser-initiated hash changes', async function (assert: Assert) {
	router = createRouterWithOptions({ navToPreflight: "bypass" });
	router.initialize();
	await waitForRoute(router, "home");

	router.addGuard(() => false);

	HashChanger.getInstance().setHash("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "browser hash change is still guarded");
});

QUnit.test('"off" defers guard evaluation to parse() fallback', async function (assert: Assert) {
	router = createRouterWithOptions({ navToPreflight: "off" });
	router.initialize();
	await waitForRoute(router, "home");

	router.addGuard(() => false);

	const recorder = recordHashChanges();
	router.navTo("protected");
	const result = await router.navigationSettled();
	recorder.stop();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "guard ran via parse() fallback and blocked");
	assert.ok(recorder.hashes.includes("protected"), "navTo changed the hash before the guard ran");
	assert.strictEqual(getHash(), "", "hash restored to previous hash after block");
});

QUnit.test(
	'"off": a blocked navTo() that supersedes a pending hash change puts the URL back on the committed hash',
	async function (assert: Assert) {
		router = createRouterWithOptions({ navToPreflight: "off" });
		router.initialize();
		await waitForRoute(router, "home");
		const pending = Promise.withResolvers<boolean>();
		let protectedGuardCalls = 0;
		router.addRouteGuard("protected", () => {
			protectedGuardCalls++;
			return pending.promise;
		});
		router.addRouteGuard("forbidden", () => false);
		const statuses = recordSettlements(router);

		HashChanger.getInstance().setHash("protected");
		router.navTo("forbidden");

		assert.deepEqual(
			await router.navigationSettled(),
			{ status: NavigationOutcome.Blocked, route: "home", hash: "" },
			"the router stays on the committed route and hash",
		);
		assert.deepEqual(statuses, [NavigationOutcome.Cancelled, NavigationOutcome.Blocked]);
		assert.strictEqual(getHash(), "", "the URL shows the committed hash, not the superseded one");

		router.navTo("protected");
		assert.strictEqual(protectedGuardCalls, 2, "the superseded route is still guarded");
		pending.resolve(false);
		await router.navigationSettled();
	},
);

QUnit.module("Router - skipGuards", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
		router.initialize();
	},
	afterEach: standardHooks.afterEach,
});

QUnit.test("skipGuards bypasses guards for a single navTo call", async function (assert: Assert) {
	await waitForRoute(router, "home");

	router.addGuard(() => false);

	router.navTo("protected", {}, false, { skipGuards: true });
	await waitForRoute(router, "protected");

	assert.strictEqual(getHash(), "protected", "navigated despite blocking guard");
});

QUnit.test("skipGuards produces NavigationOutcome.Committed", async function (assert: Assert) {
	await waitForRoute(router, "home");

	router.addGuard(() => false);

	router.navTo("protected", {}, false, { skipGuards: true });
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "skipGuards settles as Committed");
	assert.strictEqual(result.route, "protected", "reached target route");
});

QUnit.test("skipGuards does not affect subsequent navTo calls", async function (assert: Assert) {
	await waitForRoute(router, "home");

	router.addGuard(() => false);

	router.navTo("protected", {}, false, { skipGuards: true });
	await waitForRoute(router, "protected");

	router.navTo("forbidden");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "next navTo without skipGuards is still guarded");
});

QUnit.test("skipGuards navTo settles exactly once", async function (assert: Assert) {
	await waitForRoute(router, "home");
	const statuses = recordSettlements(router);

	router.navTo("protected", {}, false, { skipGuards: true });

	assert.deepEqual(statuses, [NavigationOutcome.Committed], "one settlement, in the same tick");
});

QUnit.test("skipGuards is honored when bReplace is left out", async function (assert: Assert) {
	await waitForRoute(router, "home");

	router.addGuard(() => false);

	router.navTo("protected", {}, undefined, { skipGuards: true });
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "options in place of bReplace are read");
	assert.strictEqual(result.route, "protected", "reached target route");
});

QUnit.test("skipGuards does not wait for the pending guards of the same target", async function (assert: Assert) {
	await waitForRoute(router, "home");

	router.addGuard(() => new Promise<boolean>(() => {}));
	const statuses = recordSettlements(router);

	router.navTo("protected");
	router.navTo("protected", {}, false, { skipGuards: true });

	assert.deepEqual(
		statuses,
		[NavigationOutcome.Cancelled, NavigationOutcome.Committed],
		"the guarded navigation is cancelled, the unguarded one commits",
	);
	assert.strictEqual(getHash(), "protected");
});
