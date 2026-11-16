import Component from "sap/ui/core/Component";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardContext, GuardFn, GuardRouter } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import {
	captureWarnings,
	captureErrorsAsync,
	captureWarningsAsync,
	createRouter,
	createRouterUnsafe,
	flushPromises,
	getComponentRouter,
	GuardRouterClass,
	initHashChanger,
	getHash,
	recordHashChanges,
	waitForRoute,
} from "./testHelpers";

let router: GuardRouter;

const FIXTURES = "ui5/guard/router/qunit/fixtures/guards";

function createLazyRouter(guards: Record<string, string[]>): GuardRouter {
	return new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
			{ name: "forbidden", pattern: "forbidden" },
		],
		{ async: true, guardRouter: { guardLoading: "lazy", unknownRouteRegistration: "ignore", guards } },
	);
}

// Load fixtures by the module name the router uses: the test page loads test files under
// test-resources/, so a relative import would get a second instance of the module.
function loadModule<T>(path: string): Promise<T> {
	return new Promise((resolve, reject) => sap.ui.require([path], (mod: T) => resolve(mod), reject));
}

interface LazyProbe {
	calls: string[];
	behaviors: GuardFn[];
}

async function loadProbe(): Promise<LazyProbe> {
	const probe = await loadModule<LazyProbe>(`${FIXTURES}/lazyProbe`);
	probe.calls.length = 0;
	probe.behaviors = [];
	return probe;
}

// ============================================================
// Module: Declarative manifest guards: block loading
// ============================================================
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
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"manifest-declared blocking guard prevents navigation",
	);
});

QUnit.test("a manifest guard that throws is logged with its name (block mode)", async function (assert: Assert) {
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
				guards: { protected: [`${FIXTURES}/throwingArrayGuard`] },
			},
		},
	);
	router.initialize();
	await waitForRoute(router, "home");

	const errors = await captureErrorsAsync(async () => {
		router.navTo("protected");
		assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Error);
	});
	assert.deepEqual(
		errors.map((entry) => entry.message),
		['Enter guard [1] "throwingArrayGuard#1" on route "protected" threw, navigation failed'],
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
					"*": ["ui5/guard/router/qunit/fixtures/guards/bagWriterGuard"],
				},
			},
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	// Probe: an imperative route guard sees what the manifest global guard wrote
	let writerValue: unknown;
	router.addRouteGuard("protected", (context: GuardContext) => {
		writerValue = context.bag.get("writer");
		return true;
	});

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Committed, "navigation committed");
	assert.strictEqual(writerValue, "was-here", "manifest '*' guard registered and ran");
});

QUnit.test("manifest guards run before imperatively registered guards", async function (assert: Assert) {
	// Arrange: router with bagWriterGuard as manifest guard. It writes to context.bag
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
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

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
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

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
		},
	);

	// Start async module loading, then immediately destroy.
	router.initialize();
	router.destroy();

	// A second require of the failing module reports after the router's own; then let Promise.all settle.
	await new Promise<void>((resolve) => {
		sap.ui.require(
			["nonexistent/guard/module"],
			() => resolve(),
			() => resolve(),
		);
	});
	await flushPromises();

	// UI5's destroy() resets _bIsInitialized to false. If the .then()
	// callback ignored the _destroyed flag and called super.initialize(),
	// _bIsInitialized would be true again.
	assert.notOk(router.isInitialized(), "Router was not re-initialized after destroy() during block loading");

	// Re-assign so afterEach doesn't double-destroy (MobileRouter.destroy is not idempotent).
	router = createRouter();
});

// ============================================================
// Module: Declarative manifest guards: lazy loading
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
		},
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
				// No guardLoading specified; should default to "lazy"
				unknownRouteRegistration: "ignore",
				guards: {
					protected: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
				},
			},
		},
	);

	// In lazy mode, initialize() is synchronous
	router.initialize();

	// The guard should still work on first navigation (lazy loads it)
	await waitForRoute(router, "home");
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
		const manifestRouter = getComponentRouter(component);
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
		await waitForRoute(manifestRouter, "home");

		const recorder = recordHashChanges();
		manifestRouter.navTo("protected");
		const result = await manifestRouter.navigationSettled();
		recorder.stop();

		assert.strictEqual(
			result.status,
			NavigationOutcome.Blocked,
			"navToPreflight='guard' blocks navigation before hash change",
		);
		assert.deepEqual(recorder.hashes, [], "hash never changed because preflight blocked navTo");
	} finally {
		component.destroy();
	}
});

