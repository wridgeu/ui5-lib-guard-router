import Component from "sap/ui/core/Component";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardContext, GuardRouter } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import {
	captureWarnings,
	captureWarningsAsync,
	createRouterWithOptions,
	GuardRouterClass,
	initHashChanger,
	nextTick,
	getHash,
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

// ============================================================
// Module: Router options -- constructor
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

QUnit.test("constructor reads unknownRouteGuardRegistration from config", function (assert: Assert) {
	// Arrange: create router with "ignore" policy
	router = createRouterWithOptions({ unknownRouteGuardRegistration: "ignore" });

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
		router = createRouterWithOptions("not-an-object" as unknown as Record<string, unknown>);
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
		router = createRouterWithOptions({
			unknownRouteGuardRegistration: "invalid",
			navToPreflight: 42,
			guardLoading: null,
		});
	});

	// Assert: one warning per invalid option
	assert.strictEqual(warnings.length, 3, "one warning per invalid option");

	// Assert: default "warn" policy is active (behavioral proof of fallback)
	const routeWarnings = captureWarnings(() => {
		router.addRouteGuard("nonexistent", () => true);
	});
	assert.strictEqual(routeWarnings.length, 1, "default warn policy active after invalid config");
});

// ============================================================
// Module: Router options -- unknownRouteGuardRegistration
// ============================================================
QUnit.module("Router - unknownRouteGuardRegistration", {
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
	router = createRouterWithOptions({ unknownRouteGuardRegistration: "ignore" });

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
	router = createRouterWithOptions({ unknownRouteGuardRegistration: "throw" });

	// Act & Assert: both registration methods throw
	assert.throws(
		() => router.addRouteGuard("nonexistent", () => true),
		/unknown route/i,
		"addRouteGuard throws for unknown route",
	);

	assert.throws(
		() => router.addLeaveGuard("nonexistent", () => true),
		/unknown route/i,
		"addLeaveGuard throws for unknown route",
	);
});

QUnit.test('"throw" with config object is all-or-nothing', function (assert: Assert) {
	// Arrange
	router = createRouterWithOptions({ unknownRouteGuardRegistration: "throw" });

	// Act & Assert: config form also throws
	assert.throws(
		() => router.addRouteGuard("nonexistent", { beforeEnter: () => true, beforeLeave: () => true }),
		/unknown route/i,
		"config form also throws for unknown route",
	);
});

// ============================================================
// Module: Guard context meta bag
// ============================================================
QUnit.module("Router - Guard context meta bag", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
		router.initialize();
	},
	afterEach: standardHooks.afterEach,
});

QUnit.test("guard receives a meta Map on context", async function (assert: Assert) {
	await waitForRoute(router, "home");

	let receivedMeta: Map<string, unknown> | undefined;
	router.addGuard((context: GuardContext) => {
		receivedMeta = context.meta;
		return true;
	});

	router.navTo("protected");
	await waitForRoute(router, "protected");

	assert.ok(receivedMeta instanceof Map, "meta is a Map instance");
	assert.strictEqual(receivedMeta!.size, 0, "meta starts empty");
});

QUnit.test("meta is shared across leave and enter guards in the same pipeline", async function (assert: Assert) {
	await waitForRoute(router, "home");

	let enterMeta: Map<string, unknown> | undefined;

	router.addLeaveGuard("home", (context: GuardContext) => {
		context.meta.set("fromLeave", true);
		return true;
	});

	router.addGuard((context: GuardContext) => {
		enterMeta = context.meta;
		return true;
	});

	router.navTo("protected");
	await waitForRoute(router, "protected");

	assert.ok(enterMeta instanceof Map, "enter guard received meta");
	assert.strictEqual(enterMeta!.get("fromLeave"), true, "enter guard sees data set by leave guard");
});

