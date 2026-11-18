import Component from "sap/ui/core/Component";
import ComponentContainer from "sap/ui/core/ComponentContainer";
import UIComponent from "sap/ui/core/UIComponent";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardContext, GuardFn, GuardResult, GuardRouter } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import {
	captureErrors,
	captureWarnings,
	captureErrorsAsync,
	captureWarningsAsync,
	createRouterUnsafe,
	flushPromises,
	getComponentRouter,
	GuardRouterClass,
	initHashChanger,
	getHash,
	recordHashChanges,
	recordSettlements,
	waitForRoute,
} from "./testHelpers";

let router: GuardRouter;

const FIXTURES = "ui5/guard/router/qunit/fixtures/guards";

const ROUTES = [
	{ name: "home", pattern: "" },
	{ name: "protected", pattern: "protected" },
	{ name: "forbidden", pattern: "forbidden" },
];

function createLazyRouter(guards: Record<string, string[]>): GuardRouter {
	return new GuardRouterClass(ROUTES, {
		async: true,
		guardRouter: { guardLoading: "lazy", unknownRouteRegistration: "ignore", guards },
	});
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

interface OwnerProbe {
	owners: unknown[];
	decide: GuardFn | undefined;
}

/**
 * Run `test` on the nested fixture app, started as a page does: the parent component initializes
 * its router in init(). Its "shell" route displays the child component under the prefix "child".
 */
async function withNestedApp(test: (parent: UIComponent, probe: OwnerProbe) => Promise<void>): Promise<void> {
	const probe = await loadModule<OwnerProbe>("ui5/guard/router/qunit/fixtures/nested/child/guards/ownerProbe");
	probe.owners.length = 0;
	initHashChanger();
	const parent = await Component.create({
		name: "ui5.guard.router.qunit.fixtures.nested",
		manifest: true,
	});
	if (!(parent instanceof UIComponent)) {
		throw new Error("The parent is not a UIComponent");
	}
	const container = new ComponentContainer({ component: parent }).placeAt("qunit-fixture");

	try {
		await test(parent, probe);
	} finally {
		probe.decide = undefined;
		container.destroy();
		for (const component of [...probe.owners, parent]) {
			if (component instanceof UIComponent && !component.isDestroyed()) {
				component.destroy();
			}
		}
		HashChanger.getInstance().setHash("");
	}
}

/** The child component, as the owner that its manifest guard saw first. */
function getChild(probe: OwnerProbe): UIComponent {
	const owner = probe.owners[0];
	if (!(owner instanceof UIComponent)) {
		throw new Error("No guard of the child component ran");
	}
	return owner;
}

/** What a test sees of a child whose guard is pending on its first navigation. */
interface PendingChild {
	childRouter: GuardRouter;
	/** Settle the pending guard of the child. */
	decide: (result: GuardResult) => void;
	/** The routes that the parent and the child router matched since, in order. */
	matches: string[];
	/** Resolves when the parent route that displays the child has matched. */
	shellMatched: Promise<void>;
}

/**
 * Navigate the parent to the route that displays the child, whose guard waits for `decide` on the
 * child's first navigation. Resolves once the parent's component target has asked the child router
 * whether a match is in progress.
 */
async function displayChildWithPendingGuard(parentRouter: GuardRouter, probe: OwnerProbe): Promise<PendingChild> {
	let decide: (result: GuardResult) => void = () => {};
	const guardCalled = new Promise<void>((called) => {
		probe.decide = () => {
			probe.decide = undefined;
			called();
			return new Promise<GuardResult>((resolve) => {
				decide = resolve;
			});
		};
	});
	const matches: string[] = [];
	parentRouter.getRoute("shell")?.attachMatched(() => {
		matches.push("parent:shell");
	});
	const shellMatched = waitForRoute(parentRouter, "shell");
	parentRouter.navTo("shell");
	await guardCalled;
	const child = getChild(probe);
	const childRouter = getComponentRouter(child);
	childRouter.attachRouteMatched((event) => {
		matches.push(`child:${event.getParameter("name")}`);
	});
	// The component target asks the child router once the child is created.
	await child.rootControlLoaded();
	await flushPromises();
	return { childRouter, decide: (result) => decide(result), matches, shellMatched };
}

QUnit.test("a component loaded as a routing target navigates under its prefix", async function (assert: Assert) {
	await withNestedApp(async (parent, probe) => {
		const parentRouter = getComponentRouter(parent);
		assert.strictEqual(
			(await parentRouter.navigationSettled()).route,
			"home",
			"the parent starts on its home route",
		);

		// The "shell" route displays the child component and gives its router the prefix "child".
		parentRouter.navTo("shell");
		await waitForRoute(parentRouter, "shell");

		// A component target counts as displayed only once the child router matched its first route,
		// so the child's manifest guard has already seen its owner component.
		const child = getChild(probe);
		assert.notStrictEqual(child, parent, "the guard's owner component is not the parent");
		assert.strictEqual(
			child.getManifestEntry("/sap.app/id"),
			"ui5.guard.router.qunit.fixtures.nested.child",
			"the guard's owner component is the nested component",
		);
		const childRouter = getComponentRouter(child);
		assert.ok(child.getRouter() === childRouter, "its router is the guard router that ran the guard");
		const initial = await childRouter.navigationSettled();
		assert.strictEqual(initial.route, "list", "the child router matched its own initial route");
		assert.strictEqual(getHash(), "shell", "the child's empty hash leaves the parent's hash as it is");

		const parentStatuses = recordSettlements(parentRouter);
		const childStatuses = recordSettlements(childRouter);

		childRouter.navTo("detail");
		await waitForRoute(childRouter, "detail");
		assert.strictEqual(getHash(), "shell&/child/detail", "the child's hash is written under its prefix");

		const recorder = recordHashChanges();
		childRouter.navTo("locked");
		const blocked = await childRouter.navigationSettled();
		recorder.stop();
		assert.strictEqual(blocked.status, NavigationOutcome.Blocked, "the child's manifest guard blocks navTo");
		assert.strictEqual(blocked.route, "detail", "the child stays on its route");
		assert.deepEqual(recorder.hashes, [], "the browser hash never changed");

		// The same navigation from the address bar.
		HashChanger.getInstance().setHash("shell&/child/locked");
		await flushPromises();
		assert.deepEqual(
			childStatuses,
			[NavigationOutcome.Committed, NavigationOutcome.Blocked, NavigationOutcome.Blocked],
			"the child settled the allowed navigation and both blocked ones",
		);
		assert.strictEqual(getHash(), "shell&/child/detail", "the blocked browser hash is restored under the prefix");
		assert.strictEqual((await childRouter.navigationSettled()).route, "detail", "the child is still on its route");

		assert.ok(
			probe.owners.length === 4 && probe.owners.every((seen) => seen === child),
			"every navigation of the child passed the nested component as owner",
		);

		assert.deepEqual(parentStatuses, [], "the parent router saw no navigation");
		assert.strictEqual((await parentRouter.navigationSettled()).route, "shell", "the parent route stays matched");
	});
});

QUnit.test(
	"a parent route waits for the route that a nested component's first navigation is redirected to",
	async function (assert: Assert) {
		await withNestedApp(async (parent, probe) => {
			const child = await displayChildWithPendingGuard(getComponentRouter(parent), probe);

			child.decide("detail");
			await child.shellMatched;

			assert.deepEqual(
				child.matches,
				["child:detail", "parent:shell"],
				"the parent route matched after the route the child was redirected to",
			);
			const settled = await child.childRouter.navigationSettled();
			assert.strictEqual(
				settled.status,
				NavigationOutcome.Redirected,
				"the child's first navigation was redirected",
			);
			assert.strictEqual(getHash(), "shell&/child/detail", "the redirect target is written under the prefix");
		});
	},
);

QUnit.test(
	"a parent route matches although an async guard blocks a nested component's first navigation",
	async function (assert: Assert) {
		await withNestedApp(async (parent, probe) => {
			const parentRouter = getComponentRouter(parent);
			const child = await displayChildWithPendingGuard(parentRouter, probe);
			assert.deepEqual(child.matches, [], "the parent route waits for the child's guard");

			child.decide(false);
			const settled = await child.childRouter.navigationSettled();
			assert.strictEqual(settled.status, NavigationOutcome.Blocked, "the child's first navigation is blocked");

			// UI5 only waits for a routeMatched of the child, which a blocked navigation never fires.
			await child.shellMatched;
			assert.deepEqual(child.matches, ["parent:shell"], "the parent route matched, the child matched no route");
			assert.strictEqual(
				(await parentRouter.navigationSettled()).route,
				"shell",
				"the parent stays on its route",
			);
		});
	},
);

QUnit.test(
	"a blocked first navigation of a nested component leaves the browser hash as the parent set it",
	async function (assert: Assert) {
		await withNestedApp(async (parent, probe) => {
			const child = await displayChildWithPendingGuard(getComponentRouter(parent), probe);

			child.decide(false);
			const settled = await child.childRouter.navigationSettled();
			await child.shellMatched;

			assert.strictEqual(settled.status, NavigationOutcome.Blocked, "the child's first navigation is blocked");
			assert.strictEqual(getHash(), "shell", "the child's prefix is not added for its empty hash");
		});
	},
);

QUnit.test(
	"a redirect of a nested component to the route it shows leaves the browser hash as it is",
	async function (assert: Assert) {
		await withNestedApp(async (parent, probe) => {
			const parentRouter = getComponentRouter(parent);
			parentRouter.navTo("shell");
			await waitForRoute(parentRouter, "shell");
			const childRouter = getComponentRouter(getChild(probe));
			assert.strictEqual((await childRouter.navigationSettled()).route, "list", "the child shows its empty hash");

			for (const target of ["list", { route: "list" }]) {
				probe.decide = (context) => (context.toRoute === "detail" ? target : true);
				childRouter.navTo("detail");
				const settled = await childRouter.navigationSettled();

				assert.strictEqual(settled.status, NavigationOutcome.Redirected, "the child's guard redirected");
				assert.strictEqual(settled.route, "list", "back to the route the child shows");
				assert.strictEqual(getHash(), "shell", "the child's prefix is not added for its empty hash");
			}
		});
	},
);

QUnit.test(
	"a parent route matches although a guard blocks a nested component that is displayed again",
	async function (assert: Assert) {
		await withNestedApp(async (parent, probe) => {
			const parentRouter = getComponentRouter(parent);
			parentRouter.navTo("shell");
			await waitForRoute(parentRouter, "shell");
			const childRouter = getComponentRouter(getChild(probe));

			parentRouter.navTo("home");
			await waitForRoute(parentRouter, "home");
			assert.ok(childRouter.isStopped(), "leaving the parent route stops the child router");

			// UI5 starts the child router again and waits for its routeMatched.
			probe.decide = () => false;
			parentRouter.navTo("shell");
			await waitForRoute(parentRouter, "shell");

			const settled = await childRouter.navigationSettled();
			assert.strictEqual(settled.status, NavigationOutcome.Blocked, "the child's navigation is blocked");
			assert.strictEqual(probe.owners.length, 2, "the child's guard ran for both displays");
		});
	},
);

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
	let errors: { message: string }[] = [];
	const warnings = await captureWarningsAsync(async () => {
		errors = await captureErrorsAsync(async () => {
			router.navTo("protected");
			statuses.push((await router.navigationSettled()).status);
			router.navTo("forbidden");
			statuses.push((await router.navigationSettled()).status);
		});
	});

	assert.deepEqual(statuses, [NavigationOutcome.Error, NavigationOutcome.Error], "bare path and cherry-pick fail");
	assert.deepEqual(
		warnings.map((w) => w.message).filter((message) => message.startsWith("guardRouter.")),
		[`guardRouter.guards: lazy load of "${path}" failed`, `guardRouter.guards: lazy load of "${path}" failed`],
		"each failed load warns",
	);
	assert.deepEqual(
		errors.map((entry) => entry.message).filter((message) => message.startsWith("Enter guard")),
		[
			'Enter guard [0] "doesNotExist" on route "protected" threw, navigation failed',
			'Enter guard [0] "doesNotExist#guard" on route "forbidden" threw, navigation failed',
		],
		"a guard that never loaded is logged as the manifest names it",
	);
});

