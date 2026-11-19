import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardContext, GuardRouter } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import {
	captureWarnings,
	createRouter,
	createRouterWithOptions,
	createRouterWithOptionsUnsafe,
	initHashChanger,
	setRouteMetaUnsafe,
	waitForRoute,
	routerHooks,
} from "../../testHelpers";

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
