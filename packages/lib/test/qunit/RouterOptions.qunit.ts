import Component from "sap/ui/core/Component";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardContext, GuardRouter } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import {
	addRouteDynamic,
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
		router = createRouterWithOptions({
			inheritance: "invalid",
		});
	});

	assert.strictEqual(warnings.length, 1, "one warning for invalid inheritance option");

	// Behavioral proof of fallback: metadata should NOT propagate (default is "none")
	router.destroy();
	router = createHierarchicalRouter({
		inheritance: "invalid",
		routeMeta: {
			employees: { section: "hr" },
		},
	});
	const meta = router.getRouteMeta("employee");
	assert.deepEqual(meta, {}, "metadata does not propagate with invalid inheritance (falls back to none)");
});

// ============================================================
// Module: Router options -- unknownRouteRegistration
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
	router = createRouterWithOptions({ unknownRouteRegistration: "throw" });

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

QUnit.test("guard receives a bag Map on context", async function (assert: Assert) {
	await waitForRoute(router, "home");

	let receivedBag: Map<string, unknown> | undefined;
	router.addGuard((context: GuardContext) => {
		receivedBag = context.bag;
		return true;
	});

	router.navTo("protected");
	await waitForRoute(router, "protected");

	assert.ok(receivedBag instanceof Map, "bag is a Map instance");
	assert.strictEqual(receivedBag!.size, 0, "bag starts empty");
});

QUnit.test("bag is shared across leave and enter guards in the same pipeline", async function (assert: Assert) {
	await waitForRoute(router, "home");

	let enterBag: Map<string, unknown> | undefined;

	router.addLeaveGuard("home", (context: GuardContext) => {
		context.bag.set("fromLeave", true);
		return true;
	});

	router.addGuard((context: GuardContext) => {
		enterBag = context.bag;
		return true;
	});

	router.navTo("protected");
	await waitForRoute(router, "protected");

	assert.ok(enterBag instanceof Map, "enter guard received bag");
	assert.strictEqual(enterBag!.get("fromLeave"), true, "enter guard sees data set by leave guard");
});

QUnit.test("bag is fresh for each navigation (not carried across)", async function (assert: Assert) {
	await waitForRoute(router, "home");

	const bagSnapshots: Map<string, unknown>[] = [];
	const bagInitialStates: boolean[] = [];
	router.addGuard((context: GuardContext) => {
		bagInitialStates.push(context.bag.has("visited"));
		bagSnapshots.push(context.bag);
		context.bag.set("visited", true);
		return true;
	});

	router.navTo("protected");
	await waitForRoute(router, "protected");

	router.navTo("forbidden");
	await waitForRoute(router, "forbidden");

	assert.strictEqual(bagSnapshots.length, 2, "guard ran twice");
	assert.notStrictEqual(bagSnapshots[0], bagSnapshots[1], "each navigation gets a different Map instance");
	assert.notOk(bagInitialStates[1], "second navigation bag starts without data from first");
});

QUnit.test("bag is shared across redirect chain hops", async function (assert: Assert) {
	await waitForRoute(router, "home");

	router.addRouteGuard("protected", (context: GuardContext) => {
		context.bag.set("writtenBy", "protected-guard");
		return "forbidden";
	});

	let redirectTargetBag: Map<string, unknown> | undefined;
	router.addRouteGuard("forbidden", (context: GuardContext) => {
		redirectTargetBag = context.bag;
		return true;
	});

	router.navTo("protected");
	await waitForRoute(router, "forbidden");

	assert.ok(redirectTargetBag instanceof Map, "redirect target guard received bag");
	assert.strictEqual(
		redirectTargetBag!.get("writtenBy"),
		"protected-guard",
		"redirect target guard reads data written by the original guard",
	);
});

