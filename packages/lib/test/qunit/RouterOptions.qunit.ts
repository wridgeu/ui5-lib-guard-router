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
// Module: Router options: constructor
// ============================================================
QUnit.module("Router - Router options - constructor", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("constructor reads unknownRouteRegistration from config", function (assert: Assert) {
	// Arrange: create router with "ignore" policy
	router = createRouterWithOptions({ unknownRouteRegistration: "ignore" });

	// Act: register guard for unknown route
	const warnings = captureWarnings(() => {
		router.addRouteGuard("nonexistent", () => true);
	});

	// Assert: "ignore" policy means no warning
	assert.strictEqual(warnings.length, 0, "ignore policy produces no warnings for unknown routes");
});

QUnit.test("malformed guardRouter config warns and falls back to default behavior", function (assert: Assert) {
	// Arrange: create router with non-object config
	const warnings = captureWarnings(() => {
		router = createRouterWithOptionsUnsafe("not-an-object");
	});

	// Assert: warning was logged
	assert.ok(warnings.length > 0, "warning logged for non-object config");

	// Assert: default "warn" policy is active (registering for unknown route logs a warning)
	const routeWarnings = captureWarnings(() => {
		router.addRouteGuard("nonexistent", () => true);
	});
	assert.strictEqual(routeWarnings.length, 1, "default warn policy active after malformed config");
});

QUnit.test("invalid option values warn individually and fall back to defaults", function (assert: Assert) {
	// Arrange & Act: create router with all invalid option values
	const warnings = captureWarnings(() => {
		router = createRouterWithOptionsUnsafe({
			unknownRouteRegistration: "invalid",
			navToPreflight: 42,
			guardLoading: null,
			inheritance: "invalid",
		});
	});

	// Assert: one warning per invalid option
	assert.strictEqual(warnings.length, 4, "one warning per invalid option");

	// Assert: default "warn" policy is active (behavioral proof of fallback)
	const routeWarnings = captureWarnings(() => {
		router.addRouteGuard("nonexistent", () => true);
	});
	assert.strictEqual(routeWarnings.length, 1, "default warn policy active after invalid config");
});

QUnit.test("invalid inheritance value warns and falls back to default", function (assert: Assert) {
	const warnings = captureWarnings(() => {
		router = createRouterWithOptionsUnsafe({
			inheritance: "invalid",
		});
	});

	assert.strictEqual(warnings.length, 1, "one warning for invalid inheritance option");

	// Behavioral proof of fallback: metadata should NOT propagate (default is "none")
	router.destroy();
	router = createRouterUnsafe(HIERARCHICAL_ROUTES, {
		async: true,
		guardRouter: { inheritance: "invalid", routeMeta: { employees: { section: "hr" } } },
	});
	const meta = router.getRouteMeta("employee");
	assert.deepEqual(meta, {}, "metadata does not propagate with invalid inheritance (falls back to none)");
});

// ============================================================
// Module: Router options: unknownRouteRegistration
// ============================================================
QUnit.module("Router - unknownRouteRegistration", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test('"ignore" registers silently for unknown routes', function (assert: Assert) {
	// Arrange
	router = createRouterWithOptions({ unknownRouteRegistration: "ignore" });

	// Act: register guards for unknown route
	const warnings = captureWarnings(() => {
		router.addRouteGuard("nonexistent", () => true);
		router.addLeaveGuard("nonexistent", () => true);
	});

	// Assert: no warnings logged
	assert.strictEqual(warnings.length, 0, "no warnings logged");
});

QUnit.test('"throw" prevents registration and throws', function (assert: Assert) {
	// Arrange
	router = createRouterWithOptions({ unknownRouteRegistration: "throw" });

	// Act & Assert: both registration methods throw
	assert.throws(
		() => router.addRouteGuard("nonexistent", () => true),
		/^Error: addRouteGuard called for unknown route "nonexistent"\. Set guardRouter\.unknownRouteRegistration to "warn" or "ignore" to allow this\.$/,
		"addRouteGuard throws for unknown route and says how to allow it",
	);

	assert.throws(
		() => router.addLeaveGuard("nonexistent", () => true),
		/unknown route/i,
		"addLeaveGuard throws for unknown route",
	);
});

QUnit.test('"throw" with config object is all-or-nothing', function (assert: Assert) {
	// Arrange
	router = createRouterWithOptions({ unknownRouteRegistration: "throw" });

	// Act & Assert: config form also throws
	assert.throws(
		() => router.addRouteGuard("nonexistent", { beforeEnter: () => true, beforeLeave: () => true }),
		/unknown route/i,
		"config form also throws for unknown route",
	);
});

// ============================================================
// Module: Router options: navToPreflight
// ============================================================
QUnit.module("Router - navToPreflight", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

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

// ============================================================
// Module: Router options: skipGuards
// ============================================================
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
	const statuses: string[] = [];
	router.attachNavigationSettled((event) => statuses.push(event.getParameter("status") as string));

	router.navTo("protected", {}, false, { skipGuards: true });

	assert.deepEqual(statuses, [NavigationOutcome.Committed], "one settlement, in the same tick");
});
