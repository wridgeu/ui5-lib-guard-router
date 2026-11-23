import type { GuardContext, GuardRouter } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import {
	captureWarnings,
	createHierarchicalRouter,
	GuardRouterClass,
	HIERARCHICAL_ROUTES,
	getHash,
	waitForRoute,
	createdRouterHooks,
} from "../../testHelpers";

let router: GuardRouter;

QUnit.module(
	"Router - Guard and metadata inheritance",
	createdRouterHooks(() => router),
);

QUnit.test(
	"guard on parent route runs for child route when inheritance is pattern-tree",
	async function (assert: Assert) {
		router = createHierarchicalRouter({
			guardLoading: "block",
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
			"ancestor blocking guard propagated to child route",
		);
	},
);

QUnit.test("guard on parent does NOT run for child when inheritance is none", async function (assert: Assert) {
	router = createHierarchicalRouter({
		guardLoading: "block",
		inheritance: "none",
		guards: {
			employees: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
		},
	});

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("employee", { id: "42" });
	await waitForRoute(router, "employee");

	assert.strictEqual(getHash(), "employees/42", "child route reached without ancestor guard");
});

QUnit.test("ancestor guards run before descendant guards (depth ordering)", async function (assert: Assert) {
	// bagWriterGuard on ancestor, bagReaderGuard on child.
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
	await waitForRoute(router, "home");

	router.navTo("employee", { id: "42" });
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Committed,
		"ancestor guard ran before descendant guard (bagWriter before bagReader)",
	);
});

QUnit.test("global guards run before inherited route guards (pipeline separation)", async function (assert: Assert) {
	// Global bagWriterGuard + inherited bagReaderGuard on child route.
	// The global guard writes to context.bag, the route guard reads it.
	// If global runs first, navigation succeeds; if the route guard runs first, it blocks.
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
	await waitForRoute(router, "home");

	router.navTo("employee", { id: "42" });
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Committed,
		"global guard ran before inherited route guard (pipeline stages are separate)",
	);
});

QUnit.test("guard on child does NOT propagate upward to parent", async function (assert: Assert) {
	router = createHierarchicalRouter({
		guardLoading: "block",
		inheritance: "pattern-tree",
		guards: {
			employee: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
		},
	});

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("employees");
	await waitForRoute(router, "employees");

	assert.strictEqual(getHash(), "employees", "parent route reached; child guard did not propagate upward");
});

QUnit.test("metadata propagates to child routes when inheritance is pattern-tree", function (assert: Assert) {
	router = createHierarchicalRouter({
		inheritance: "pattern-tree",
		routeMeta: {
			employees: { requiresAuth: true },
		},
	});

	const meta = router.getRouteMeta("employee");
	assert.strictEqual(meta.requiresAuth, true, "child route inherited requiresAuth from ancestor");
});

QUnit.test("child metadata overrides ancestor metadata on conflict", function (assert: Assert) {
	router = createHierarchicalRouter({
		inheritance: "pattern-tree",
		routeMeta: {
			employees: { level: 1 },
			employee: { level: 2 },
		},
	});

	const meta = router.getRouteMeta("employee");
	assert.strictEqual(meta.level, 2, "child metadata overrides ancestor on conflict");
});

QUnit.test("metadata does NOT propagate when inheritance is none", function (assert: Assert) {
	router = createHierarchicalRouter({
		inheritance: "none",
		routeMeta: {
			employees: { requiresAuth: true },
		},
	});

	const meta = router.getRouteMeta("employee");
	assert.deepEqual(meta, {}, "child route has no metadata when inheritance is none");
});

QUnit.test("metadata merges across multiple ancestor levels", function (assert: Assert) {
	router = createHierarchicalRouter({
		inheritance: "pattern-tree",
		routeMeta: {
			employees: { section: "hr" },
			employee: { requiresAuth: true },
		},
	});

	const meta = router.getRouteMeta("employeeResume");
	assert.strictEqual(meta.section, "hr", "grandchild inherited section from root ancestor");
	assert.strictEqual(meta.requiresAuth, true, "grandchild inherited requiresAuth from parent");
});