QUnit.test("bag is shared across multiple redirect hops", async function (assert: Assert) {
	await waitForRoute(router, "home");

	router.addRouteGuard("protected", (context: GuardContext) => {
		context.bag.set("hop1", true);
		return "forbidden";
	});

	router.addRouteGuard("forbidden", (context: GuardContext) => {
		context.bag.set("hop2", true);
		return { route: "detail", parameters: { id: "42" } };
	});

	let finalBag: Map<string, unknown> | undefined;
	router.addRouteGuard("detail", (context: GuardContext) => {
		finalBag = context.bag;
		return true;
	});

	router.navTo("protected");
	await waitForRoute(router, "detail");

	assert.ok(finalBag instanceof Map, "final hop guard received bag");
	assert.strictEqual(finalBag!.get("hop1"), true, "data from first hop survives to third");
	assert.strictEqual(finalBag!.get("hop2"), true, "data from second hop survives to third");
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
				unknownRouteRegistration: "ignore",
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
				unknownRouteRegistration: "ignore",
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
	// Arrange: router with bagWriterGuard as manifest guard -- it writes to context.bag
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteRegistration: "ignore",
				guards: {
					"*": ["ui5/guard/router/qunit/fixtures/guards/bagWriterGuard"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	// Arrange: add imperative guard that reads from context.bag.
	// If the manifest guard ran first, "writer" will already be present.
	let manifestRanFirst = false;
	router.addGuard((context: GuardContext) => {
		manifestRanFirst = context.bag.has("writer");
		return true;
	});

	// Act: navigate
	router.navTo("protected");
	await waitForRoute(router, "protected");

	// Assert: imperative guard observed data written by the manifest guard,
	// proving the manifest guard executed first.
	assert.ok(manifestRanFirst, "manifest guard wrote to context.bag before imperative guard ran");
});

QUnit.test("manifest guards share bag across pipeline (bagWriter → bagReader)", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteRegistration: "ignore",
				guards: {
					"*": [
						"ui5/guard/router/qunit/fixtures/guards/bagWriterGuard",
						"ui5/guard/router/qunit/fixtures/guards/bagReaderGuard",
					],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Committed, "bagReader allowed because bagWriter set data");
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
				unknownRouteRegistration: "ignore",
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
	assert.notOk(router.isInitialized(), "Router was not re-initialized after destroy() during block loading");

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
				unknownRouteRegistration: "ignore",
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
				unknownRouteRegistration: "ignore",
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
		// "ignore" policy means registering guard on unknown route produces NO warning
		const warnings = captureWarnings(() => {
			manifestRouter.addRouteGuard("totallyUnknownRoute", () => true);
		});
		const unknownRouteWarnings = warnings.filter((w) => w.message.includes("unknown route"));
		assert.strictEqual(unknownRouteWarnings.length, 0, "unknownRouteRegistration='ignore' suppresses warnings");
		// Verify navToPreflight='guard' was loaded from manifest: a blocking guard on the
		// "protected" route must prevent navTo from changing the hash (preflight blocks).
		// If navToPreflight were "off" or "bypass", the hash would change despite the guard.
		initHashChanger();
		manifestRouter.initialize();
		await waitForRoute(manifestRouter, "home", 5000);

		manifestRouter.navTo("protected");
		const result = await manifestRouter.navigationSettled();

		assert.strictEqual(
			result.status,
			NavigationOutcome.Blocked,
			"navToPreflight='guard' blocks navigation before hash change",
		);
		assert.strictEqual(getHash(), "", "hash unchanged because preflight blocked navTo");
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
				unknownRouteRegistration: "ignore",
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
				unknownRouteRegistration: "ignore",
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
				unknownRouteRegistration: "ignore",
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
				unknownRouteRegistration: "ignore",
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

QUnit.test(
	"cherry-pick by numeric index from object module resolves by insertion order",
	async function (assert: Assert) {
		// objectGuard exports { checkAuth (returns true), checkRole (returns false) }
		// #1 by insertion order = checkRole (blocks)
		router = new GuardRouterClass(
			[
				{ name: "home", pattern: "" },
				{ name: "protected", pattern: "protected" },
			],
			{
				async: true,
				guardRouter: {
					guardLoading: "block",
					unknownRouteRegistration: "ignore",
					guards: {
						protected: ["ui5/guard/router/qunit/fixtures/guards/objectGuard#1"],
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
			"numeric index #1 resolves to checkRole (second entry) which blocks",
		);
	},
);

QUnit.test("cherry-pick by numeric index 0 from object module resolves first entry", async function (assert: Assert) {
	// objectGuard exports { checkAuth (returns true), checkRole (returns false) }
	// #0 by insertion order = checkAuth (allows)
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteRegistration: "ignore",
				guards: {
					protected: ["ui5/guard/router/qunit/fixtures/guards/objectGuard#0"],
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
		"numeric index #0 resolves to checkAuth (first entry) which allows",
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
				unknownRouteRegistration: "ignore",
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
					unknownRouteRegistration: "ignore",
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

QUnit.test("global '*' with cherry-pick works", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "other", pattern: "other" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "lazy",
				unknownRouteRegistration: "ignore",
				guards: {
					"*": ["ui5/guard/router/qunit/fixtures/guards/objectGuard#checkRole"],
				},
			},
		} as object,
	);

	// lazy mode: initialize() registers lazy wrappers synchronously.
	// Navigate directly to "other" -- the lazy wrapper will load the module
	// and execute checkRole (returns false), blocking navigation.
	router.initialize();
	router.navTo("other");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"global cherry-picked guard (checkRole=false) blocks all routes",
	);
});

QUnit.test("module: prefix with cherry-pick composes correctly", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteRegistration: "ignore",
				guards: {
					protected: ["module:ui5.guard.router.qunit.fixtures.guards.objectGuard#checkAuth"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Committed, "module: prefix + #checkAuth works together");
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
				unknownRouteRegistration: "ignore",
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
				unknownRouteRegistration: "ignore",
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
					unknownRouteRegistration: "ignore",
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
					unknownRouteRegistration: "ignore",
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
	assert.ok(
		warnings.some((w) => w.message.includes("alsoNotAFunction")),
		"warning includes second non-function property name",
	);

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "valid guard allows, invalid entries skipped");
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
				unknownRouteRegistration: "ignore",
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
				unknownRouteRegistration: "ignore",
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
				unknownRouteRegistration: "ignore",
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

// ============================================================
// Module: Multi-guard edge cases
// ============================================================
QUnit.module("Router - Multi-guard edge cases", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("empty array module warns and registers no guards", async function (assert: Assert) {
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
					unknownRouteRegistration: "ignore",
					guards: {
						protected: ["ui5/guard/router/qunit/fixtures/guards/emptyArrayGuard"],
					},
				},
			} as object,
		);

		router.initialize();
		await waitForRoute(router, "home", 5000);
	});

	assert.ok(
		warnings.some((w) => w.message.includes("empty array")),
		"warning about empty array export",
	);
});

QUnit.test("leave guard from multi-guard object module", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteRegistration: "ignore",
				guards: {
					home: {
						leave: ["ui5/guard/router/qunit/fixtures/guards/objectGuard#checkRole"],
					},
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	// Try to leave "home" -- checkRole returns false, should block
	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "cherry-picked leave guard from object module blocks");
});

// ============================================================
// Module: parseGuardDescriptors edge cases
// ============================================================
QUnit.module("Router - parseGuardDescriptors edge cases", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("guards value is not a plain object (array) warns and registers no guards", async function (assert: Assert) {
	const warnings = captureWarnings(() => {
		router = new GuardRouterClass(
			[
				{ name: "home", pattern: "" },
				{ name: "protected", pattern: "protected" },
			],
			{
				async: true,
				guardRouter: {
					guardLoading: "block",
					guards: [1, 2, 3],
				},
			} as object,
		);
	});

	assert.ok(
		warnings.some((w) => w.message.includes("not a plain object")),
		"warning logged for non-object guards value",
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	// No manifest guards registered, so navigation should be allowed
	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "no guards block navigation");
});

QUnit.test("invalid entries in shorthand array warn and are skipped", function (assert: Assert) {
	const warnings = captureWarnings(() => {
		router = new GuardRouterClass([{ name: "home", pattern: "" }], {
			async: true,
			guardRouter: {
				guardLoading: "block",
				guards: { home: [42, null, ""] },
			},
		} as object);
	});

	const invalidEntryWarnings = warnings.filter((w) => w.message.includes("invalid entry"));
	assert.strictEqual(invalidEntryWarnings.length, 3, "one warning per invalid entry (42, null, empty string)");
});

QUnit.test("'*' with object form warns about leave and still registers enter guard", async function (assert: Assert) {
	const warnings = captureWarnings(() => {
		router = new GuardRouterClass(
			[
				{ name: "home", pattern: "" },
				{ name: "protected", pattern: "protected" },
			],
			{
				async: true,
				guardRouter: {
					guardLoading: "block",
					unknownRouteRegistration: "ignore",
					guards: {
						"*": {
							enter: ["ui5/guard/router/qunit/fixtures/guards/allowGuard"],
							leave: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
						},
					},
				},
			} as object,
		);
	});

	assert.ok(
		warnings.some((w) => w.message.includes("global leave guards are not supported")),
		"warning logged about global leave guards",
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	// The enter guard (allowGuard) should run and allow navigation
	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "enter guard from '*' still registered and allows");
});

// ============================================================
// Module: resolveModuleExports edge cases
// ============================================================
QUnit.module("Router - resolveModuleExports edge cases", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("module exporting a primitive warns and is skipped", async function (assert: Assert) {
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
					unknownRouteRegistration: "ignore",
					guards: {
						protected: ["ui5/guard/router/qunit/fixtures/guards/primitiveExportGuard"],
					},
				},
			} as object,
		);

		router.initialize();
		await waitForRoute(router, "home", 5000);
	});

	assert.ok(
		warnings.some((w) => w.message.includes("did not export a function, array, or plain object")),
		"warning logged for primitive module export",
	);

	// No valid guard registered, so navigation should succeed
	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "primitive export skipped, navigation allowed");
});

