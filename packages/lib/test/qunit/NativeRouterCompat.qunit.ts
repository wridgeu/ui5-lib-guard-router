import MobileRouter from "sap/m/routing/Router";
import HashChanger from "sap/ui/core/routing/HashChanger";
import coreLibrary from "sap/ui/core/library";
import type { GuardRouter } from "ui5/guard/router/types";
import { firstDifference, recordHashes, recordLogs, recordRouter, settle } from "./parityRecorder";
import { flushPromises, GuardRouterClass, initHashChanger } from "./testHelpers";

const HistoryDirection = coreLibrary.routing.HistoryDirection;

/**
 * Verify that ui5.guard.router.Router is a true drop-in replacement
 * for sap.m.routing.Router: same API surface, same route matching.
 */

function createRouterConfig(): ConstructorParameters<typeof MobileRouter> {
	const routes = [
		{ name: "home", pattern: "" },
		{ name: "page1", pattern: "page1" },
		{ name: "detail", pattern: "detail/{id}" },
		{ name: "nested", pattern: "category/{catId}/product/{prodId}" },
	];
	const config = { async: true };
	return [routes, config];
}

/** Record the hash writes `router` issues on its own HashChanger while `navigate` runs. */
async function captureHashWrites(router: MobileRouter, navigate: () => void): Promise<string[]> {
	const hashChanger = router.getHashChanger();
	const setHash = sinon.spy(hashChanger, "setHash");
	const replaceHash = sinon.spy(hashChanger, "replaceHash");
	try {
		navigate();
		await flushPromises();
	} finally {
		setHash.restore();
		replaceHash.restore();
	}
	return [
		...setHash.getCalls().map((call) => ({ call, label: `set:${String(call.args[0])}` })),
		...replaceHash.getCalls().map((call) => ({ call, label: `replace:${String(call.args[0])}` })),
	]
		.toSorted((a, b) => (a.call.calledBefore(b.call) ? -1 : 1))
		.map(({ label }) => label);
}

// ============================================================
// Module: API parity
// ============================================================
let extRouter: GuardRouter;
let nativeRouter: MobileRouter;

