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
				unknownRouteGuardRegistration: "ignore",
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
				unknownRouteGuardRegistration: "ignore",
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
		// "ignore" policy means registering guard on unknown route produces NO warning
		const warnings = captureWarnings(() => {
			manifestRouter.addRouteGuard("totallyUnknownRoute", () => true);
		});
		const unknownRouteWarnings = warnings.filter((w) => w.message.includes("unknown route"));
		assert.strictEqual(
			unknownRouteWarnings.length,
			0,
			"unknownRouteGuardRegistration='ignore' suppresses warnings",
		);
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
					unknownRouteGuardRegistration: "ignore",
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
				unknownRouteGuardRegistration: "ignore",
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

// ============================================================
// Module: Named guard logging
// ============================================================
QUnit.module("Router - Named guard logging", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("warning for non-function object entry includes property name", async function (assert: Assert) {
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
		"warning includes the property name 'notAFunction'",
	);
	assert.ok(
		warnings.some((w) => w.message.includes("alsoNotAFunction")),
		"warning includes the property name 'alsoNotAFunction'",
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
					unknownRouteGuardRegistration: "ignore",
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
				unknownRouteGuardRegistration: "ignore",
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
				unknownRouteGuardRegistration: "ignore",
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
				unknownRouteGuardRegistration: "ignore",
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
					unknownRouteGuardRegistration: "ignore",
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
					unknownRouteGuardRegistration: "ignore",
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
						unknownRouteGuardRegistration: "ignore",
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
					unknownRouteGuardRegistration: "ignore",
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
						unknownRouteGuardRegistration: "ignore",
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

QUnit.test("getRouteMeta returns empty object for unknown routes", function (assert: Assert) {
	router = createRouterWithOptions({});

	const meta = router.getRouteMeta("nonexistent");
	assert.deepEqual(meta, {}, "empty object for unknown route");
	assert.ok(Object.isFrozen(meta), "returned object is frozen");
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