QUnit.test(
	"array module with non-function entries warns and registers only functions",
	async function (assert: Assert) {
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
						unknownRouteRegistration: "ignore",
						guards: {
							protected: ["ui5/guard/router/qunit/fixtures/guards/mixedArrayGuard"],
						},
					},
				} as object,
			);

			router.initialize();
			await waitForRoute(router, "home", 5000);
		});

		assert.ok(
			warnings.some((w) => w.message.includes("[1] is not a function")),
			"warning logged for non-function entry at index 1",
		);

		// The two valid function guards (index 0 and 2) both return true
		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(
			result.status,
			NavigationOutcome.Committed,
			"valid function guards registered and allow navigation",
		);
	},
);

QUnit.test("cherry-pick with out-of-range index warns and skips", async function (assert: Assert) {
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
					unknownRouteRegistration: "ignore",
					guards: {
						protected: ["ui5/guard/router/qunit/fixtures/guards/arrayGuard#99"],
					},
				},
			} as object,
		);

		router.initialize();
		await waitForRoute(router, "home", 5000);
	});

	assert.ok(
		warnings.some((w) => w.message.includes("#99") && w.message.includes("out of range")),
		"warning logged for out-of-range index",
	);

	// No guard registered, navigation should succeed
	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "out-of-range index skipped, navigation allowed");
});

// ============================================================
// Module: Block mode catastrophic load failure
// ============================================================
QUnit.module("Router - Block mode catastrophic load failure", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test(
	"block mode with invalid module path still initializes router after load failure",
	async function (assert: Assert) {
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
						unknownRouteRegistration: "ignore",
						guards: {
							protected: ["completely/nonexistent/guard/module/that/does/not/exist"],
						},
					},
				} as object,
			);

			router.initialize();

			// Wait for the async module loading to fail and the .then() handler to call super.initialize()
			await nextTick(500);
		});

		assert.ok(
			warnings.some((w) => w.message.includes("failed to load module")),
			"warning logged about module load failure",
		);

		assert.ok(router.isInitialized(), "router initialized despite load failure");

		// Navigation should still work (no guards registered -- the failed module was skipped)
		router.navTo("protected");
		await waitForRoute(router, "protected", 5000);
		assert.strictEqual(getHash(), "protected", "navigation works after load failure");
	},
);

// ============================================================
// Module: Router - Route metadata
// ============================================================
QUnit.module("Router - Route metadata", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("getRouteMeta returns manifest-defined metadata", function (assert: Assert) {
	router = createRouterWithOptions({
		routeMeta: {
			protected: { requiresAuth: true, roles: ["admin"] },
		},
	});

	const meta = router.getRouteMeta("protected");
	assert.strictEqual(meta.requiresAuth, true, "requiresAuth is true");
	assert.deepEqual(meta.roles, ["admin"], "roles array is present");
});

QUnit.test("getRouteMeta for unknown route returns empty and logs warning", function (assert: Assert) {
	router = createRouterWithOptions({});

	const warnings = captureWarnings(() => {
		const meta = router.getRouteMeta("nonexistent");
		assert.deepEqual(meta, {}, "empty object for unknown route");
		assert.ok(Object.isFrozen(meta), "returned object is frozen");
	});

	assert.ok(
		warnings.some((w) => w.message.includes("getRouteMeta")),
		"warning logged for unknown route",
	);
});

QUnit.test('getRouteMeta("") returns empty object without warning', function (assert: Assert) {
	router = createRouterWithOptions({});

	const warnings = captureWarnings(() => {
		const meta = router.getRouteMeta("");
		assert.deepEqual(meta, {}, "empty object for empty-string route");
	});

	assert.strictEqual(warnings.length, 0, "no warning for empty-string route name");
});

QUnit.test("setRouteMeta with non-object meta logs warning and is a no-op", function (assert: Assert) {
	router = createRouterWithOptions({
		routeMeta: { home: { original: true } },
	});

	const warnings = captureWarnings(() => {
		router.setRouteMeta("home", "not-an-object" as unknown as Record<string, unknown>);
	});

	assert.ok(
		warnings.some((w) => w.message.includes("setRouteMeta")),
		"warning logged for non-object meta",
	);
	assert.strictEqual(router.getRouteMeta("home").original, true, "original metadata preserved");
});

QUnit.test("setRouteMeta for unknown route follows unknownRouteRegistration policy", function (assert: Assert) {
	router = createRouterWithOptions({
		unknownRouteRegistration: "throw",
	});

	assert.throws(
		() => router.setRouteMeta("nonexistent", { key: true }),
		/setRouteMeta/,
		"throws for unknown route with throw policy",
	);
});

QUnit.test("setRouteMeta overrides manifest metadata", function (assert: Assert) {
	router = createRouterWithOptions({
		routeMeta: {
			protected: { requiresAuth: true, level: 1 },
		},
	});

	router.setRouteMeta("protected", { requiresAuth: false, custom: "value" });
	const meta = router.getRouteMeta("protected");
	assert.strictEqual(meta.requiresAuth, false, "runtime overrides manifest");
	assert.strictEqual(meta.custom, "value", "runtime adds new keys");
	assert.strictEqual(meta.level, 1, "manifest keys not in runtime are preserved");
});

QUnit.test("setRouteMeta works for routes without manifest metadata", function (assert: Assert) {
	router = createRouterWithOptions({});

	router.setRouteMeta("home", { public: true });
	const meta = router.getRouteMeta("home");
	assert.strictEqual(meta.public, true, "runtime metadata for unconfigured route");
});

QUnit.test("guard receives toMeta from manifest metadata", async function (assert: Assert) {
	router = createRouterWithOptions({
		routeMeta: {
			protected: { requiresAuth: true },
			home: { public: true },
		},
	});
	router.initialize();
	await waitForRoute(router, "home");

	let receivedToMeta: Record<string, unknown> | undefined;
	router.addGuard((context: GuardContext) => {
		receivedToMeta = context.toMeta;
		return true;
	});

	router.navTo("protected");
	await waitForRoute(router, "protected");

	assert.deepEqual(receivedToMeta, { requiresAuth: true }, "toMeta reflects target route metadata");
	assert.ok(Object.isFrozen(receivedToMeta), "toMeta is frozen");
});

QUnit.test("guard receives fromMeta for the current route", async function (assert: Assert) {
	router = createRouterWithOptions({
		routeMeta: {
			home: { public: true },
			protected: { requiresAuth: true },
		},
	});
	router.initialize();
	await waitForRoute(router, "home");

	let receivedFromMeta: Record<string, unknown> | undefined;
	router.addGuard((context: GuardContext) => {
		receivedFromMeta = context.fromMeta;
		return true;
	});

	router.navTo("protected");
	await waitForRoute(router, "protected");

	assert.deepEqual(receivedFromMeta, { public: true }, "fromMeta reflects source route metadata");
});

QUnit.test("runtime metadata changes reflected in subsequent navigations", async function (assert: Assert) {
	router = createRouterWithOptions({
		routeMeta: { protected: { requiresAuth: true } },
	});
	router.initialize();
	await waitForRoute(router, "home");

	const snapshots: Record<string, unknown>[] = [];
	router.addGuard((context: GuardContext) => {
		snapshots.push(context.toMeta);
		return true;
	});

	router.navTo("protected");
	await waitForRoute(router, "protected");

	router.setRouteMeta("home", { updated: true });
	router.navTo("home");
	await waitForRoute(router, "home");

	assert.deepEqual(snapshots[0], { requiresAuth: true }, "first navigation uses manifest meta");
	assert.deepEqual(snapshots[1], { updated: true }, "second navigation sees runtime meta");
});

QUnit.test("setRouteMeta during guard does not affect current context toMeta", async function (assert: Assert) {
	router = createRouterWithOptions({
		routeMeta: { protected: { version: 1 } },
	});

	let capturedToMeta: Record<string, unknown> | undefined;
	router.addGuard((context: GuardContext) => {
		if (context.toRoute === "protected") {
			// Mutate metadata mid-pipeline
			router.setRouteMeta("protected", { version: 2 });
		}
		return true;
	});
	router.addRouteGuard("protected", (context: GuardContext) => {
		capturedToMeta = context.toMeta;
		return true;
	});

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "protected");

	assert.strictEqual(capturedToMeta!.version, 1, "toMeta is a snapshot; mid-pipeline mutation does not affect it");
});

