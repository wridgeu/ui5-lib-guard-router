import MobileRouter from "sap/m/routing/Router";
import HashChanger from "sap/ui/core/routing/HashChanger";
import coreLibrary from "sap/ui/core/library";
import type { GuardRouter } from "ui5/guard/router/types";
import { GuardRouterClass, initHashChanger, nextTick } from "./testHelpers";

const HistoryDirection = coreLibrary.routing.HistoryDirection;

/**
 * Verify that ui5.guard.router.Router is a true drop-in replacement
 * for sap.m.routing.Router: same API surface, same route matching.
 */

function createRouterConfig(): [object[], object] {
	const routes = [
		{ name: "home", pattern: "" },
		{ name: "page1", pattern: "page1" },
		{ name: "detail", pattern: "detail/{id}" },
		{ name: "nested", pattern: "category/{catId}/product/{prodId}" },
	];
	const config = { async: true };
	return [routes, config];
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

QUnit.test("Both routers have the same public routing methods", function (assert: Assert) {
	const methods = ["navTo", "getRoute", "getRouteInfoByHash", "match", "initialize", "stop", "destroy"];
	for (const method of methods) {
		assert.ok(
			typeof (extRouter as unknown as Record<string, unknown>)[method] === "function",
			`ext router has ${method}`,
		);
		assert.ok(
			typeof (nativeRouter as unknown as Record<string, unknown>)[method] === "function",
			`native router has ${method}`,
		);
	}
});

QUnit.test("ext router has additional guard methods", function (assert: Assert) {
	assert.ok(typeof extRouter.addGuard === "function", "has addGuard");
	assert.ok(typeof extRouter.removeGuard === "function", "has removeGuard");
	assert.ok(typeof extRouter.addRouteGuard === "function", "has addRouteGuard");
	assert.ok(typeof extRouter.removeRouteGuard === "function", "has removeRouteGuard");
	assert.ok(typeof extRouter.addLeaveGuard === "function", "has addLeaveGuard");
	assert.ok(typeof extRouter.removeLeaveGuard === "function", "has removeLeaveGuard");
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

QUnit.test("navTo updates hash identically", async function (assert: Assert) {
	extRouter.initialize();
	nativeRouter.initialize();

	extRouter.navTo("detail", { id: "123" });
	nativeRouter.navTo("detail", { id: "123" });

	await nextTick(100);

	// Both should generate the same hash pattern
	const extHash = extRouter.getHashChanger()?.getHash();
	const nativeHash = nativeRouter.getHashChanger()?.getHash();
	assert.strictEqual(extHash, nativeHash, "Both routers produce identical hash");
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
	await nextTick(50);

	// Navigate to page1 first (creates history entry)
	extRouter.navTo("page1");
	nativeRouter.navTo("page1");
	await nextTick(50);

	// Navigate with replace=true (should not create history entry)
	extRouter.navTo("detail", { id: "42" }, {}, true);
	nativeRouter.navTo("detail", { id: "42" }, {}, true);
	await nextTick(50);

	const extHash = extRouter.getHashChanger()?.getHash();
	const nativeHash = nativeRouter.getHashChanger()?.getHash();
	assert.strictEqual(extHash, nativeHash, "Both produce identical hash after replace");
	assert.strictEqual(extHash, "detail/42", "Hash is correct");
});

QUnit.test("navTo with replace=false creates history entry (default)", async function (assert: Assert) {
	extRouter.initialize();
	nativeRouter.initialize();
	await nextTick(50);

	// Navigate without replace (default, creates history entry)
	extRouter.navTo("detail", { id: "1" });
	nativeRouter.navTo("detail", { id: "1" });
	await nextTick(50);

	const extHash = extRouter.getHashChanger()?.getHash();
	const nativeHash = nativeRouter.getHashChanger()?.getHash();
	assert.strictEqual(extHash, nativeHash, "Both produce identical hash");
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
	await nextTick(50);

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
	await nextTick(50);

	// Sequential forward navigation
	extRouter.navTo("page1");
	nativeRouter.navTo("page1");
	await nextTick(50);

	extRouter.navTo("detail", { id: "1" });
	nativeRouter.navTo("detail", { id: "1" });
	await nextTick(50);

	extRouter.navTo("nested", { catId: "2", prodId: "3" });
	nativeRouter.navTo("nested", { catId: "2", prodId: "3" });
	await nextTick(50);

	assert.deepEqual(extEvents, nativeEvents, "Both routers fire same sequence of routeMatched events");
});

QUnit.test("Direct hash changes fire events identically", async function (assert: Assert) {
	const done = assert.async();
	let extFired = false;
	let nativeFired = false;
	let extRoute = "";
	let nativeRoute = "";

	extRouter.attachRouteMatched((event) => {
		if (event.getParameter("name") === "detail") {
			extRoute = event.getParameter("name") as string;
			extFired = true;
			checkDone();
		}
	});

	nativeRouter.attachRouteMatched((event) => {
		if (event.getParameter("name") === "detail") {
			nativeRoute = event.getParameter("name") as string;
			nativeFired = true;
			checkDone();
		}
	});

	function checkDone() {
		if (extFired && nativeFired) {
			assert.strictEqual(extRoute, nativeRoute, "Both handle direct hash change identically");
			done();
		}
	}

	extRouter.initialize();
	nativeRouter.initialize();
	await nextTick(50);

	// Simulate direct URL entry / browser navigation
	HashChanger.getInstance().setHash("detail/direct-entry");
});

QUnit.test("replaceHash behaves identically", async function (assert: Assert) {
	const done = assert.async();
	let extFired = false;
	let nativeFired = false;

	extRouter.attachRouteMatched((event) => {
		if (event.getParameter("name") === "page1") {
			extFired = true;
			checkDone();
		}
	});

	nativeRouter.attachRouteMatched((event) => {
		if (event.getParameter("name") === "page1") {
			nativeFired = true;
			checkDone();
		}
	});

	function checkDone() {
		if (extFired && nativeFired) {
			const extHash = extRouter.getHashChanger()?.getHash();
			const nativeHash = nativeRouter.getHashChanger()?.getHash();
			assert.strictEqual(extHash, nativeHash, "replaceHash produces identical result");
			done();
		}
	}

	extRouter.initialize();
	nativeRouter.initialize();
	await nextTick(50);

	// Use replaceHash directly
	HashChanger.getInstance().replaceHash("page1", HistoryDirection.NewEntry);
});