QUnit.test("guard context exposes the owner component, including on redirect hops", async function (assert: Assert) {
	initHashChanger();
	const component = await Component.create({
		name: "ui5.guard.router.qunit.fixtures.manifest",
	});

	try {
		const manifestRouter = getComponentRouter(component);
		const contexts: GuardContext[] = [];
		// Global guards run before the manifest blockGuard, so this redirect wins.
		manifestRouter.addGuard((context: GuardContext) => {
			contexts.push(context);
			return context.toRoute === "protected" ? "home" : true;
		});
		manifestRouter.initialize();
		await waitForRoute(manifestRouter, "home");

		manifestRouter.navTo("protected");
		await manifestRouter.navigationSettled();

		const routes = contexts.map((context) => context.toRoute);
		assert.deepEqual(
			routes,
			["home", "protected", "home"],
			"initial, preflight and redirect-hop contexts captured",
		);
		assert.ok(
			contexts.every((context) => context.ownerComponent === component),
			"every context references the owning component",
		);
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
		const manifestRouter = getComponentRouter(component);
		manifestRouter.initialize();
		await waitForRoute(manifestRouter, "home");

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
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "guard loaded via module: prefix blocks navigation");
});

QUnit.test('"module:" prefix with slash notation (UI5 convention)', async function (assert: Assert) {
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
					protected: ["module:ui5/guard/router/qunit/fixtures/guards/blockGuard"],
				},
			},
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"slash notation after module: prefix resolves correctly",
	);
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
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

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
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

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
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

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
			},
		);

		router.initialize();
		await waitForRoute(router, "home");

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
						protected: ["ui5/guard/router/qunit/fixtures/guards/objectGuard#0"],
					},
				},
			},
		);

		router.initialize();
		await waitForRoute(router, "home");
	});
	assert.deepEqual(warnings, [], "export resolved without a load or lookup warning");

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
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

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
			},
		);

		router.initialize();
		await waitForRoute(router, "home");
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
		},
	);

	// lazy mode: initialize() registers lazy wrappers synchronously.
	// Navigate directly to "other". The lazy wrapper will load the module
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
						protected: ["module:ui5.guard.router.qunit.fixtures.guards.objectGuard#checkAuth"],
					},
				},
			},
		);

		router.initialize();
		await waitForRoute(router, "home");
	});
	assert.deepEqual(warnings, [], "export resolved without a load or lookup warning");

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
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

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
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

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
			},
		);

		router.initialize();
		await waitForRoute(router, "home");
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
			},
		);

		router.initialize();
		await waitForRoute(router, "home");
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
	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"valid (blocking) guard registered, invalid entries skipped",
	);
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
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

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
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

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
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"lazy array module: blockSecond (false) blocks after expansion",
	);
});

QUnit.test("lazy mode: uncached module runs all of its guards in order", async function (assert: Assert) {
	const path = `${FIXTURES}/lazyUncachedGuard`;
	const probe = await loadProbe();
	router = createLazyRouter({ protected: [path] });
	router.initialize();
	assert.strictEqual(sap.ui.require(path), undefined, "module was not cached when the guards were registered");
	await waitForRoute(router, "home");

	const visit = async (behaviors: GuardFn[]): Promise<{ status: string; calls: string[] }> => {
		probe.calls.length = 0;
		probe.behaviors = behaviors;
		router.navTo("protected");
		const { status } = await router.navigationSettled();
		if (status === NavigationOutcome.Committed) {
			router.navTo("home");
			await router.navigationSettled();
		}
		return { status, calls: [...probe.calls] };
	};
	const both = ["uncachedFirst", "uncachedSecond"];

	router.navTo("protected");
	router.navTo("home");
	await router.navigationSettled();
	await loadModule(path);
	await flushPromises();
	assert.deepEqual(probe.calls, [], "a navigation superseded while the module loads runs no guards");

	assert.deepEqual(await visit([]), { status: NavigationOutcome.Committed, calls: both }, "first navigation");
	probe.calls.length = 0;
	router.navTo("protected");
	assert.strictEqual(HashChanger.getInstance().getHash(), "protected", "later navigation commits within navTo");
	assert.deepEqual(probe.calls, both, "later navigation runs all guards");
	router.navTo("home");
	await router.navigationSettled();
	assert.deepEqual(
		await visit([() => Promise.resolve(true), () => false]),
		{ status: NavigationOutcome.Blocked, calls: both },
		"a guard after an async one still runs and can block",
	);
	assert.deepEqual(
		await visit([() => true, () => Promise.resolve(true)]),
		{ status: NavigationOutcome.Committed, calls: both },
		"an async last guard runs once and no guard runs twice",
	);
	assert.deepEqual(
		await visit([() => Promise.resolve(false)]),
		{ status: NavigationOutcome.Blocked, calls: ["uncachedFirst"] },
		"an async block stops the remaining guards",
	);
	assert.deepEqual(
		await visit([() => false]),
		{ status: NavigationOutcome.Blocked, calls: ["uncachedFirst"] },
		"a sync block stops the remaining guards",
	);

	const firstCalled = Promise.withResolvers<void>();
	const gate = Promise.withResolvers<boolean>();
	probe.calls.length = 0;
	probe.behaviors = [
		() => {
			firstCalled.resolve();
			return gate.promise;
		},
	];
	router.navTo("protected");
	await firstCalled.promise;
	router.navTo("home");
	await router.navigationSettled();
	gate.resolve(true);
	await flushPromises();
	assert.deepEqual(probe.calls, ["uncachedFirst"], "a superseded navigation stops the remaining guards");
});