QUnit.test("toMeta is empty frozen object for routes without metadata", async function (assert: Assert) {
	router = createRouterWithOptions({});
	router.initialize();
	await waitForRoute(router, "home");

	let receivedToMeta: Record<string, unknown> | undefined;
	router.addGuard((context: GuardContext) => {
		receivedToMeta = context.toMeta;
		return true;
	});

	router.navTo("protected");
	await waitForRoute(router, "protected");

	assert.deepEqual(receivedToMeta, {}, "empty object for unconfigured route");
	assert.ok(Object.isFrozen(receivedToMeta), "empty meta is frozen");
});

QUnit.test("global auth guard using toMeta blocks unauthenticated access", async function (assert: Assert) {
	router = createRouterWithOptions({
		routeMeta: {
			protected: { requiresAuth: true },
			home: { public: true },
		},
	});

	let isLoggedIn = false;
	router.addGuard((context: GuardContext) => {
		if (context.toMeta.requiresAuth && !isLoggedIn) return "home";
		return true;
	});

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const blocked = await router.navigationSettled();
	assert.strictEqual(blocked.status, NavigationOutcome.Redirected, "unauthenticated user redirected");

	isLoggedIn = true;
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.ok(true, "authenticated user reaches protected route");
});

QUnit.test("invalid routeMeta entries produce warnings", function (assert: Assert) {
	const warnings = captureWarnings(() => {
		router = createRouterWithOptions({
			routeMeta: {
				home: "not an object",
				protected: { valid: true },
			},
		});
	});

	assert.ok(
		warnings.some((w) => w.message.includes('routeMeta["home"]')),
		"warning for non-object metadata entry",
	);
	assert.deepEqual(router.getRouteMeta("protected"), { valid: true }, "valid entries still parsed");
});

QUnit.test("non-object routeMeta produces warning", function (assert: Assert) {
	const warnings = captureWarnings(() => {
		router = createRouterWithOptions({
			routeMeta: "invalid",
		});
	});

	assert.ok(
		warnings.some((w) => w.message.includes("routeMeta")),
		"warning for non-object routeMeta",
	);
});

QUnit.test("fromMeta is empty frozen object on initial navigation", async function (assert: Assert) {
	router = createRouterWithOptions({
		routeMeta: { home: { public: true } },
	});

	let receivedFromMeta: Record<string, unknown> | undefined;
	router.addGuard((context: GuardContext) => {
		receivedFromMeta = context.fromMeta;
		return true;
	});

	router.initialize();
	await waitForRoute(router, "home");

	assert.deepEqual(receivedFromMeta, {}, "fromMeta is empty on initial navigation (no previous route)");
	assert.ok(Object.isFrozen(receivedFromMeta), "fromMeta is frozen");
});

QUnit.test("toMeta updates to redirect target while fromMeta stays pinned to source", async function (assert: Assert) {
	router = createRouterWithOptions({
		routeMeta: {
			home: { public: true },
			protected: { requiresAuth: true },
			forbidden: { restricted: true },
		},
	});

	router.addRouteGuard("protected", () => "forbidden");

	let redirectTargetToMeta: Record<string, unknown> | undefined;
	let redirectTargetFromMeta: Record<string, unknown> | undefined;
	router.addRouteGuard("forbidden", (context: GuardContext) => {
		redirectTargetToMeta = context.toMeta;
		redirectTargetFromMeta = context.fromMeta;
		return true;
	});

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "forbidden");

	assert.deepEqual(redirectTargetToMeta, { restricted: true }, "toMeta is for the redirect target (forbidden)");
	assert.deepEqual(redirectTargetFromMeta, { public: true }, "fromMeta stays pinned to the original source (home)");
});

QUnit.test("merged manifest+runtime metadata result is frozen", function (assert: Assert) {
	router = createRouterWithOptions({
		routeMeta: {
			protected: { requiresAuth: true, level: 1 },
		},
	});

	router.setRouteMeta("protected", { requiresAuth: false, custom: "value" });
	const meta = router.getRouteMeta("protected");

	assert.ok(Object.isFrozen(meta), "merged result is frozen");
	assert.strictEqual(meta.requiresAuth, false, "runtime overrides manifest");
	assert.strictEqual(meta.level, 1, "manifest keys preserved");
});

// ============================================================
// Module: Router - Guard and metadata inheritance
// ============================================================

/**
 * Create a router with hierarchical route patterns for inheritance tests.
 * These routes form a URL-tree where `employees` is an ancestor of
 * `employees/{id}`, which is in turn an ancestor of `employees/{id}/resume`.
 */