QUnit.test("inherited metadata is visible on context.toMeta in guards", async function (assert: Assert) {
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

	router.navTo("employee", { id: "42" });
	await waitForRoute(router, "employee");

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

	assert.strictEqual(router.getRouteMeta("employee").section, "hr", "inherited before mutation");

	router.setRouteMeta("employees", { section: "engineering" });

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

QUnit.test("routes declared as an object map inherit under the names UI5 gives them", async function (assert: Assert) {
	// UI5 names a route after its key unless the entry has a name of its own.
	router = new GuardRouterClass(
		{
			home: { pattern: "" },
			employees: { pattern: "employees" },
			item: { name: "employee", pattern: "employees/{id}" },
		},
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				inheritance: "pattern-tree",
				routeMeta: { employees: { section: "hr" } },
				guards: { employees: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"] },
			},
		},
	);

	assert.deepEqual(router.getRouteMeta("employee"), { section: "hr" }, "child inherits its ancestor's metadata");

	router.initialize();
	await waitForRoute(router, "home");
	router.navTo("employee", { id: "1" });
	assert.strictEqual(
		(await router.navigationSettled()).status,
		NavigationOutcome.Blocked,
		"child inherits its ancestor's manifest guard",
	);
});

QUnit.test("metadata propagates when all routes are added after construction", function (assert: Assert) {
	router = new GuardRouterClass(undefined, {
		async: true,
		guardRouter: { inheritance: "pattern-tree", routeMeta: { employees: { section: "hr" } } },
	});
	router.addRoute({ name: "employees", pattern: "employees" });
	router.addRoute({ name: "employee", pattern: "employees/{id}" });

	assert.deepEqual(router.getRouteMeta("employee"), { section: "hr" }, "child inherits from its ancestor");
});

QUnit.module(
	"Router - Root-pattern route as universal ancestor",
	createdRouterHooks(() => router),
);

QUnit.test("a route without a pattern is left out of pattern-tree inheritance", function (assert: Assert) {
	router = new GuardRouterClass([...HIERARCHICAL_ROUTES, { name: "loose" }], {
		async: true,
		guardRouter: {
			inheritance: "pattern-tree",
			routeMeta: { home: { requiresAuth: true }, loose: { own: 1 } },
		},
	});

	assert.deepEqual(router.getRouteMeta("loose"), { own: 1 }, "it sees only its own metadata");
	assert.strictEqual(router.getRouteMeta("employee").requiresAuth, true, "other routes still inherit");
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
		// Use bagWriterGuard on root. It allows navigation and writes to context.bag,
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
		await waitForRoute(router, "home");

		// A guard added here runs after the manifest guards of its route, so it sees the bag entry
		// of the root guard if the route inherited that guard.
		const routes: Record<string, object> = {
			employees: {},
			employee: { id: "1" },
			employeeResume: { id: "1" },
			settings: {},
			settingsProfile: {},
		};
		const inherited: Record<string, boolean> = {};
		for (const [name, parameters] of Object.entries(routes)) {
			router.addRouteGuard(name, (context: GuardContext) => {
				inherited[name] = context.bag.has("writer");
				return true;
			});
			router.navTo(name, parameters);
			await router.navigationSettled();
		}

		assert.deepEqual(
			inherited,
			{ employees: true, employee: true, employeeResume: true, settings: true, settingsProfile: true },
			"the root guard ran before the route guard of every other route",
		);
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

QUnit.module(
	"Router - Dynamic addRoute() with inheritance",
	createdRouterHooks(() => router),
);

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
			},
		);

		router.initialize();
		await waitForRoute(router, "home");

		router.addRoute({ name: "employee", pattern: "employees/{id}" });

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
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	router.addRoute({ name: "employee", pattern: "employees/{id}" });

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
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	router.addRoute({ name: "employee", pattern: "employees/{id}" });

	router.navTo("employee", { id: "42" });
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Committed, "no guard inheritance when inheritance is none");
});

