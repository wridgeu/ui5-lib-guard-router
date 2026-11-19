import MobileRouter from "sap/m/routing/Router";
import HashChanger from "sap/ui/core/routing/HashChanger";
import coreLibrary from "sap/ui/core/library";
import type { GuardRouter } from "ui5/guard/router/types";
import {
	callUnsafe,
	captureHashWrites,
	flushPromises,
	GuardRouterClass,
	initHashChanger,
	recordSettlements,
} from "../../testHelpers";

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

// ============================================================
// Module: API parity
// ============================================================
let extRouter: GuardRouter;
let nativeRouter: MobileRouter;

const routerPairHooks = {
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
};

QUnit.module("NativeCompat - API parity", routerPairHooks);

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

QUnit.test(
	"an attach call without a handler registers a listener, as with the native router",
	function (assert: Assert) {
		callUnsafe(extRouter, "attachRouteMatched", { some: "data" });
		assert.ok(
			extRouter.hasListeners("routeMatched"),
			"a call without a handler is left to EventProvider, as natively",
		);

		callUnsafe(extRouter, "attachNavigationSettled", { some: "data" });
		assert.ok(
			extRouter.hasListeners("navigationSettled"),
			"attachNavigationSettled() registers like attachEvent()",
		);
	},
);

QUnit.test("routes without a name in a routes array are not named by their index", async function (assert: Assert) {
	// UI5 registers both unnamed routes under the one name "undefined". A route added as "0" is a new route.
	const routes = [{ pattern: "first" }, { pattern: "second" }, { name: "page", pattern: "page" }];
	const ext = new GuardRouterClass(routes, {
		async: true,
		guardRouter: {
			inheritance: "pattern-tree",
			guards: { page: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"] },
		},
	});
	try {
		const statuses = recordSettlements(ext);
		ext.initialize();
		await flushPromises();
		ext.addRoute({ name: "0", pattern: "page/detail" });
		ext.navTo("0");
		await ext.navigationSettled();
		assert.deepEqual(
			statuses,
			["bypassed", "blocked"],
			"a route added under that name is new: it inherits the guard",
		);
	} finally {
		ext.destroy();
	}
});

// ============================================================
// Module: Route matching parity
// ============================================================
QUnit.module("NativeCompat - Route matching", routerPairHooks);

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
QUnit.module("NativeCompat - Navigation behavior", routerPairHooks);

QUnit.test("getRoute returns routes with the same pattern", function (assert: Assert) {
	const pattern = (router: MobileRouter, name: string): string | undefined => router.getRoute(name)?.getPattern();
	for (const name of ["home", "page1", "detail", "nested"]) {
		assert.strictEqual(pattern(extRouter, name), pattern(nativeRouter, name), `getRoute("${name}")`);
		assert.notStrictEqual(pattern(extRouter, name), undefined, `"${name}" is a route of the guard router`);
	}
	assert.strictEqual(extRouter.getRoute("nonexistent"), undefined, "an unknown route is undefined");
	assert.strictEqual(nativeRouter.getRoute("nonexistent"), undefined, "as with the native router");
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
QUnit.module("NativeCompat - Event firing", routerPairHooks);

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
QUnit.module("NativeCompat - URL generation", routerPairHooks);

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
QUnit.module("NativeCompat - navTo with replace", routerPairHooks);

QUnit.test("navTo with replace=true updates hash without history entry", async function (assert: Assert) {
	extRouter.initialize();
	nativeRouter.initialize();
	await flushPromises();

	// Each router navigates on its own: both share one HashChanger, so comparing
	// the resulting hash would read the same value twice.
	extRouter.navTo("page1");
	await flushPromises();
	const extWrites = await captureHashWrites(extRouter.getHashChanger(), () => {
		extRouter.navTo("detail", { id: "42" }, {}, true);
	});

	nativeRouter.navTo("page1");
	await flushPromises();
	const nativeWrites = await captureHashWrites(nativeRouter.getHashChanger(), () => {
		nativeRouter.navTo("detail", { id: "42" }, {}, true);
	});

	assert.deepEqual(extWrites, ["replace:detail/42"], "ext router replaces the hash");
	assert.deepEqual(extWrites, nativeWrites, "Both routers issue the same hash write");
});

QUnit.test("navTo with replace=false creates history entry (default)", async function (assert: Assert) {
	extRouter.initialize();
	nativeRouter.initialize();
	await flushPromises();

	const extWrites = await captureHashWrites(extRouter.getHashChanger(), () => {
		extRouter.navTo("detail", { id: "1" });
	});
	HashChanger.getInstance().setHash("");
	await flushPromises();
	const nativeWrites = await captureHashWrites(nativeRouter.getHashChanger(), () => {
		nativeRouter.navTo("detail", { id: "1" });
	});

	assert.deepEqual(extWrites, ["set:detail/1"], "ext router sets the hash (new history entry)");
	assert.deepEqual(extWrites, nativeWrites, "Both routers issue the same hash write");
});

// ============================================================
// Module: Hash change direction handling
// ============================================================
QUnit.module("NativeCompat - Hash change direction", routerPairHooks);

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