function createHierarchicalRouter(guardRouter: Record<string, unknown>): GuardRouter {
	return new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "employees", pattern: "employees" },
			{ name: "employee", pattern: "employees/{id}" },
			{ name: "employeeResume", pattern: "employees/{id}/resume" },
			{ name: "settings", pattern: "settings" },
			{ name: "settingsProfile", pattern: "settings/profile" },
		],
		{ async: true, guardRouter } as object,
	);
}

QUnit.module("Router - Guard and metadata inheritance", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

// -- Guard inheritance -------------------------------------------------------

QUnit.test(
	"guard on parent route runs for child route when inheritance is pattern-tree",
	async function (assert: Assert) {
		// Arrange: blocking guard on "employees", inheritance enabled
		router = createHierarchicalRouter({
			guardLoading: "block",
			inheritance: "pattern-tree",
			guards: {
				employees: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
			},
		});

		router.initialize();
		await waitForRoute(router, "home", 5000);

		// Act: navigate to a child route
		router.navTo("employee", { id: "42" });
		const result = await router.navigationSettled();

		// Assert: the ancestor's blocking guard prevents navigation
		assert.strictEqual(
			result.status,
			NavigationOutcome.Blocked,
			"ancestor blocking guard propagated to child route",
		);
	},
);

QUnit.test("guard on parent does NOT run for child when inheritance is none", async function (assert: Assert) {
	// Arrange: blocking guard on "employees", inheritance disabled (default)
	router = createHierarchicalRouter({
		guardLoading: "block",
		inheritance: "none",
		guards: {
			employees: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
		},
	});

	router.initialize();
	await waitForRoute(router, "home", 5000);

	// Act: navigate to a child route
	router.navTo("employee", { id: "42" });
	await waitForRoute(router, "employee");

	// Assert: child navigation succeeds because guard was not inherited
	assert.strictEqual(getHash(), "employees/42", "child route reached without ancestor guard");
});

QUnit.test("ancestor guards run before descendant guards (depth ordering)", async function (assert: Assert) {
	// Arrange: bagWriterGuard on ancestor, bagReaderGuard on child.
	// bagWriterGuard writes "writer" to context.bag; bagReaderGuard returns
	// true only if "writer" exists in the bag. If ancestor runs first the
	// navigation succeeds; if child runs first it blocks.
	router = createHierarchicalRouter({
		guardLoading: "block",
		inheritance: "pattern-tree",
		guards: {
			employees: ["ui5/guard/router/qunit/fixtures/guards/bagWriterGuard"],
			employee: ["ui5/guard/router/qunit/fixtures/guards/bagReaderGuard"],
		},
	});

	router.initialize();
	await waitForRoute(router, "home", 5000);

	// Act: navigate to the child route
	router.navTo("employee", { id: "42" });
	const result = await router.navigationSettled();

	// Assert: navigation succeeds because ancestor guard wrote before child guard read
	assert.strictEqual(
		result.status,
		NavigationOutcome.Committed,
		"ancestor guard ran before descendant guard (bagWriter before bagReader)",
	);
});

QUnit.test("global guards run before inherited route guards (pipeline separation)", async function (assert: Assert) {
	// Arrange: global bagWriterGuard + inherited bagReaderGuard on child route.
	// The global guard writes to context.bag, the route guard reads it.
	// If global runs first → navigation succeeds. If route runs first → blocks.
	// This proves globals and route guards are in separate pipeline stages,
	// and the depth sort does not displace globals.
	router = createHierarchicalRouter({
		guardLoading: "block",
		inheritance: "pattern-tree",
		guards: {
			"*": ["ui5/guard/router/qunit/fixtures/guards/bagWriterGuard"],
			employees: ["ui5/guard/router/qunit/fixtures/guards/bagReaderGuard"],
		},
	});

	router.initialize();
	await waitForRoute(router, "home", 5000);

	// Act: navigate to a child route that inherits the bagReaderGuard
	router.navTo("employee", { id: "42" });
	const result = await router.navigationSettled();

	// Assert: global guard wrote to bag before inherited route guard read it
	assert.strictEqual(
		result.status,
		NavigationOutcome.Committed,
		"global guard ran before inherited route guard (pipeline stages are separate)",
	);
});

QUnit.test("guard on child does NOT propagate upward to parent", async function (assert: Assert) {
	// Arrange: blocking guard only on the child route, inheritance enabled
	router = createHierarchicalRouter({
		guardLoading: "block",
		inheritance: "pattern-tree",
		guards: {
			employee: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
		},
	});

	router.initialize();
	await waitForRoute(router, "home", 5000);

	// Act: navigate to the parent route
	router.navTo("employees");
	await waitForRoute(router, "employees");

	// Assert: parent route is reachable -- child guard did not propagate up
	assert.strictEqual(getHash(), "employees", "parent route reached; child guard did not propagate upward");
});

// -- Metadata inheritance ----------------------------------------------------

QUnit.test("metadata propagates to child routes when inheritance is pattern-tree", function (assert: Assert) {
	// Arrange: metadata on ancestor, inheritance enabled
	router = createHierarchicalRouter({
		inheritance: "pattern-tree",
		routeMeta: {
			employees: { requiresAuth: true },
		},
	});

	// Assert: child route inherits ancestor metadata
	const meta = router.getRouteMeta("employee");
	assert.strictEqual(meta.requiresAuth, true, "child route inherited requiresAuth from ancestor");
});

QUnit.test("child metadata overrides ancestor metadata on conflict", function (assert: Assert) {
	// Arrange: both ancestor and child define "level"
	router = createHierarchicalRouter({
		inheritance: "pattern-tree",
		routeMeta: {
			employees: { level: 1 },
			employee: { level: 2 },
		},
	});

	// Assert: child's own value wins
	const meta = router.getRouteMeta("employee");
	assert.strictEqual(meta.level, 2, "child metadata overrides ancestor on conflict");
});

QUnit.test("metadata does NOT propagate when inheritance is none", function (assert: Assert) {
	// Arrange: metadata on ancestor, inheritance disabled (default)
	router = createHierarchicalRouter({
		inheritance: "none",
		routeMeta: {
			employees: { requiresAuth: true },
		},
	});

	// Assert: child route has no inherited metadata
	const meta = router.getRouteMeta("employee");
	assert.deepEqual(meta, {}, "child route has no metadata when inheritance is none");
});

QUnit.test("metadata merges across multiple ancestor levels", function (assert: Assert) {
	// Arrange: metadata at two ancestor levels
	router = createHierarchicalRouter({
		inheritance: "pattern-tree",
		routeMeta: {
			employees: { section: "hr" },
			employee: { requiresAuth: true },
		},
	});

	// Assert: grandchild merges metadata from both ancestors
	const meta = router.getRouteMeta("employeeResume");
	assert.strictEqual(meta.section, "hr", "grandchild inherited section from root ancestor");
	assert.strictEqual(meta.requiresAuth, true, "grandchild inherited requiresAuth from parent");
});

// -- Integration with toMeta ------------------------------------------------

QUnit.test("inherited metadata is visible on context.toMeta in guards", async function (assert: Assert) {
	// Arrange: metadata on ancestor, both inheritance modes enabled
	router = createHierarchicalRouter({
		inheritance: "pattern-tree",
		routeMeta: {
			employees: { section: "hr", requiresAuth: true },
		},
	});

	let receivedToMeta: Record<string, unknown> | undefined;
	router.addRouteGuard("employee", (context: GuardContext) => {
		receivedToMeta = context.toMeta;
		return true;
	});

	router.initialize();
	await waitForRoute(router, "home");

	// Act: navigate to child route
	router.navTo("employee", { id: "42" });
	await waitForRoute(router, "employee");

	// Assert: toMeta includes inherited metadata
	assert.ok(receivedToMeta !== undefined, "guard received toMeta");
	assert.strictEqual(receivedToMeta!.section, "hr", "toMeta includes inherited section");
	assert.strictEqual(receivedToMeta!.requiresAuth, true, "toMeta includes inherited requiresAuth");
});

QUnit.test("runtime setRouteMeta participates in inheritance", function (assert: Assert) {
	router = createHierarchicalRouter({
		inheritance: "pattern-tree",
	});

	router.setRouteMeta("employees", { runtimeKey: true });
	const childMeta = router.getRouteMeta("employee");
	assert.strictEqual(childMeta.runtimeKey, true, "runtime metadata propagates to descendants");

	const ownMeta = router.getRouteMeta("employees");
	assert.strictEqual(ownMeta.runtimeKey, true, "runtime metadata is available on the declared route");
});

QUnit.test("setRouteMeta invalidates cache so getRouteMeta returns fresh result", function (assert: Assert) {
	router = createHierarchicalRouter({
		inheritance: "pattern-tree",
		routeMeta: {
			employees: { section: "hr" },
		},
	});

	// First read populates cache
	assert.strictEqual(router.getRouteMeta("employee").section, "hr", "inherited before mutation");

	// Mutate parent runtime metadata
	router.setRouteMeta("employees", { section: "engineering" });

	// Second read: cache was invalidated, fresh walk
	assert.strictEqual(router.getRouteMeta("employee").section, "engineering", "inherits updated runtime value");
});

QUnit.test("guard inheritance works in lazy loading mode", async function (assert: Assert) {
	router = createHierarchicalRouter({
		guardLoading: "lazy",
		inheritance: "pattern-tree",
		guards: {
			employees: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
		},
	});

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("employee", { id: "42" });
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"ancestor guard propagated to child in lazy loading mode",
	);
});