QUnit.module("NativeCompat - API parity", {
	beforeEach: function () {
		initHashChanger();
		const [routes, config] = createRouterConfig();
		extRouter = new GuardRouterClass(routes, config);
		nativeRouter = new MobileRouter(routes, config);
	},
	afterEach: function () {
		extRouter.destroy();
		nativeRouter.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("Both routers are instances of sap.m.routing.Router", function (assert: Assert) {
	assert.ok(extRouter.isA("sap.m.routing.Router"), "ext router isA sap.m.routing.Router");
	assert.ok(nativeRouter.isA("sap.m.routing.Router"), "native router isA sap.m.routing.Router");
});

QUnit.test("ext router has additional guard methods", function (assert: Assert) {
	assert.ok(typeof extRouter.addGuard === "function", "has addGuard");
	assert.ok(typeof extRouter.removeGuard === "function", "has removeGuard");
	assert.ok(typeof extRouter.addRouteGuard === "function", "has addRouteGuard");
	assert.ok(typeof extRouter.removeRouteGuard === "function", "has removeRouteGuard");
	assert.ok(typeof extRouter.addLeaveGuard === "function", "has addLeaveGuard");
	assert.ok(typeof extRouter.removeLeaveGuard === "function", "has removeLeaveGuard");
	assert.ok(typeof extRouter.navigationSettled === "function", "has navigationSettled");
});

// ============================================================
// Module: Route matching parity
// ============================================================
QUnit.module("NativeCompat - Route matching", {
	beforeEach: function () {
		initHashChanger();
		const [routes, config] = createRouterConfig();
		extRouter = new GuardRouterClass(routes, config);
		nativeRouter = new MobileRouter(routes, config);
	},
	afterEach: function () {
		extRouter.destroy();
		nativeRouter.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("match() returns identical results for known hashes", function (assert: Assert) {
	const knownHashes = ["", "page1", "detail/123", "category/1/product/2"];
	for (const hash of knownHashes) {
		assert.strictEqual(extRouter.match(hash), nativeRouter.match(hash), `match("${hash}") returns same result`);
	}
});

QUnit.test("match() returns identical results for unknown hashes", function (assert: Assert) {
	const unknownHashes = ["nonexistent", "detail", "category/1", "foo/bar/baz"];
	for (const hash of unknownHashes) {
		assert.strictEqual(extRouter.match(hash), nativeRouter.match(hash), `match("${hash}") returns same result`);
	}
});

QUnit.test("getRouteInfoByHash returns identical info", function (assert: Assert) {
	const hashes = ["", "page1", "detail/42", "category/5/product/10", "nonexistent"];
	for (const hash of hashes) {
		const extInfo = extRouter.getRouteInfoByHash(hash);
		const nativeInfo = nativeRouter.getRouteInfoByHash(hash);
		assert.deepEqual(extInfo, nativeInfo, `getRouteInfoByHash("${hash}") returns same result`);
	}
});

// ============================================================
// Module: Navigation behavior parity
// ============================================================
QUnit.module("NativeCompat - Navigation behavior", {
	beforeEach: function () {
		initHashChanger();
		const [routes, config] = createRouterConfig();
		extRouter = new GuardRouterClass(routes, config);
		nativeRouter = new MobileRouter(routes, config);
	},
	afterEach: function () {
		extRouter.destroy();
		nativeRouter.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("getRoute returns identical route objects", function (assert: Assert) {
	const routeNames = ["home", "page1", "detail", "nested", "nonexistent"];
	for (const name of routeNames) {
		const extRoute = extRouter.getRoute(name);
		const nativeRoute = nativeRouter.getRoute(name);
		if (extRoute && nativeRoute) {
			assert.strictEqual(extRoute.getPattern(), nativeRoute.getPattern(), `getRoute("${name}") pattern matches`);
		} else {
			assert.strictEqual(extRoute, nativeRoute, `getRoute("${name}") both return undefined`);
		}
	}
});

QUnit.test("initialize/stop behavior matches", function (assert: Assert) {
	// Both should not be initialized initially
	assert.notOk(extRouter.isInitialized(), "ext router not initialized");
	assert.notOk(nativeRouter.isInitialized(), "native router not initialized");

	extRouter.initialize();
	nativeRouter.initialize();

	assert.ok(extRouter.isInitialized(), "ext router initialized");
	assert.ok(nativeRouter.isInitialized(), "native router initialized");

	extRouter.stop();
	nativeRouter.stop();

	assert.notOk(extRouter.isInitialized(), "ext router stopped");
	assert.notOk(nativeRouter.isInitialized(), "native router stopped");
});

QUnit.test("stop + initialize fires routeMatched identically", async function (assert: Assert) {
	extRouter.initialize();
	nativeRouter.initialize();
	await flushPromises();

	extRouter.stop();
	nativeRouter.stop();

	let extFired = false;
	let nativeFired = false;
	extRouter.attachRouteMatched(() => {
		extFired = true;
	});
	nativeRouter.attachRouteMatched(() => {
		nativeFired = true;
	});

	extRouter.initialize();
	nativeRouter.initialize();
	await flushPromises();

	assert.ok(nativeFired, "native router fires routeMatched on re-init");
	assert.ok(extFired, "guard router fires routeMatched on re-init (native parity)");
});

// ============================================================
// Module: Event firing parity
// ============================================================
QUnit.module("NativeCompat - Event firing", {
	beforeEach: function () {
		initHashChanger();
		const [routes, config] = createRouterConfig();
		extRouter = new GuardRouterClass(routes, config);
		nativeRouter = new MobileRouter(routes, config);
	},
	afterEach: function () {
		extRouter.destroy();
		nativeRouter.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("routeMatched fires with identical parameters", async function (assert: Assert) {
	const done = assert.async();
	let extParams: Record<string, unknown> | null = null;
	let nativeParams: Record<string, unknown> | null = null;

	// Only capture the "detail" route event, ignore initial "home" event
	extRouter.attachRouteMatched((event) => {
		if (event.getParameter("name") === "detail") {
			extParams = {
				name: event.getParameter("name"),
				arguments: event.getParameter("arguments"),
			};
			checkDone();
		}
	});

	nativeRouter.attachRouteMatched((event) => {
		if (event.getParameter("name") === "detail") {
			nativeParams = {
				name: event.getParameter("name"),
				arguments: event.getParameter("arguments"),
			};
			checkDone();
		}
	});

	function checkDone() {
		if (extParams && nativeParams) {
			assert.deepEqual(extParams, nativeParams, "routeMatched parameters match");
			done();
		}
	}

	extRouter.initialize();
	nativeRouter.initialize();
	extRouter.navTo("detail", { id: "42" });
	nativeRouter.navTo("detail", { id: "42" });
});

QUnit.test("patternMatched fires with identical parameters", async function (assert: Assert) {
	const done = assert.async();
	let extParams: Record<string, unknown> | null = null;
	let nativeParams: Record<string, unknown> | null = null;
	let extFired = false;
	let nativeFired = false;

	extRouter.getRoute("nested")!.attachPatternMatched((event) => {
		extParams = {
			name: event.getParameter("name"),
			arguments: event.getParameter("arguments"),
		};
		extFired = true;
		checkDone();
	});

	nativeRouter.getRoute("nested")!.attachPatternMatched((event) => {
		nativeParams = {
			name: event.getParameter("name"),
			arguments: event.getParameter("arguments"),
		};
		nativeFired = true;
		checkDone();
	});

	function checkDone() {
		if (extFired && nativeFired) {
			assert.deepEqual(extParams, nativeParams, "patternMatched parameters match");
			done();
		}
	}

	extRouter.initialize();
	nativeRouter.initialize();
	extRouter.navTo("nested", { catId: "5", prodId: "10" });
	nativeRouter.navTo("nested", { catId: "5", prodId: "10" });
});

QUnit.test("bypassed event fires identically for unknown routes", async function (assert: Assert) {
	const done = assert.async();
	let extFired = false;
	let nativeFired = false;
	let extHash = "";
	let nativeHash = "";

	extRouter.attachBypassed((event) => {
		extHash = event.getParameter("hash") as string;
		extFired = true;
		checkDone();
	});

	nativeRouter.attachBypassed((event) => {
		nativeHash = event.getParameter("hash") as string;
		nativeFired = true;
		checkDone();
	});

	function checkDone() {
		if (extFired && nativeFired) {
			assert.strictEqual(extHash, nativeHash, "bypassed hash parameter matches");
			done();
		}
	}

	extRouter.initialize();
	nativeRouter.initialize();

	// Trigger bypassed by navigating to unknown route
	HashChanger.getInstance().setHash("unknown/route/here");
});

// ============================================================
// Module: URL generation parity
// ============================================================
QUnit.module("NativeCompat - URL generation", {
	beforeEach: function () {
		initHashChanger();
		const [routes, config] = createRouterConfig();
		extRouter = new GuardRouterClass(routes, config);
		nativeRouter = new MobileRouter(routes, config);
	},
	afterEach: function () {
		extRouter.destroy();
		nativeRouter.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("getURL generates identical URLs for routes without parameters", function (assert: Assert) {
	const extUrl = extRouter.getURL("home");
	const nativeUrl = nativeRouter.getURL("home");
	assert.strictEqual(extUrl, nativeUrl, "getURL('home') returns identical URL");

	const extUrl2 = extRouter.getURL("page1");
	const nativeUrl2 = nativeRouter.getURL("page1");
	assert.strictEqual(extUrl2, nativeUrl2, "getURL('page1') returns identical URL");
});

QUnit.test("getURL generates identical URLs for routes with parameters", function (assert: Assert) {
	const extUrl = extRouter.getURL("detail", { id: "123" });
	const nativeUrl = nativeRouter.getURL("detail", { id: "123" });
	assert.strictEqual(extUrl, nativeUrl, "getURL('detail', {id: '123'}) returns identical URL");
});

QUnit.test("getURL generates identical URLs for nested routes", function (assert: Assert) {
	const extUrl = extRouter.getURL("nested", { catId: "5", prodId: "10" });
	const nativeUrl = nativeRouter.getURL("nested", { catId: "5", prodId: "10" });
	assert.strictEqual(extUrl, nativeUrl, "getURL('nested', {...}) returns identical URL");
});

QUnit.test("getURL returns undefined for unknown routes", function (assert: Assert) {
	const extUrl = extRouter.getURL("nonexistent");
	const nativeUrl = nativeRouter.getURL("nonexistent");
	assert.strictEqual(extUrl, nativeUrl, "getURL('nonexistent') both return undefined");
	assert.strictEqual(extUrl, undefined, "Returns undefined");
});

// ============================================================
// Module: navTo with replace parity
// ============================================================
QUnit.module("NativeCompat - navTo with replace", {
	beforeEach: function () {
		initHashChanger();
		const [routes, config] = createRouterConfig();
		extRouter = new GuardRouterClass(routes, config);
		nativeRouter = new MobileRouter(routes, config);
	},
	afterEach: function () {
		extRouter.destroy();
		nativeRouter.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("navTo with replace=true updates hash without history entry", async function (assert: Assert) {
	extRouter.initialize();
	nativeRouter.initialize();
	await flushPromises();

	// Each router navigates on its own: both share one HashChanger, so comparing
	// the resulting hash would read the same value twice.
	extRouter.navTo("page1");
	await flushPromises();
	const extWrites = await captureHashWrites(extRouter, () => extRouter.navTo("detail", { id: "42" }, {}, true));

	nativeRouter.navTo("page1");
	await flushPromises();
	const nativeWrites = await captureHashWrites(nativeRouter, () =>
		nativeRouter.navTo("detail", { id: "42" }, {}, true),
	);

	assert.deepEqual(extWrites, ["replace:detail/42"], "ext router replaces the hash");
	assert.deepEqual(extWrites, nativeWrites, "Both routers issue the same hash write");
});

QUnit.test("navTo with replace=false creates history entry (default)", async function (assert: Assert) {
	extRouter.initialize();
	nativeRouter.initialize();
	await flushPromises();

	const extWrites = await captureHashWrites(extRouter, () => extRouter.navTo("detail", { id: "1" }));
	HashChanger.getInstance().setHash("");
	await flushPromises();
	const nativeWrites = await captureHashWrites(nativeRouter, () => nativeRouter.navTo("detail", { id: "1" }));

	assert.deepEqual(extWrites, ["set:detail/1"], "ext router sets the hash (new history entry)");
	assert.deepEqual(extWrites, nativeWrites, "Both routers issue the same hash write");
});

QUnit.test("navTo fires routeMatched identically with replace=true", async function (assert: Assert) {
	const done = assert.async();
	let extParams: Record<string, unknown> | null = null;
	let nativeParams: Record<string, unknown> | null = null;

	extRouter.attachRouteMatched((event) => {
		if (event.getParameter("name") === "detail") {
			extParams = {
				name: event.getParameter("name"),
				arguments: event.getParameter("arguments"),
			};
			checkDone();
		}
	});

	nativeRouter.attachRouteMatched((event) => {
		if (event.getParameter("name") === "detail") {
			nativeParams = {
				name: event.getParameter("name"),
				arguments: event.getParameter("arguments"),
			};
			checkDone();
		}
	});

	function checkDone() {
		if (extParams && nativeParams) {
			assert.deepEqual(extParams, nativeParams, "routeMatched parameters match with replace=true");
			done();
		}
	}

	extRouter.initialize();
	nativeRouter.initialize();
	await flushPromises();

	extRouter.navTo("detail", { id: "99" }, {}, true);
	nativeRouter.navTo("detail", { id: "99" }, {}, true);
});

// ============================================================
// Module: Hash change direction handling
// ============================================================
QUnit.module("NativeCompat - Hash change direction", {
	beforeEach: function () {
		initHashChanger();
		const [routes, config] = createRouterConfig();
		extRouter = new GuardRouterClass(routes, config);
		nativeRouter = new MobileRouter(routes, config);
	},
	afterEach: function () {
		extRouter.destroy();
		nativeRouter.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("Both routers handle forward navigation identically", async function (assert: Assert) {
	const extEvents: string[] = [];
	const nativeEvents: string[] = [];

	extRouter.attachRouteMatched((event) => {
		extEvents.push(event.getParameter("name") as string);
	});
	nativeRouter.attachRouteMatched((event) => {
		nativeEvents.push(event.getParameter("name") as string);
	});

	extRouter.initialize();
	nativeRouter.initialize();
	await flushPromises();

	// Sequential forward navigation
	extRouter.navTo("page1");
	nativeRouter.navTo("page1");
	await flushPromises();

	extRouter.navTo("detail", { id: "1" });
	nativeRouter.navTo("detail", { id: "1" });
	await flushPromises();

	extRouter.navTo("nested", { catId: "2", prodId: "3" });
	nativeRouter.navTo("nested", { catId: "2", prodId: "3" });
	await flushPromises();

	assert.deepEqual(extEvents, nativeEvents, "Both routers fire same sequence of routeMatched events");
});

QUnit.test("Direct hash changes fire events identically", async function (assert: Assert) {
	const done = assert.async();
	let extFired = false;
	let nativeFired = false;
	let extArgs: unknown;
	let nativeArgs: unknown;

	extRouter.attachRouteMatched((event) => {
		if (event.getParameter("name") === "detail") {
			extArgs = event.getParameter("arguments");
			extFired = true;
			checkDone();
		}
	});

	nativeRouter.attachRouteMatched((event) => {
		if (event.getParameter("name") === "detail") {
			nativeArgs = event.getParameter("arguments");
			nativeFired = true;
			checkDone();
		}
	});

	function checkDone() {
		if (extFired && nativeFired) {
			assert.deepEqual(extArgs, { id: "direct-entry" }, "ext router parsed the direct hash");
			assert.deepEqual(extArgs, nativeArgs, "Both handle direct hash change identically");
			done();
		}
	}

	extRouter.initialize();
	nativeRouter.initialize();
	await flushPromises();

	// Simulate direct URL entry / browser navigation
	HashChanger.getInstance().setHash("detail/direct-entry");
});

QUnit.test("replaceHash behaves identically", async function (assert: Assert) {
	const extMatched: unknown[] = [];
	const nativeMatched: unknown[] = [];
	extRouter.attachRouteMatched((event) => extMatched.push(event.getParameter("name")));
	nativeRouter.attachRouteMatched((event) => nativeMatched.push(event.getParameter("name")));

	extRouter.initialize();
	nativeRouter.initialize();
	await flushPromises();

	// Use replaceHash directly
	HashChanger.getInstance().replaceHash("page1", HistoryDirection.NewEntry);
	await flushPromises();

	assert.deepEqual(extMatched, ["home", "page1"], "ext router matched the replaced hash");
	assert.deepEqual(extMatched, nativeMatched, "replaceHash produces identical routeMatched sequence");
});

// ============================================================
// Module: Recorded behavior parity
// ============================================================

/** Routes with every kind of pattern segment: mandatory, optional, query and rest. */
const TRACE_ROUTES = [
	{ name: "home", pattern: "" },
	{ name: "page1", pattern: "page1" },
	{ name: "detail", pattern: "detail/{id}" },
	{ name: "search", pattern: "search/{term}:?query:" },
	{ name: "files", pattern: "files/:path*:" },
];

type TraceStep = (router: MobileRouter, trace: string[]) => void;

/**
 * Run `steps` on a router of its own and return everything it did: router and route events with
 * their parameters, hash writes, logged warnings and errors. One router runs at a time, so that
 * no event or hash write of the other router gets into the trace.
 */
async function traceRouter(create: () => MobileRouter, steps: TraceStep[]): Promise<string[]> {
	initHashChanger();
	const trace: string[] = [];
	const router = create();
	const stopHashes = recordHashes(trace);
	const stopLogs = recordLogs(trace);
	recordRouter(
		"router",
		router,
		trace,
		TRACE_ROUTES.map((route) => route.name),
	);
	try {
		for (const [index, step] of steps.entries()) {
			trace.push(`step ${index}`);
			step(router, trace);
			await settle(trace);
			trace.push(`hash "${HashChanger.getInstance().getHash()}"`);
		}
		return trace;
	} finally {
		stopLogs();
		stopHashes();
		router.destroy();
		HashChanger.getInstance().setHash("");
		await flushPromises();
	}
}

/** Assert that the guard router without guards leaves the same trace as the native router. */
async function assertSameTrace(assert: Assert, steps: TraceStep[], expected: string[]): Promise<void> {
	const config = { async: true };
	const native = await traceRouter(() => new MobileRouter(TRACE_ROUTES, config), steps);
	const guard = await traceRouter(() => new GuardRouterClass(TRACE_ROUTES, config), steps);

	for (const prefix of expected) {
		assert.ok(
			native.some((line) => line.startsWith(prefix)),
			`the native router recorded "${prefix}"`,
		);
	}
	assert.strictEqual(
		firstDifference(guard, native),
		undefined,
		"the guard router leaves the same trace as the native router",
	);
}

/** navTo as a step; UI5 throws out of navTo when a mandatory parameter is missing. */
const navTo =
	(name: string, parameters?: object, replace?: boolean): TraceStep =>
	(router, trace) => {
		try {
			trace.push(`navTo returns the router: ${router.navTo(name, parameters, replace) === router}`);
		} catch (error) {
			trace.push(`navTo throws: ${String(error)}`);
		}
	};

const browserHash =
	(hash: string): TraceStep =>
	() => {
		HashChanger.getInstance().setHash(hash);
	};

QUnit.module("NativeCompat - Recorded behavior");

QUnit.test("a sequence of navigations fires the same events in the same order", async function (assert: Assert) {
	await assertSameTrace(
		assert,
		[
			(router) => router.initialize(),
			navTo("page1"),
			navTo("detail", { id: "4 2" }),
			navTo("search", { term: "ui5", "?query": { sort: "asc", page: "2" } }),
			navTo("files", { "path*": "a/b/c" }),
			navTo("files"),
			browserHash("unknown/route"),
			() => HashChanger.getInstance().replaceHash("page1", HistoryDirection.NewEntry),
			navTo("page1"),
			navTo("home", {}, true),
		],
		[
			"router beforeRouteMatched page1 ",
			"router route:page1 switched ",
			"router routePatternMatched detail ",
			"router routeMatched search ",
			"router routeMatched files ",
			"router bypassed unknown/route ",
			"hash hashReplaced ",
		],
	);
});

QUnit.test("navTo with a route or parameters that do not resolve behaves the same", async function (assert: Assert) {
	await assertSameTrace(
		assert,
		[
			(router) => router.initialize(),
			navTo("nonexistent"),
			// The mandatory parameter is missing.
			navTo("detail"),
			navTo("page1"),
		],
		["router routeMatched page1 "],
	);
});

QUnit.test("stop and initialize cycles fire the same events", async function (assert: Assert) {
	await assertSameTrace(
		assert,
		[
			(router) => router.initialize(),
			navTo("page1"),
			(router) => router.stop(),
			// A hash change while stopped fires nothing; initialize() then matches the current hash.
			browserHash("detail/1"),
			(router) => router.initialize(),
			(router) => router.initialize(),
			(router) => router.stop(),
			browserHash("page1"),
			// initialize(true) ignores the current hash.
			(router) => router.initialize(true),
			browserHash("detail/2"),
			(router, trace) => {
				trace.push(`initialized: ${router.isInitialized()}, stopped: ${router.isStopped()}`);
			},
		],
		["router routeMatched detail "],
	);
});

QUnit.test("a hash that several routes could match resolves to the same route", function (assert: Assert) {
	const routes = [
		{ name: "detail", pattern: "detail/{id}" },
		{ name: "optional", pattern: "optional/:id:" },
		{ name: "catchAll", pattern: ":all*:" },
	];
	const native = new MobileRouter(routes, { async: true });
	const guard = new GuardRouterClass(routes, { async: true });
	try {
		for (const hash of ["", "detail/1", "optional", "optional/1", "anything/else", "detail/a%20b?x=1"]) {
			assert.deepEqual(
				guard.getRouteInfoByHash(hash),
				native.getRouteInfoByHash(hash),
				`getRouteInfoByHash("${hash}") returns the same route and arguments`,
			);
			assert.strictEqual(guard.match(hash), native.match(hash), `match("${hash}") returns the same result`);
		}
	} finally {
		native.destroy();
		guard.destroy();
	}
});