QUnit.test("lazy mode: a failed preload is not an uncaught error", async function (assert: Assert) {
	const path = `${FIXTURES}/preloadDoesNotExist`;
	// Unhandled rejections are reported in order, so everything the preload causes is
	// reported before the marker this test rejects after the load has failed.
	const marker = new Error("marker");
	const unhandled: string[] = [];
	const markerReported = new Promise<void>((resolve) => {
		const onUnhandled = (event: PromiseRejectionEvent): void => {
			if (event.reason !== marker) {
				unhandled.push(String(event.reason));
				return;
			}
			event.preventDefault();
			window.removeEventListener("unhandledrejection", onUnhandled);
			resolve();
		};
		window.addEventListener("unhandledrejection", onUnhandled);
	});
	const preloadWarnings = await captureWarningsAsync(async () => {
		router = createLazyRouter({ protected: [path] });
		await loadModule(path).catch(() => undefined);
		void Promise.reject(marker);
		await markerReported;
	});
	assert.deepEqual(unhandled, [], "the failed preload rejects no promise without a handler");
	assert.deepEqual(
		preloadWarnings.map((w) => w.message).filter((message) => message.startsWith("guardRouter.")),
		[],
		"the preload itself reports nothing",
	);

	router.initialize();
	await waitForRoute(router, "home");
	const warnings = await captureWarningsAsync(async () => {
		await captureErrorsAsync(async () => {
			router.navTo("protected");
			assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Error, "navigation fails");
		});
	});
	assert.deepEqual(
		warnings.map((w) => w.message).filter((message) => message.startsWith("guardRouter.")),
		[`guardRouter.guards: lazy load of "${path}" failed`],
		"the failure is reported once, when the guard runs",
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
// Module: Block mode module load failure
// ============================================================
QUnit.module("Router - Block mode module load failure", {
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

// ============================================================
// Module: Manifest guard order, shapes and lifecycle
// ============================================================
QUnit.module("Router - Manifest guard order, shapes and lifecycle", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

function createBlockRouter(guards: Record<string, string[]>, unknownRouteRegistration = "ignore"): GuardRouter {
	return createRouterUnsafe(ROUTES, {
		async: true,
		guardRouter: { guardLoading: "block", unknownRouteRegistration, guards },
	});
}

/** Resolve with the status of the first settlement, including one that happens while the router starts. */
function firstSettlement(target: GuardRouter): Promise<string> {
	return new Promise((resolve) => {
		target.attachNavigationSettled((event) => resolve(event.getParameter("status") as string));
	});
}

function pushCall(probe: LazyProbe, name: string): GuardFn {
	return () => {
		probe.calls.push(name);
		return true;
	};
}

QUnit.test(
	"guards added before initialize() run before manifest guards, guards added after run after",
	async function (assert: Assert) {
		const path = `${FIXTURES}/lazyCachedGuard`;
		await loadModule(path);
		const probe = await loadProbe();
		router = createLazyRouter({ protected: [path] });
		router.addRouteGuard("protected", pushCall(probe, "before"));
		router.initialize();
		router.addRouteGuard("protected", pushCall(probe, "after"));
		await waitForRoute(router, "home");

		router.navTo("protected");
		await router.navigationSettled();
		assert.deepEqual(probe.calls, ["before", "cachedFirst", "cachedSecond", "after"]);
	},
);

QUnit.test("block mode: guards added while modules load run before manifest guards", async function (assert: Assert) {
	const probe = await loadProbe();
	router = createBlockRouter({ protected: [`${FIXTURES}/lazyCachedGuard`] });
	router.initialize();
	router.addRouteGuard("protected", pushCall(probe, "while loading"));
	await waitForRoute(router, "home");

	router.navTo("protected");
	await router.navigationSettled();
	assert.deepEqual(probe.calls, ["while loading", "cachedFirst", "cachedSecond"]);
});

QUnit.test("entries keep their declared positions, and a duplicate entry runs twice", async function (assert: Assert) {
	const cached = `${FIXTURES}/lazyCachedGuard`;
	const uncached = `${FIXTURES}/lazyUncachedPositionGuard`;
	await loadModule(cached);
	const probe = await loadProbe();
	router = createLazyRouter({ protected: [`${cached}#1`, uncached, cached, `${cached}#1`] });
	router.initialize();
	assert.strictEqual(sap.ui.require(uncached), undefined, "one entry's module was not cached yet");
	await waitForRoute(router, "home");

	const expected = ["cachedSecond", "uncachedPosition", "cachedFirst", "cachedSecond", "cachedSecond"];
	router.navTo("protected");
	assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Committed);
	assert.deepEqual(probe.calls, expected, "first navigation, which loads a module");

	router.navTo("home");
	await router.navigationSettled();
	probe.calls.length = 0;
	router.navTo("protected");
	assert.deepEqual(probe.calls, expected, "later navigation, within navTo");
});

QUnit.test("block mode guards the first navigation", async function (assert: Assert) {
	HashChanger.getInstance().setHash("protected");
	router = createBlockRouter({ protected: [`${FIXTURES}/blockGuard`] });
	const first = firstSettlement(router);
	router.initialize();

	assert.strictEqual(await first, NavigationOutcome.Blocked, "the start hash was guarded");
	assert.strictEqual(getHash(), "", "the router fell back to the root route");
});

QUnit.test(
	"lazy mode guards the first navigation with a module that is not cached yet",
	async function (assert: Assert) {
		const path = `${FIXTURES}/lazyUncachedFirstNavigationGuard`;
		HashChanger.getInstance().setHash("protected");
		router = createLazyRouter({ protected: [path] });
		const first = firstSettlement(router);
		router.initialize();
		assert.strictEqual(sap.ui.require(path), undefined, "module was not cached when the router started");

		assert.strictEqual(await first, NavigationOutcome.Blocked, "the start hash was guarded");
		assert.strictEqual(getHash(), "", "the router fell back to the root route");
	},
);

QUnit.test("lazy mode: uncached function module, named after the module in logs", async function (assert: Assert) {
	const path = `${FIXTURES}/lazyUncachedFunctionGuard`;
	const probe = await loadProbe();
	router = createLazyRouter({ protected: [path] });
	router.initialize();
	assert.strictEqual(sap.ui.require(path), undefined, "module was not cached when the guard was registered");
	await waitForRoute(router, "home");

	probe.behaviors = [
		() => {
			throw new Error("function guard failed");
		},
	];
	const errors = await captureErrorsAsync(async () => {
		router.navTo("protected");
		assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Error);
	});
	assert.deepEqual(
		errors.map((entry) => entry.message),
		['Enter guard [0] "lazyUncachedFunctionGuard" on route "protected" threw, navigation failed'],
	);

	probe.calls.length = 0;
	probe.behaviors = [];
	router.navTo("protected");
	assert.strictEqual(getHash(), "protected", "later navigation commits within navTo");
	assert.deepEqual(probe.calls, ["function"]);
});

QUnit.test(
	"lazy mode: uncached object module runs every key in order, logged under the module name",
	async function (assert: Assert) {
		const path = `${FIXTURES}/lazyUncachedObjectGuard`;
		const probe = await loadProbe();
		router = createLazyRouter({ protected: [path] });
		router.initialize();
		assert.strictEqual(sap.ui.require(path), undefined, "module was not cached when the guard was registered");
		await waitForRoute(router, "home");

		probe.behaviors = [
			() => true,
			() => {
				throw new Error("second key failed");
			},
		];
		const errors = await captureErrorsAsync(async () => {
			router.navTo("protected");
			assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Error);
		});
		assert.deepEqual(probe.calls, ["objectFirst", "objectSecond"]);
		assert.deepEqual(
			errors.map((entry) => entry.message),
			['Enter guard [0] "lazyUncachedObjectGuard" on route "protected" threw, navigation failed'],
			"one wrapper runs both guards, so the log names the module",
		);

		probe.calls.length = 0;
		probe.behaviors = [() => true, () => false];
		router.navTo("protected");
		assert.deepEqual(probe.calls, ["objectFirst", "objectSecond"], "later navigation runs both, within navTo");
		assert.strictEqual(getHash(), "", "and the second key blocks");
	},
);

QUnit.test("lazy mode: uncached array index and function #key picks", async function (assert: Assert) {
	const arrayPath = `${FIXTURES}/lazyUncachedArrayPickGuard`;
	const functionPath = `${FIXTURES}/lazyUncachedKeyedFunctionGuard`;
	const probe = await loadProbe();
	router = createLazyRouter({ protected: [`${arrayPath}#1`], forbidden: [`${functionPath}#anything`] });
	router.initialize();
	assert.strictEqual(sap.ui.require(arrayPath), undefined, "array module was not cached");
	assert.strictEqual(sap.ui.require(functionPath), undefined, "function module was not cached");
	await waitForRoute(router, "home");

	router.navTo("protected");
	assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Committed);
	router.navTo("forbidden");
	assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Committed);
	assert.deepEqual(
		probe.calls,
		["arraySecond", "keyedFunction"],
		"only the picked index; the key on a function is ignored",
	);

	probe.calls.length = 0;
	router.navTo("protected");
	assert.strictEqual(getHash(), "protected", "later navigation commits within navTo");
	router.navTo("forbidden");
	assert.strictEqual(getHash(), "forbidden", "later navigation commits within navTo");
	assert.deepEqual(probe.calls, ["arraySecond", "keyedFunction"]);
});