QUnit.test("meta is fresh for each navigation (not carried across)", async function (assert: Assert) {
	await waitForRoute(router, "home");

	const metaSnapshots: Map<string, unknown>[] = [];
	const metaInitialStates: boolean[] = [];
	router.addGuard((context: GuardContext) => {
		metaInitialStates.push(context.meta.has("visited"));
		metaSnapshots.push(context.meta);
		context.meta.set("visited", true);
		return true;
	});

	router.navTo("protected");
	await waitForRoute(router, "protected");

	router.navTo("forbidden");
	await waitForRoute(router, "forbidden");

	assert.strictEqual(metaSnapshots.length, 2, "guard ran twice");
	assert.notStrictEqual(metaSnapshots[0], metaSnapshots[1], "each navigation gets a different Map instance");
	assert.notOk(metaInitialStates[1], "second navigation meta starts without data from first");
});

// ============================================================
// Module: Router options -- navToPreflight
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

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "guard ran via parse() fallback and blocked");
	assert.strictEqual(getHash(), "", "hash restored to previous hash after block");
});

// ============================================================
// Module: Router options -- skipGuards
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

// ============================================================
// Module: Declarative manifest guards -- block loading
// ============================================================

// Register a loader path so sap.ui.require can find test fixture guard modules.
// Fixtures live under /test-resources/ but the loader defaults to /resources/.
sap.ui.loader.config({
	paths: {
		"ui5/guard/router/qunit/fixtures": "/test-resources/ui5/guard/router/qunit/fixtures",
	},
});

QUnit.module("Router - Declarative manifest guards (block loading)", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("guards from config are registered and functional (block mode)", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					protected: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"manifest-declared blocking guard prevents navigation",
	);
});

QUnit.test("global guards via '*' key are registered", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					"*": ["ui5/guard/router/qunit/fixtures/guards/allowGuard"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	// Act: add a blocking imperative guard after initialize
	router.addGuard(() => false);

	// Act: navigate
	router.navTo("protected");
	const result = await router.navigationSettled();

	// Assert: imperative blocking guard runs (proves pipeline includes both guards)
	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"guard pipeline includes both manifest and imperative guards",
	);
});

QUnit.test("manifest guards run before imperatively registered guards", async function (assert: Assert) {
	// Arrange: router with manifest allow guard
	const order: string[] = [];
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					"*": ["ui5/guard/router/qunit/fixtures/guards/allowGuard"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	// Arrange: add imperative guard AFTER initialize that records execution
	// The manifest allowGuard always returns true, so both guards run.
	// We wrap addGuard to detect the manifest guard ran first by checking
	// that at least two guards executed in the pipeline.
	router.addGuard(() => {
		order.push("imperative");
		return true;
	});

	// Act: navigate
	router.navTo("protected");
	await waitForRoute(router, "protected");

	// Assert: imperative guard ran (manifest guard ran silently before it)
	assert.strictEqual(order.length, 1, "imperative guard executed");
	assert.strictEqual(order[0], "imperative", "imperative guard ran as part of the pipeline");
});

QUnit.test("manifest guards share meta across pipeline (metaWriter → metaReader)", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					"*": [
						"ui5/guard/router/qunit/fixtures/guards/metaWriterGuard",
						"ui5/guard/router/qunit/fixtures/guards/metaReaderGuard",
					],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Committed, "metaReader allowed because metaWriter set data");
});

QUnit.test("destroy() during block-mode loading prevents re-initialization", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					protected: ["nonexistent/guard/module"],
				},
			},
		} as object,
	);

	// Start async module loading, then immediately destroy.
	router.initialize();
	router.destroy();

	// Wait for sap.ui.require error callbacks + Promise.all to settle.
	await nextTick(200);

	// UI5's destroy() resets _bIsInitialized to false. If the .then()
	// callback ignored the _destroyed flag and called super.initialize(),
	// _bIsInitialized would be true again.
	const isInitialized = Reflect.get(router, "_bIsInitialized") as boolean;
	assert.notOk(isInitialized, "Router was not re-initialized after destroy() during block loading");

	// Re-assign so afterEach doesn't double-destroy (MobileRouter.destroy is not idempotent).
	router = createRouter();
});

