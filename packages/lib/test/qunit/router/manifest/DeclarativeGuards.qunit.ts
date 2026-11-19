import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { GuardContext, GuardRouter } from "ui5/guard/router/types";
import {
	captureErrorsAsync,
	captureWarningsAsync,
	flushPromises,
	GuardRouterClass,
	getHash,
	waitForRoute,
	createdRouterHooks,
} from "../../testHelpers";
import { FIXTURES } from "./manifestHelpers";

let router: GuardRouter;

const hooks = createdRouterHooks(() => router);

// ============================================================
// Module: Declarative manifest guards: block loading
// ============================================================
QUnit.module("Router - Declarative manifest guards (block loading)", hooks);

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
					protected: [`${FIXTURES}/blockGuard`],
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
			{ name: "forbidden", pattern: "forbidden" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteRegistration: "ignore",
				guards: {
					protected: [`${FIXTURES}/throwingArrayGuard`],
					forbidden: [`${FIXTURES}/throwingObjectGuard`],
				},
			},
		},
	);
	router.initialize();
	await waitForRoute(router, "home");

	const errors = await captureErrorsAsync(async () => {
		router.navTo("protected");
		assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Error);
		router.navTo("forbidden");
		assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Error);
	});
	assert.deepEqual(
		errors.map((entry) => entry.message),
		[
			'Enter guard [1] "throwingArrayGuard#1" on route "protected" threw, navigation failed',
			'Enter guard [1] "explode" on route "forbidden" threw, navigation failed',
		],
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
					"*": [`${FIXTURES}/bagWriterGuard`],
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
					"*": [`${FIXTURES}/bagWriterGuard`],
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
					"*": [`${FIXTURES}/bagWriterGuard`, `${FIXTURES}/bagReaderGuard`],
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

	// UI5's destroy() deletes _bIsInitialized. If the .then()
	// callback ignored the _destroyed flag and called super.initialize(),
	// _bIsInitialized would be true again.
	assert.notOk(router.isInitialized(), "Router was not re-initialized after destroy() during block loading");
});

// ============================================================
// Module: Declarative manifest guards: lazy loading
// ============================================================
QUnit.module("Router - Declarative manifest guards (lazy loading)", hooks);

QUnit.test("lazy manifest guard blocks navigation", async function (assert: Assert) {
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
					protected: [`${FIXTURES}/blockGuard`],
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
					protected: [`${FIXTURES}/blockGuard`],
				},
			},
		},
	);

	router.initialize();
	assert.ok(router.isInitialized(), "the router starts within initialize(), which block mode defers");

	// The guard should still work on first navigation (lazy loads it)
	await waitForRoute(router, "home");
	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "default lazy mode: guard blocks on first navigation");
});

// ============================================================
// Module: Manifest guard module path resolution
// ============================================================
QUnit.module("Router - Manifest guard module path resolution", hooks);

QUnit.test('"module:" prefix bypasses namespace resolution', async function (assert: Assert) {
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
					protected: [`module:${FIXTURES}/blockGuard`],
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
// Module: Block mode module load failure
// ============================================================
QUnit.module("Router - Block mode module load failure", hooks);

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