// ============================================================
// Module: Pattern ancestry -- UI5 pattern syntax edge cases
// ============================================================

QUnit.module("Router - Pattern ancestry edge cases", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("metadata inherits when parent and child use different parameter names", function (assert: Assert) {
	// Arrange: parent uses {empId}, child uses {id} -- should still be recognized as ancestor
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "employees", pattern: "employees/{empId}" },
			{ name: "employeeResume", pattern: "employees/{id}/resume" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				routeMeta: { employees: { section: "hr" } },
			},
		} as object,
	);

	const meta = router.getRouteMeta("employeeResume");
	assert.strictEqual(meta.section, "hr", "child inherits despite different parameter name");
});

QUnit.test("optional parameter segments do not break ancestry detection", function (assert: Assert) {
	// Arrange: parent has an optional segment, child extends the mandatory path
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "products", pattern: "products/:sort:" },
			{ name: "product", pattern: "products/{id}" },
			{ name: "productDetail", pattern: "products/{id}/detail" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				routeMeta: { products: { category: "catalog" } },
			},
		} as object,
	);

	const detailMeta = router.getRouteMeta("productDetail");
	assert.strictEqual(detailMeta.category, "catalog", "grandchild inherits through optional-param parent");
});

QUnit.test("inline query parameter suffix does not affect ancestry", function (assert: Assert) {
	// Arrange: parent pattern has {?query} attached directly (canonical UI5 form)
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "search", pattern: "search{?query}" },
			{ name: "searchResult", pattern: "search/{id}" },
			{ name: "searchResultDetail", pattern: "search/{id}/detail" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				routeMeta: { search: { filterable: true } },
			},
		} as object,
	);

	const detailMeta = router.getRouteMeta("searchResultDetail");
	assert.strictEqual(detailMeta.filterable, true, "inline query suffix on ancestor does not block inheritance");
});

QUnit.test("inline optional query suffix does not affect ancestry", function (assert: Assert) {
	// Arrange: parent pattern has :?query: attached directly
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "catalog", pattern: "catalog:?query:" },
			{ name: "catalogItem", pattern: "catalog/{id}" },
			{ name: "catalogItemDetail", pattern: "catalog/{id}/detail" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				routeMeta: { catalog: { browsable: true } },
			},
		} as object,
	);

	const detailMeta = router.getRouteMeta("catalogItemDetail");
	assert.strictEqual(
		detailMeta.browsable,
		true,
		"inline optional query suffix on ancestor does not block inheritance",
	);
});

QUnit.test("rest parameter segments do not affect ancestry", function (assert: Assert) {
	// Arrange: parent has a catch-all rest segment
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "docs", pattern: "docs/:path*:" },
			{ name: "docsSection", pattern: "docs/{section}" },
			{ name: "docsPage", pattern: "docs/{section}/{page}" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				routeMeta: { docs: { layout: "reader" } },
			},
		} as object,
	);

	const pageMeta = router.getRouteMeta("docsPage");
	assert.strictEqual(pageMeta.layout, "reader", "rest segment on ancestor does not block inheritance");
});

QUnit.test("sibling routes do not inherit from each other", function (assert: Assert) {
	// Arrange: two routes at the same depth under the same parent
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "employees", pattern: "employees" },
			{ name: "employeeList", pattern: "employees/list" },
			{ name: "employeeNew", pattern: "employees/new" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				routeMeta: { employeeList: { view: "list" } },
			},
		} as object,
	);

	const newMeta = router.getRouteMeta("employeeNew");
	assert.deepEqual(newMeta, {}, "sibling route does not inherit from another sibling");
});

QUnit.test("guard inheritance works with mixed parameter names", async function (assert: Assert) {
	// Arrange: parent guard on `orders/{orderId}`, child is `orders/{id}/items`
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "order", pattern: "orders/{orderId}" },
			{ name: "orderItems", pattern: "orders/{id}/items" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				inheritance: "pattern-tree",
				guards: {
					order: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("orderItems", { id: "99" });
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"ancestor guard propagated despite different param name",
	);
});

