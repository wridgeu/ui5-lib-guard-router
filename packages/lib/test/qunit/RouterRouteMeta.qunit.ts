import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardContext, GuardRouter } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import {
	captureWarnings,
	createRouter,
	createRouterWithOptions,
	createRouterWithOptionsUnsafe,
	createHierarchicalRouter,
	GuardRouterClass,
	HIERARCHICAL_ROUTES,
	initHashChanger,
	setRouteMetaUnsafe,
	getHash,
	waitForRoute,
	routerHooks,
} from "./testHelpers";

let router: GuardRouter;

const standardHooks = routerHooks(
	(created) => {
		router = created;
	},
	() => router,
);

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
		setRouteMetaUnsafe(router, "home", "not-an-object");
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
	const allowed = await router.navigationSettled();
	assert.strictEqual(allowed.status, NavigationOutcome.Committed, "authenticated user reaches protected route");
	assert.strictEqual(allowed.route, "protected", "settled on protected");
});

QUnit.test("invalid routeMeta entries produce warnings", function (assert: Assert) {
	const warnings = captureWarnings(() => {
		router = createRouterWithOptionsUnsafe({
			routeMeta: {
				home: "not an object",
				protected: { valid: true },
			},
		});
	});

	assert.deepEqual(
		warnings.map((w) => w.message),
		['guardRouter.routeMeta["home"]: expected object, skipping'],
		"one warning for the non-object metadata entry",
	);
	assert.deepEqual(router.getRouteMeta("protected"), { valid: true }, "valid entries still parsed");
});

QUnit.test("non-object routeMeta produces warning", function (assert: Assert) {
	const warnings = captureWarnings(() => {
		router = createRouterWithOptionsUnsafe({
			routeMeta: "invalid",
		});
	});

	assert.deepEqual(
		warnings,
		[{ message: "guardRouter.routeMeta: expected object, skipping", details: '"invalid"' }],
		"one warning for the non-object routeMeta",
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

QUnit.test('setRouteMeta("") is not subject to the unknown-route policy', function (assert: Assert) {
	router = createRouterWithOptions({ unknownRouteRegistration: "throw" });

	router.setRouteMeta("", { landing: true });

	assert.deepEqual(router.getRouteMeta(""), { landing: true }, "metadata for the root state is stored");
});

// ============================================================
// Module: Router - Guard and metadata inheritance
// ============================================================

QUnit.module("Router - Guard and metadata inheritance", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

// === Guard inheritance ======================================================

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
		await waitForRoute(router, "home");

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
	await waitForRoute(router, "home");

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
	await waitForRoute(router, "home");

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
	await waitForRoute(router, "home");

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
	await waitForRoute(router, "home");

	// Act: navigate to the parent route
	router.navTo("employees");
	await waitForRoute(router, "employees");

	// Assert: parent route is reachable; child guard did not propagate up
	assert.strictEqual(getHash(), "employees", "parent route reached; child guard did not propagate upward");
});

// === Metadata inheritance ===================================================

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

// === Integration with toMeta ================================================

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

// ============================================================
// Module: Pattern ancestry: UI5 pattern syntax edge cases
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
	// Arrange: parent uses {empId}, child uses {id}. Should still be recognized as ancestor
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
		},
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
		},
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
		},
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
		},
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
		},
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
		},
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
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("orderItems", { id: "99" });
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"ancestor guard propagated despite different param name",
	);
});

QUnit.test("mandatory param combined with inline query does not break ancestry", function (assert: Assert) {
	// UI5 allows {id}{?query}. The query portion is stripped, leaving just {id}
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
		},
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
		},
	);

	const detailMeta = router.getRouteMeta("appSettingsDetail");
	assert.strictEqual(detailMeta.layout, "shell", "grandchild inherits through ancestor with trailing optional param");
});

QUnit.test("all-optional pattern is not treated as ancestor of other routes", function (assert: Assert) {
	// Pattern ":mode:" consists entirely of optional segments. Should NOT be ancestor of anything
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
		},
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
	// Pattern "reports/:year:/:month:". Only "reports" is mandatory
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
		},
	);

	const detailMeta = router.getRouteMeta("reportDetail");
	assert.strictEqual(
		detailMeta.section,
		"analytics",
		"grandchild inherits through ancestor with multiple optional params",
	);
});

QUnit.test("rest catchall pattern with prefix still acts as ancestor", function (assert: Assert) {
	// Pattern "files/:path*:". "files" is mandatory, :path*: is rest/catchall
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
		},
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
			},
		);

		router.initialize();
		await waitForRoute(router, "home");

		// Dynamically add a child route after initialization
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

	// Dynamically add a child route
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

	// Set metadata for a route that doesn't exist yet
	router.setRouteMeta("employee", { clearance: "manager" });

	// getRouteMeta returns empty because route doesn't exist
	const metaBefore = router.getRouteMeta("employee");
	assert.deepEqual(metaBefore, {}, "unknown route returns empty meta before addRoute");

	// Now add the route
	router.addRoute({ name: "employee", pattern: "employees/{id}" });

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