QUnit.test("lazy mode: cached array index and function #key picks run within navTo", async function (assert: Assert) {
	await loadModule(`${FIXTURES}/arrayGuard`);
	await loadModule(`${FIXTURES}/blockGuard`);
	router = createLazyRouter({
		protected: [`${FIXTURES}/arrayGuard#1`],
		forbidden: [`${FIXTURES}/blockGuard#anything`],
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	assert.strictEqual(getHash(), "", "array #1 (blockSecond) blocked within navTo");
	router.navTo("forbidden");
	assert.strictEqual(getHash(), "", "function module with a key blocked within navTo");
});

QUnit.test("lazy mode: modules with no usable guards warn and allow", async function (assert: Assert) {
	const uncached = `${FIXTURES}/lazyUncachedPrimitiveGuard`;
	await loadModule(`${FIXTURES}/emptyArrayGuard`);
	router = createLazyRouter({ protected: [`${FIXTURES}/emptyArrayGuard`], forbidden: [uncached] });
	const initWarnings = captureWarnings(() => router.initialize());
	assert.strictEqual(sap.ui.require(uncached), undefined, "primitive-export module was not cached");
	assert.ok(
		initWarnings.some((w) => w.message.includes("emptyArrayGuard") && w.message.includes("empty array")),
		"cached module warns at initialize",
	);
	await waitForRoute(router, "home");

	router.navTo("protected");
	assert.strictEqual(getHash(), "protected", "cached module without guards allows within navTo");

	const warnings = await captureWarningsAsync(async () => {
		router.navTo("forbidden");
		assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Committed);
		router.navTo("home");
		await router.navigationSettled();
		router.navTo("forbidden");
		await router.navigationSettled();
	});
	assert.deepEqual(
		warnings.filter((w) => w.message.includes("lazyUncachedPrimitiveGuard")).map((w) => w.message),
		[`guardRouter.guards: "${uncached}" did not export a function, array, or plain object, skipping`],
		"uncached module warns once, on first use",
	);
});

QUnit.test("lazy mode: destroy() while a module loads runs none of its guards", async function (assert: Assert) {
	const path = `${FIXTURES}/lazyUncachedDestroyGuard`;
	const probe = await loadProbe();
	router = createLazyRouter({ protected: [path] });
	router.initialize();
	assert.strictEqual(sap.ui.require(path), undefined, "module was not cached when the guard was registered");
	await waitForRoute(router, "home");

	router.navTo("protected");
	router.destroy();
	await loadModule(path);
	await flushPromises();
	assert.deepEqual(probe.calls, [], "the guard did not run after destroy()");
});

QUnit.test(
	'unknownRouteRegistration "throw" on a manifest guard logs and skips it (lazy mode)',
	async function (assert: Assert) {
		const block = `${FIXTURES}/blockGuard`;
		router = createRouterUnsafe(ROUTES, {
			async: true,
			guardRouter: {
				guardLoading: "lazy",
				unknownRouteRegistration: "throw",
				guards: { nope: [block], protected: [block] },
			},
		});
		const errors = captureErrors(() => router.initialize());
		assert.deepEqual(
			errors.map((entry) => entry.message),
			[`guardRouter.guards: failed to register "${block}"`],
			"initialize() does not throw; the error is logged",
		);
		await waitForRoute(router, "home");

		router.navTo("protected");
		assert.strictEqual(
			(await router.navigationSettled()).status,
			NavigationOutcome.Blocked,
			"other manifest guards still apply",
		);
	},
);

QUnit.test(
	'unknownRouteRegistration "throw" on a manifest guard logs and skips it (block mode)',
	async function (assert: Assert) {
		const block = `${FIXTURES}/blockGuard`;
		router = createBlockRouter({ nope: [block], protected: [block] }, "throw");
		const errors = await captureErrorsAsync(async () => {
			router.initialize();
			await waitForRoute(router, "home");
		});
		assert.deepEqual(
			errors.map((entry) => entry.message),
			[`guardRouter.guards: failed to register "${block}"`],
		);

		router.navTo("protected");
		assert.strictEqual(
			(await router.navigationSettled()).status,
			NavigationOutcome.Blocked,
			"other manifest guards still apply",
		);
	},
);

QUnit.test("block mode: stop() while modules load keeps the router stopped", async function (assert: Assert) {
	const block = `${FIXTURES}/blockGuard`;
	router = createBlockRouter({ protected: [block] });
	router.initialize();
	captureWarnings(() => router.stop());
	await loadModule(block);
	await flushPromises();
	assert.notOk(router.isInitialized(), "loading finished, but the router did not start");

	router.initialize();
	await waitForRoute(router, "home");
	router.navTo("protected");
	assert.strictEqual(
		(await router.navigationSettled()).status,
		NavigationOutcome.Blocked,
		"after initialize(), the manifest guards apply",
	);
});

QUnit.test(
	"block mode: initialize() again while modules load does not start the router early",
	async function (assert: Assert) {
		const block = `${FIXTURES}/blockGuard`;
		HashChanger.getInstance().setHash("protected");
		router = createBlockRouter({ protected: [block] });
		const first = firstSettlement(router);
		router.initialize();
		const warnings = captureWarnings(() => router.initialize());
		assert.notOk(router.isInitialized(), "not started before the guards are registered");
		assert.deepEqual(warnings, [], "the second call is not reported as a double initialize");

		assert.strictEqual(await first, NavigationOutcome.Blocked, "the start hash was guarded");
		assert.ok(router.isInitialized());
	},
);

QUnit.test(
	"block mode: initialize() again while modules load keeps the argument of the first call",
	async function (assert: Assert) {
		const block = `${FIXTURES}/blockGuard`;
		HashChanger.getInstance().setHash("protected");
		router = createBlockRouter({ protected: [block] });
		const statuses = recordSettlements(router);

		router.initialize();
		router.initialize(true);
		await loadModule(block);
		await flushPromises();

		assert.ok(router.isInitialized(), "the router started");
		assert.strictEqual(statuses[0], NavigationOutcome.Blocked, "the start hash was parsed and guarded");
	},
);

QUnit.test(
	"block mode: initialize() after stop() while modules load starts the router with its own argument",
	async function (assert: Assert) {
		const block = `${FIXTURES}/blockGuard`;
		HashChanger.getInstance().setHash("protected");
		router = createBlockRouter({ protected: [block] });
		const statuses = recordSettlements(router);

		router.initialize(true);
		captureWarnings(() => router.stop());
		router.initialize();
		await loadModule(block);
		await flushPromises();

		assert.ok(router.isInitialized(), "the router started once the modules were loaded");
		assert.strictEqual(statuses[0], NavigationOutcome.Blocked, "the start hash was parsed and guarded");
	},
);

QUnit.test("block mode: modules that load after destroy() register no guards", async function (assert: Assert) {
	const block = `${FIXTURES}/blockGuard`;
	router = createBlockRouter({ nope: [block] }, "throw");
	const errors = await captureErrorsAsync(async () => {
		router.initialize();
		router.destroy();
		await loadModule(block);
		await flushPromises();
	});
	assert.deepEqual(errors, [], "no guard was registered, so none failed to register");
	assert.notOk(router.isInitialized(), "the router was not initialized");
});

QUnit.test(
	'unknownRouteRegistration "warn" registers a manifest guard for an unknown route with one warning',
	async function (assert: Assert) {
		const block = `${FIXTURES}/blockGuard`;
		await loadModule(block);
		router = createRouterUnsafe(ROUTES, {
			async: true,
			guardRouter: { guardLoading: "lazy", unknownRouteRegistration: "warn", guards: { nope: [block] } },
		});
		const warnings = captureWarnings(() => router.initialize());
		assert.deepEqual(
			warnings.map((w) => [w.message, w.details]),
			[["addRouteGuard: unknown route, guard registered anyway", "nope"]],
		);
	},
);

QUnit.test(
	'unknownRouteRegistration "warn" reports a manifest leave guard for an unknown route as addLeaveGuard',
	async function (assert: Assert) {
		const leave = `${FIXTURES}/leaveGuard`;
		await loadModule(leave);
		router = createRouterUnsafe(ROUTES, {
			async: true,
			guardRouter: {
				guardLoading: "lazy",
				unknownRouteRegistration: "warn",
				guards: { nope: { leave: [leave] } },
			},
		});
		const warnings = captureWarnings(() => router.initialize());
		assert.deepEqual(
			warnings.map((w) => [w.message, w.details]),
			[["addLeaveGuard: unknown route, guard registered anyway", "nope"]],
		);
	},
);

QUnit.test(
	"addRoute() registers an inherited guard whose module is not cached yet (lazy mode)",
	async function (assert: Assert) {
		const path = `${FIXTURES}/lazyUncachedInheritedGuard`;
		router = createRouterUnsafe(
			[
				{ name: "home", pattern: "" },
				{ name: "employees", pattern: "employees" },
			],
			{
				async: true,
				guardRouter: { guardLoading: "lazy", inheritance: "pattern-tree", guards: { employees: [path] } },
			},
		);
		router.initialize();
		router.addRoute({ name: "employee", pattern: "employees/{id}" });
		assert.strictEqual(sap.ui.require(path), undefined, "module was not cached when the route was added");
		await waitForRoute(router, "home");

		router.navTo("employee", { id: "1" });
		assert.strictEqual(
			(await router.navigationSettled()).status,
			NavigationOutcome.Blocked,
			"the new route inherited the guard",
		);
	},
);

/** Resolve with the resource timing entry once the browser has fetched a file whose URL ends with `fileName`. */
function whenFetched(fileName: string): Promise<PerformanceEntry> {
	return new Promise((resolve) => {
		const observer = new PerformanceObserver((list) => {
			const entry = list.getEntries().find((e) => e.name.endsWith(`/${fileName}`));
			if (entry) {
				observer.disconnect();
				resolve(entry);
			}
		});
		observer.observe({ type: "resource", buffered: true });
	});
}

QUnit.test("lazy mode starts loading guard modules in the constructor", async function (assert: Assert) {
	const path = `${FIXTURES}/lazyPreloadGuard`;
	assert.strictEqual(sap.ui.require(path), undefined, "module was not cached before the router existed");
	const fetched = whenFetched("lazyPreloadGuard.js");

	router = createLazyRouter({ protected: [path] });

	await fetched;
	assert.strictEqual(router.isInitialized(), false, "the module was fetched before initialize()");
});

QUnit.test("block mode starts loading guard modules in initialize()", async function (assert: Assert) {
	const path = `${FIXTURES}/blockDeferredGuard`;
	const fetched = whenFetched("blockDeferredGuard.js");

	router = createBlockRouter({ protected: [path] });
	await flushPromises();
	const initialized = performance.now();
	router.initialize();

	assert.ok((await fetched).startTime >= initialized, "the constructor did not fetch the module");
});

QUnit.test("block mode without manifest guards starts the router within initialize()", function (assert: Assert) {
	router = createBlockRouter({});
	router.initialize();
	assert.ok(router.isInitialized(), "nothing to load, so the start is not deferred");
});

QUnit.test("block mode: navTo() while modules load is guarded once the router starts", async function (assert: Assert) {
	router = createBlockRouter({ protected: [`${FIXTURES}/blockGuard`] });
	let matched = false;
	router.getRoute("protected")!.attachMatched(() => {
		matched = true;
	});
	const statuses = recordSettlements(router);

	router.initialize();
	assert.notOk(router.isInitialized(), "the modules are still loading");
	router.navTo("protected");
	assert.deepEqual(statuses, [], "nothing settled: the router does not handle navigation yet");

	await waitForRoute(router, "home");
	assert.deepEqual(
		statuses,
		[NavigationOutcome.Blocked, NavigationOutcome.Committed],
		"the manifest guard blocked the hash, then the router fell back to the empty hash",
	);
	assert.notOk(matched, "the guarded route was never displayed");
	assert.strictEqual(getHash(), "");
});

QUnit.test(
	"block mode: initialize(true) leaves the current hash unparsed once the modules are loaded",
	async function (assert: Assert) {
		HashChanger.getInstance().setHash("protected");
		router = createBlockRouter({ protected: [`${FIXTURES}/blockGuard`] });
		const statuses = recordSettlements(router);

		router.initialize(true);
		while (!router.isInitialized()) await flushPromises();
		await flushPromises();

		assert.deepEqual(statuses, [], "the initial hash was not parsed, so nothing settled");
		assert.strictEqual(getHash(), "protected", "the hash is untouched");
	},
);

QUnit.test(
	"pattern-tree: an ancestor's guard runs first even when the descendant is declared first",
	async function (assert: Assert) {
		const path = `${FIXTURES}/lazyCachedGuard`;
		const probe = await loadProbe();
		router = createRouterUnsafe(
			[
				{ name: "home", pattern: "" },
				{ name: "employees", pattern: "employees" },
				{ name: "employee", pattern: "employees/{id}" },
			],
			{
				async: true,
				guardRouter: {
					inheritance: "pattern-tree",
					guards: { employee: [`${path}#1`], employees: [`${path}#0`] },
				},
			},
		);
		router.initialize();
		await waitForRoute(router, "home");

		router.navTo("employee", { id: "1" });
		await router.navigationSettled();
		assert.deepEqual(probe.calls, ["cachedFirst", "cachedSecond"], "inherited guard first, own guard second");
	},
);