QUnit.test("mandatory param combined with inline query does not break ancestry", function (assert: Assert) {
	// UI5 allows {id}{?query} -- the query portion is stripped, leaving just {id}
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "product", pattern: "products/{id}{?query}" },
			{ name: "productReviews", pattern: "products/{id}/reviews" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				routeMeta: { product: { tracked: true } },
			},
		} as object,
	);

	const reviewMeta = router.getRouteMeta("productReviews");
	assert.strictEqual(reviewMeta.tracked, true, "child inherits from parent with {param}{?query} combo");
});

QUnit.test("optional parameter in mid-path position does not block inheritance", function (assert: Assert) {
	// :mode: at the start is stripped, so the mandatory prefix is "app"
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "app", pattern: "app/:mode:" },
			{ name: "appSettings", pattern: "app/{section}" },
			{ name: "appSettingsDetail", pattern: "app/{section}/detail" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				routeMeta: { app: { layout: "shell" } },
			},
		} as object,
	);

	const detailMeta = router.getRouteMeta("appSettingsDetail");
	assert.strictEqual(detailMeta.layout, "shell", "grandchild inherits through ancestor with trailing optional param");
});

QUnit.test("all-optional pattern is not treated as ancestor of other routes", function (assert: Assert) {
	// Pattern ":mode:" consists entirely of optional segments -- should NOT be ancestor of anything
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "catchMode", pattern: ":mode:" },
			{ name: "employees", pattern: "employees" },
			{ name: "employee", pattern: "employees/{id}" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				routeMeta: { catchMode: { fromCatchall: true } },
			},
		} as object,
	);

	const employeesMeta = router.getRouteMeta("employees");
	assert.strictEqual(
		employeesMeta.fromCatchall,
		undefined,
		"all-optional pattern does not propagate metadata to other routes",
	);
	const employeeMeta = router.getRouteMeta("employee");
	assert.strictEqual(
		employeeMeta.fromCatchall,
		undefined,
		"all-optional pattern does not propagate metadata to deeper routes",
	);
});

QUnit.test("multiple consecutive optional params are ignored for ancestry", function (assert: Assert) {
	// Pattern "reports/:year:/:month:" -- only "reports" is mandatory
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "reports", pattern: "reports/:year:/:month:" },
			{ name: "report", pattern: "reports/{id}" },
			{ name: "reportDetail", pattern: "reports/{id}/detail" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				routeMeta: { reports: { section: "analytics" } },
			},
		} as object,
	);

	const detailMeta = router.getRouteMeta("reportDetail");
	assert.strictEqual(
		detailMeta.section,
		"analytics",
		"grandchild inherits through ancestor with multiple optional params",
	);
});

QUnit.test("rest catchall pattern with prefix still acts as ancestor", function (assert: Assert) {
	// Pattern "files/:path*:" -- "files" is mandatory, :path*: is rest/catchall
	// "files/{id}" should inherit from "files/:path*:"
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "files", pattern: "files/:path*:" },
			{ name: "file", pattern: "files/{id}" },
			{ name: "fileVersion", pattern: "files/{id}/version" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				routeMeta: { files: { storage: "cloud" } },
			},
		} as object,
	);

	const versionMeta = router.getRouteMeta("fileVersion");
	assert.strictEqual(versionMeta.storage, "cloud", "grandchild inherits through ancestor with rest param");
});

// ============================================================
// Module: Root-pattern route ("") as universal ancestor
// ============================================================

QUnit.module("Router - Root-pattern route as universal ancestor", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test(
	"metadata on root-pattern route propagates to all routes with pattern-tree inheritance",
	function (assert: Assert) {
		router = createHierarchicalRouter({
			inheritance: "pattern-tree",
			routeMeta: {
				home: { requiresAuth: true, appName: "demo" },
			},
		});

		assert.strictEqual(router.getRouteMeta("employees").requiresAuth, true, "employees inherits from root");
		assert.strictEqual(router.getRouteMeta("employee").requiresAuth, true, "employee inherits from root");
		assert.strictEqual(
			router.getRouteMeta("employeeResume").requiresAuth,
			true,
			"employeeResume inherits from root",
		);
		assert.strictEqual(router.getRouteMeta("settings").requiresAuth, true, "settings inherits from root");
		assert.strictEqual(
			router.getRouteMeta("settingsProfile").requiresAuth,
			true,
			"settingsProfile inherits from root",
		);
		assert.strictEqual(router.getRouteMeta("settingsProfile").appName, "demo", "second key also propagates");
	},
);

QUnit.test("child metadata overrides root-pattern metadata on conflict", function (assert: Assert) {
	router = createHierarchicalRouter({
		inheritance: "pattern-tree",
		routeMeta: {
			home: { requiresAuth: true, theme: "default" },
			employees: { requiresAuth: false },
		},
	});

	const employeesMeta = router.getRouteMeta("employees");
	assert.strictEqual(employeesMeta.requiresAuth, false, "employees overrides root requiresAuth");
	assert.strictEqual(employeesMeta.theme, "default", "employees inherits non-conflicting key from root");

	const employeeMeta = router.getRouteMeta("employee");
	assert.strictEqual(employeeMeta.requiresAuth, false, "employee inherits override from employees, not root");
	assert.strictEqual(employeeMeta.theme, "default", "employee inherits theme from root");
});

QUnit.test(
	"guard on root-pattern route propagates to all routes with pattern-tree inheritance",
	async function (assert: Assert) {
		// Use bagWriterGuard on root -- it allows navigation and writes to context.bag,
		// proving it ran. Then add a bagReaderGuard imperatively on the descendant
		// to verify the inherited guard wrote to the bag before the reader ran.
		router = createHierarchicalRouter({
			guardLoading: "block",
			inheritance: "pattern-tree",
			guards: {
				home: ["ui5/guard/router/qunit/fixtures/guards/bagWriterGuard"],
			},
		});

		router.initialize();
		await waitForRoute(router, "home", 5000);

		// Add an imperative bagReaderGuard on "employees" -- it blocks if "writer"
		// key is NOT in the bag. If the inherited root guard wrote to the bag,
		// the reader will find it and allow navigation.
		let bagHadWriter = false;
		router.addRouteGuard("employees", (context: GuardContext) => {
			bagHadWriter = context.bag.has("writer");
			return true;
		});

		router.navTo("employees");
		await waitForRoute(router, "employees");

		assert.ok(bagHadWriter, "inherited root guard wrote to bag before route guard ran on descendant");
	},
);

QUnit.test("root-pattern route does NOT propagate when inheritance is none", function (assert: Assert) {
	router = createHierarchicalRouter({
		inheritance: "none",
		routeMeta: {
			home: { requiresAuth: true },
		},
	});

	assert.deepEqual(router.getRouteMeta("employees"), {}, "employees has no metadata when inheritance is none");
	assert.deepEqual(router.getRouteMeta("settings"), {}, "settings has no metadata when inheritance is none");
});

QUnit.test("root-pattern metadata is the shallowest layer in multi-level merge", function (assert: Assert) {
	router = createHierarchicalRouter({
		inheritance: "pattern-tree",
		routeMeta: {
			home: { appLevel: "root", section: "none" },
			employees: { section: "hr" },
			employee: { detail: true },
		},
	});

	const resumeMeta = router.getRouteMeta("employeeResume");
	assert.strictEqual(resumeMeta.appLevel, "root", "root metadata reaches deepest descendant");
	assert.strictEqual(resumeMeta.section, "hr", "employees overrides root section");
	assert.strictEqual(resumeMeta.detail, true, "employee adds its own key");
});

// ============================================================
// Module: Multi-hop redirect metadata
// ============================================================

QUnit.module("Router - Multi-hop redirect metadata", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("toMeta and fromMeta are correct across a multi-hop redirect chain", async function (assert: Assert) {
	router = createRouterWithOptions({
		routeMeta: {
			home: { public: true },
			protected: { requiresAuth: true },
			forbidden: { restricted: true },
			detail: { page: "detail" },
		},
	});

	// protected → forbidden → detail (two redirects)
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => ({ route: "detail", parameters: { id: "1" } }));

	const snapshots: { toMeta: Record<string, unknown>; fromMeta: Record<string, unknown> }[] = [];
	router.addRouteGuard("detail", (context: GuardContext) => {
		snapshots.push({ toMeta: { ...context.toMeta }, fromMeta: { ...context.fromMeta } });
		return true;
	});

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "detail");

	assert.strictEqual(snapshots.length, 1, "detail guard ran once");
	assert.deepEqual(snapshots[0].toMeta, { page: "detail" }, "toMeta is for the final redirect target");
	assert.deepEqual(snapshots[0].fromMeta, { public: true }, "fromMeta stays pinned to original source across hops");
});