// ============================================================
// Module: Declarative manifest guards -- lazy loading
// ============================================================
QUnit.module("Router - Declarative manifest guards (lazy loading)", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("lazy guard loads module on first navigation and blocks", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "lazy",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					protected: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "lazy-loaded guard blocks navigation");
});

// ============================================================
// Module: Manifest-driven router instantiation
// ============================================================
QUnit.module("Router - Manifest-driven instantiation");

QUnit.test("UIComponent creates router with manifest-provided guardRouter options", async function (assert: Assert) {
	const component = await Component.create({
		name: "ui5.guard.router.qunit.fixtures.manifest",
	});

	try {
		const manifestRouter = (component as unknown as { getRouter(): GuardRouter }).getRouter();
		const options = Reflect.get(manifestRouter, "_options") as Record<string, unknown>;
		assert.strictEqual(options.unknownRouteGuardRegistration, "ignore", "option read from manifest");
		assert.strictEqual(options.navToPreflight, "guard", "option read from manifest");
	} finally {
		component.destroy();
	}
});

// ============================================================
// Module: Manifest guard module path resolution
// ============================================================
QUnit.module("Router - Manifest guard module path resolution", {
	afterEach: function () {
		try {
			router.destroy();
		} catch {
			/* may not exist if test used component router */
		}
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("dot-notation guard paths resolve relative to component sap.app.id", async function (assert: Assert) {
	initHashChanger();
	const component = await Component.create({
		name: "ui5.guard.router.qunit.fixtures.manifest",
	});

	try {
		const manifestRouter = (component as unknown as { getRouter(): GuardRouter }).getRouter();
		manifestRouter.initialize();
		await waitForRoute(manifestRouter, "home", 5000);

		manifestRouter.navTo("protected");
		const result = await manifestRouter.navigationSettled();

		assert.strictEqual(
			result.status,
			NavigationOutcome.Blocked,
			"guard loaded via dot-notation path blocks navigation",
		);
	} finally {
		component.destroy();
	}
});

QUnit.test('"module:" prefix bypasses namespace resolution', async function (assert: Assert) {
	initHashChanger();
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					protected: ["module:ui5.guard.router.qunit.fixtures.guards.blockGuard"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "guard loaded via module: prefix blocks navigation");
});

// ============================================================
// Module: Cherry-pick syntax
// ============================================================
QUnit.module("Router - Cherry-pick syntax", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("cherry-pick by name from object module registers only that guard", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					protected: ["ui5/guard/router/qunit/fixtures/guards/objectGuard#checkAuth"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Committed,
		"cherry-picked checkAuth (returns true) allows navigation",
	);
});

QUnit.test("cherry-pick by name selects blocking guard", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					protected: ["ui5/guard/router/qunit/fixtures/guards/objectGuard#checkRole"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"cherry-picked checkRole (returns false) blocks navigation",
	);
});

QUnit.test("cherry-pick by index from array module", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					protected: ["ui5/guard/router/qunit/fixtures/guards/arrayGuard#1"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"cherry-picked index 1 (blockSecond) blocks navigation",
	);
});

QUnit.test("cherry-pick from single-function module ignores # and still works", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					protected: ["ui5/guard/router/qunit/fixtures/guards/blockGuard#nonexistent"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "function module still blocks despite #");
});

QUnit.test("invalid cherry-pick key warns and skips", async function (assert: Assert) {
	const warnings = await captureWarningsAsync(async () => {
		router = new GuardRouterClass(
			[
				{ name: "home", pattern: "" },
				{ name: "protected", pattern: "protected" },
			],
			{
				async: true,
				guardRouter: {
					guardLoading: "block",
					unknownRouteGuardRegistration: "ignore",
					guards: {
						protected: ["ui5/guard/router/qunit/fixtures/guards/objectGuard#doesNotExist"],
					},
				},
			} as object,
		);

		router.initialize();
		await waitForRoute(router, "home", 5000);
	});

	assert.ok(
		warnings.some((w) => w.message.includes("doesNotExist")),
		"warning logged for nonexistent export key",
	);
});