QUnit.test("addRoute() clears metadata cache so inheritance updates", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
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
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	// Resolve (and cache) the child's metadata while its ancestor route does not exist yet
	assert.strictEqual(router.getRouteMeta("employee").section, undefined, "no ancestor before addRoute");

	router.addRoute({ name: "employees", pattern: "employees" });

	assert.strictEqual(
		router.getRouteMeta("employee").section,
		"hr",
		"cached child metadata is recomputed once the ancestor route is added",
	);
});

QUnit.test("addRoute() for already-known route is a no-op", async function (assert: Assert) {
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
				guardLoading: "block",
				unknownRouteRegistration: "ignore",
				guards: {
					employees: ["ui5/guard/router/qunit/fixtures/guards/bagCounterGuard"],
				},
			},
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	// Re-add "employees" which already exists. Must not re-expand its guard onto descendants.
	router.addRoute({ name: "employees", pattern: "employees" });

	let count: unknown;
	router.addRouteGuard("employee", (context: GuardContext) => {
		count = context.bag.get("count");
		return true;
	});
	router.navTo("employee", { id: "1" });
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "navigation committed");
	assert.strictEqual(count, 1, "inherited guard ran once, not duplicated by re-adding the ancestor");
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
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	router.setRouteMeta("employee", { clearance: "manager" });

	const metaBefore = router.getRouteMeta("employee");
	assert.deepEqual(metaBefore, {}, "unknown route returns empty meta before addRoute");

	router.addRoute({ name: "employee", pattern: "employees/{id}" });

	const metaAfter = router.getRouteMeta("employee");
	assert.strictEqual(metaAfter.clearance, "manager", "pre-set runtime metadata becomes visible after addRoute");
});

QUnit.test("setRouteMeta on unknown route with warn policy logs a warning", async function (assert: Assert) {
	router = new GuardRouterClass([{ name: "home", pattern: "" }], {
		async: true,
		guardRouter: {
			unknownRouteRegistration: "warn",
		},
	});

	router.initialize();
	await waitForRoute(router, "home");

	const warnings = captureWarnings(() => {
		router.setRouteMeta("nonexistent", { key: "value" });
	});

	assert.deepEqual(
		warnings.map((w) => [w.message, w.details]),
		[["setRouteMeta: unknown route, metadata stored anyway", "nonexistent"]],
		"the warning says what was kept: metadata, not a guard",
	);

	// Despite the warning, the data is stored
	router.addRoute({ name: "nonexistent", pattern: "nonexistent" });
	const meta = router.getRouteMeta("nonexistent");
	assert.strictEqual(meta.key, "value", "metadata stored despite warning and accessible after addRoute");
});

QUnit.test(
	"addRoute() during block-mode loading inherits loaded guards without creating lazy wrappers",
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
					guardLoading: "block",
					unknownRouteRegistration: "ignore",
					guards: {
						employees: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
					},
				},
			},
		);

		router.initialize();
		assert.notOk(router.isInitialized(), "still loading block-mode guard modules");
		router.addRoute({ name: "employee", pattern: "employees/{id}" });
		await waitForRoute(router, "home");

		router.navTo("employee", { id: "42" });
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Blocked, "dynamic child inherited the block-loaded guard");
	},
);

QUnit.test(
	'unknownRouteRegistration "throw" does not later expand a rejected manifest guard onto descendants',
	async function (assert: Assert) {
		router = new GuardRouterClass(
			[
				{ name: "home", pattern: "" },
				{ name: "employee", pattern: "employees/{id}" },
			],
			{
				async: true,
				guardRouter: {
					inheritance: "pattern-tree",
					guardLoading: "lazy",
					unknownRouteRegistration: "throw",
					guards: {
						employees: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
					},
				},
			},
		);

		router.initialize();
		await waitForRoute(router, "home");

		// Adding the previously rejected ancestor route must not propagate a guard that failed registration.
		router.addRoute({ name: "employees", pattern: "employees" });
		router.navTo("employee", { id: "42" });
		assert.strictEqual(
			(await router.navigationSettled()).status,
			NavigationOutcome.Committed,
			"descendant does not inherit a guard rejected by unknownRouteRegistration: throw",
		);
	},
);