// ============================================================
// Module: Dynamic addRoute() with inheritance
// ============================================================
QUnit.module("Router - Dynamic addRoute() with inheritance", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test(
	"addRoute() after initialize makes new route visible to metadata inheritance",
	async function (assert: Assert) {
		router = new GuardRouterClass(
			[
				{ name: "home", pattern: "" },
				{ name: "employees", pattern: "employees" },
			],
			{
				async: true,
				guardRouter: {
					inheritance: "pattern-tree",
					routeMeta: {
						employees: { requiresAuth: true, section: "hr" },
					},
				},
			} as object,
		);

		router.initialize();
		await waitForRoute(router, "home", 5000);

		// Dynamically add a child route after initialization
		addRouteDynamic(router, { name: "employee", pattern: "employees/{id}" });

		const meta = router.getRouteMeta("employee");
		assert.strictEqual(meta.requiresAuth, true, "child inherits ancestor manifest metadata");
		assert.strictEqual(meta.section, "hr", "child inherits all ancestor metadata keys");
	},
);

QUnit.test("addRoute() registers inherited manifest guards for new descendant route", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "employees", pattern: "employees" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				guardLoading: "block",
				unknownRouteRegistration: "ignore",
				guards: {
					employees: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	// Dynamically add a child route
	addRouteDynamic(router, { name: "employee", pattern: "employees/{id}" });

	router.navTo("employee", { id: "42" });
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"inherited guard blocks navigation to dynamic child route",
	);
});

QUnit.test("addRoute() with inheritance: none does not register inherited guards", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "employees", pattern: "employees" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "none",
				guardLoading: "block",
				unknownRouteRegistration: "ignore",
				guards: {
					employees: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	addRouteDynamic(router, { name: "employee", pattern: "employees/{id}" });

	router.navTo("employee", { id: "42" });
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Committed, "no guard inheritance when inheritance is none");
});

QUnit.test("addRoute() clears metadata cache so inheritance updates", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "employees", pattern: "employees" },
			{ name: "employee", pattern: "employees/{id}" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				routeMeta: {
					employees: { section: "hr" },
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	// Read metadata for employee before adding a deeper route
	const metaBefore = router.getRouteMeta("employee");
	assert.strictEqual(metaBefore.section, "hr", "child inherits before addRoute");

	// Add a deeper child -- cache must be cleared
	addRouteDynamic(router, { name: "employeeResume", pattern: "employees/{id}/resume" });

	const metaDeep = router.getRouteMeta("employeeResume");
	assert.strictEqual(metaDeep.section, "hr", "deeply nested dynamic route inherits ancestor metadata");
});

QUnit.test("addRoute() for already-known route is a no-op", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "employees", pattern: "employees" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				guardLoading: "block",
				unknownRouteRegistration: "ignore",
				guards: {
					employees: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	// Re-add "employees" which already exists -- should be a no-op
	addRouteDynamic(router, { name: "employees", pattern: "employees" });

	// Guard should still work normally (not duplicated)
	router.navTo("employees");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "re-adding existing route does not break guards");
});

QUnit.test("setRouteMeta for unknown route becomes visible after addRoute()", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "employees", pattern: "employees" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				unknownRouteRegistration: "ignore",
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	// Set metadata for a route that doesn't exist yet
	router.setRouteMeta("employee", { clearance: "manager" });

	// getRouteMeta returns empty because route doesn't exist
	const metaBefore = router.getRouteMeta("employee");
	assert.deepEqual(metaBefore, {}, "unknown route returns empty meta before addRoute");

	// Now add the route
	addRouteDynamic(router, { name: "employee", pattern: "employees/{id}" });

	// Metadata should now be visible (inherits from employees + own runtime)
	const metaAfter = router.getRouteMeta("employee");
	assert.strictEqual(metaAfter.clearance, "manager", "pre-set runtime metadata becomes visible after addRoute");
});

QUnit.test("setRouteMeta on unknown route with warn policy logs a warning", async function (assert: Assert) {
	router = new GuardRouterClass([{ name: "home", pattern: "" }], {
		async: true,
		guardRouter: {
			unknownRouteRegistration: "warn",
		},
	} as object);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	const warnings = captureWarnings(() => {
		router.setRouteMeta("nonexistent", { key: "value" });
	});

	assert.ok(
		warnings.some((w) => w.message.includes("unknown route")),
		"warning logged for setRouteMeta on unknown route with warn policy",
	);

	// Despite the warning, the data is stored
	addRouteDynamic(router, { name: "nonexistent", pattern: "nonexistent" });
	const meta = router.getRouteMeta("nonexistent");
	assert.strictEqual(meta.key, "value", "metadata stored despite warning and accessible after addRoute");
});