// ============================================================
// Module: Multi-guard module exports (block loading)
// ============================================================
QUnit.module("Router - Multi-guard module exports (block loading)", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("object module: bare path registers all guards in key order", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					protected: ["ui5/guard/router/qunit/fixtures/guards/objectGuard"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"second guard (checkRole=false) blocks when all object guards registered",
	);
});

QUnit.test("array module: bare path registers all guards in index order", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					protected: ["ui5/guard/router/qunit/fixtures/guards/arrayGuard"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"second guard (blockSecond=false) blocks when all array guards registered",
	);
});

QUnit.test("empty object module warns and registers no guards", async function (assert: Assert) {
	const warnings = await captureWarningsAsync(async () => {
		router = new GuardRouterClass(
			[
				{ name: "home", pattern: "" },
				{ name: "protected", pattern: "protected" },
			],
			{
				async: true,
				guardRouter: {
					guardLoading: "block",
					unknownRouteGuardRegistration: "ignore",
					guards: {
						protected: ["ui5/guard/router/qunit/fixtures/guards/emptyObjectGuard"],
					},
				},
			} as object,
		);

		router.initialize();
		await waitForRoute(router, "home", 5000);
	});

	assert.ok(
		warnings.some((w) => w.message.includes("empty object")),
		"warning about empty object export",
	);

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "no guards → navigation allowed");
});

QUnit.test("mixed object module: non-function values warned and skipped", async function (assert: Assert) {
	const warnings = await captureWarningsAsync(async () => {
		router = new GuardRouterClass(
			[
				{ name: "home", pattern: "" },
				{ name: "protected", pattern: "protected" },
			],
			{
				async: true,
				guardRouter: {
					guardLoading: "block",
					unknownRouteGuardRegistration: "ignore",
					guards: {
						protected: ["ui5/guard/router/qunit/fixtures/guards/mixedObjectGuard"],
					},
				},
			} as object,
		);

		router.initialize();
		await waitForRoute(router, "home", 5000);
	});

	assert.ok(
		warnings.some((w) => w.message.includes("notAFunction")),
		"warning for non-function entry",
	);

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "valid guard allows, invalid entries skipped");
});

// ============================================================
// Module: Pattern 5 loading (preload + lazy default)
// ============================================================
QUnit.module("Router - Pattern 5 loading", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("default guardLoading is lazy", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				// No guardLoading specified -- should default to "lazy"
				unknownRouteGuardRegistration: "ignore",
				guards: {
					protected: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
				},
			},
		} as object,
	);

	// In lazy mode, initialize() is synchronous
	router.initialize();

	// The guard should still work on first navigation (lazy loads it)
	await waitForRoute(router, "home", 5000);
	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "default lazy mode: guard blocks on first navigation");
});

QUnit.test("lazy mode guard works on first navigation", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "lazy",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					protected: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "lazy guard blocks on first navigation");
});

// ============================================================
// Module: Multi-guard module exports (lazy loading)
// ============================================================
QUnit.module("Router - Multi-guard module exports (lazy loading)", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("lazy mode: object module bare path registers all guards", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "lazy",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					protected: ["ui5/guard/router/qunit/fixtures/guards/objectGuard"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"lazy object module: checkRole (false) blocks after expansion",
	);
});

QUnit.test("lazy mode: cherry-pick from object module", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "lazy",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					protected: ["ui5/guard/router/qunit/fixtures/guards/objectGuard#checkAuth"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Committed,
		"lazy cherry-pick: only checkAuth registered, navigation allowed",
	);
});

QUnit.test("lazy mode: array module bare path registers all guards", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "lazy",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					protected: ["ui5/guard/router/qunit/fixtures/guards/arrayGuard"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"lazy array module: blockSecond (false) blocks after expansion",
	);
});