QUnit.test("lazy mode: uncached cherry-pick loads the picked export", async function (assert: Assert) {
	const path = `${FIXTURES}/lazyUncachedPickGuard`;
	router = createLazyRouter({ protected: [`${path}#block`] });
	router.initialize();
	assert.strictEqual(sap.ui.require(path), undefined, "module was not cached when the guard was registered");
	await waitForRoute(router, "home");

	router.navTo("protected");
	assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Blocked, "picked export ran");
});

// Separate router per module: the constructor preloads every configured module, which would
// otherwise cache this one while the other navigation is pending.
QUnit.test("lazy mode: uncached cherry-pick of a missing export allows", async function (assert: Assert) {
	const path = `${FIXTURES}/lazyUncachedMissingPickGuard`;
	router = createLazyRouter({ protected: [`${path}#missing`] });
	router.initialize();
	assert.strictEqual(sap.ui.require(path), undefined, "module was not cached when the guard was registered");
	await waitForRoute(router, "home");

	router.navTo("protected");
	assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Committed, "no guard ran");
});

QUnit.test("lazy mode: a guard that throws on first load fails the navigation", async function (assert: Assert) {
	const path = `${FIXTURES}/lazyUncachedThrowingGuard`;
	router = createLazyRouter({ protected: [path] });
	router.initialize();
	assert.strictEqual(sap.ui.require(path), undefined, "module was not cached when the guard was registered");
	await waitForRoute(router, "home");

	const errors = await captureErrorsAsync(async () => {
		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Error, "navigation fails");
		assert.strictEqual((result.error as Error).message, "guard failed", "with the thrown error");
	});
	assert.deepEqual(
		errors.map((entry) => entry.message),
		['Enter guard [0] "fail" on route "protected" threw, navigation failed'],
		"the log names the guard the module resolved to",
	);
});

QUnit.test("lazy mode: a module that fails to load fails the navigation", async function (assert: Assert) {
	const path = `${FIXTURES}/doesNotExist`;
	router = createLazyRouter({ protected: [path], forbidden: [`${path}#guard`] });
	router.initialize();
	await waitForRoute(router, "home");

	const statuses: string[] = [];
	const warnings = await captureWarningsAsync(async () => {
		router.navTo("protected");
		statuses.push((await router.navigationSettled()).status);
		router.navTo("forbidden");
		statuses.push((await router.navigationSettled()).status);
	});

	assert.deepEqual(statuses, [NavigationOutcome.Error, NavigationOutcome.Error], "bare path and cherry-pick fail");
	assert.deepEqual(
		warnings.map((w) => w.message).filter((message) => message.startsWith("guardRouter.")),
		[`guardRouter.guards: lazy load of "${path}" failed`, `guardRouter.guards: lazy load of "${path}" failed`],
		"each failed load warns",
	);
});

QUnit.test("lazy mode: cached module registers its guards at initialize", async function (assert: Assert) {
	const path = `${FIXTURES}/lazyCachedGuard`;
	await loadModule(path);
	const probe = await loadProbe();
	router = createLazyRouter({ protected: [path] });
	router.initialize();
	router.addRouteGuard("protected", () => {
		probe.calls.push("imperative");
		return true;
	});
	await waitForRoute(router, "home");

	router.navTo("protected");
	assert.strictEqual(HashChanger.getInstance().getHash(), "protected", "committed within navTo");
	assert.deepEqual(
		probe.calls,
		["cachedFirst", "cachedSecond", "imperative"],
		"module guards run before guards added after initialize",
	);
});

QUnit.test("lazy mode: cached cherry-pick runs synchronously", async function (assert: Assert) {
	const path = `${FIXTURES}/objectGuard`;
	await loadModule(path);
	router = createLazyRouter({ protected: [`${path}#checkRole`], forbidden: [`${path}#missing`] });
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "picked export blocked within navTo");
	const warnings = captureWarnings(() => {
		router.navTo("forbidden");
		assert.strictEqual(HashChanger.getInstance().getHash(), "forbidden", "missing export: committed within navTo");
		router.navTo("home");
		router.navTo("forbidden");
	});
	assert.strictEqual(
		warnings.filter((w) => w.message.includes("#missing")).length,
		1,
		"missing export warns once, not per navigation",
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
			},
		);

		router.initialize();
		await waitForRoute(router, "home");
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
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	// Try to leave "home". checkRole returns false, should block
	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "cherry-picked leave guard from object module blocks");
});

// ============================================================
// Module: Invalid manifest guard config
// ============================================================
QUnit.module("Router - Invalid manifest guard config", {
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
		router = createRouterUnsafe(
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
			},
		);
	});

	assert.ok(
		warnings.some((w) => w.message.includes("not a plain object")),
		"warning logged for non-object guards value",
	);

	router.initialize();
	await waitForRoute(router, "home");

	// No manifest guards registered, so navigation should be allowed
	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "no guards block navigation");
});

QUnit.test("invalid entries in shorthand array warn and are skipped", function (assert: Assert) {
	const warnings = captureWarnings(() => {
		router = createRouterUnsafe([{ name: "home", pattern: "" }], {
			async: true,
			guardRouter: {
				guardLoading: "block",
				guards: { home: [42, null, ""] },
			},
		});
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
							enter: ["ui5/guard/router/qunit/fixtures/guards/bagWriterGuard"],
							leave: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
						},
					},
				},
			},
		);
	});

	assert.ok(
		warnings.some((w) => w.message.includes("global leave guards are not supported")),
		"warning logged about global leave guards",
	);

	router.initialize();
	await waitForRoute(router, "home");

	let writerValue: unknown;
	router.addRouteGuard("protected", (context: GuardContext) => {
		writerValue = context.bag.get("writer");
		return true;
	});

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "skipped '*' leave guard did not block");
	assert.strictEqual(writerValue, "was-here", "enter guard from '*' still registered and ran");
});

// ============================================================
// Module: Invalid guard module exports
// ============================================================
QUnit.module("Router - Invalid guard module exports", {
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
			},
		);

		router.initialize();
		await waitForRoute(router, "home");
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
				},
			);

			router.initialize();
			await waitForRoute(router, "home");
		});

		assert.deepEqual(
			warnings.filter((w) => w.message.includes("mixedArrayGuard")).map((w) => w.message),
			[
				'guardRouter.guards: "ui5/guard/router/qunit/fixtures/guards/mixedArrayGuard" [1] is not a function, skipping',
			],
			"only the non-function entry at index 1 warns",
		);

		// Index 0 allows, index 2 blocks: Blocked proves the entry after the skipped one was registered
		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(
			result.status,
			NavigationOutcome.Blocked,
			"valid function guards registered, including the one after the skipped entry",
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
			},
		);

		router.initialize();
		await waitForRoute(router, "home");
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
				},
			);

			router.initialize();
			await waitForRoute(router, "home");
		});

		assert.ok(
			warnings.some((w) => w.message.includes("failed to load module")),
			"warning logged about module load failure",
		);

		assert.ok(router.isInitialized(), "router initialized despite load failure");

		// Navigation should still work (no guards registered; the failed module was skipped)
		router.navTo("protected");
		await waitForRoute(router, "protected");
		assert.strictEqual(getHash(), "protected", "navigation works after load failure");
	},
);
