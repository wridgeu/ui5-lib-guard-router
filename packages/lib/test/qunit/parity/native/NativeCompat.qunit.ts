import MobileRouter from "sap/m/routing/Router";
import HashChanger from "sap/ui/core/routing/HashChanger";
import coreLibrary from "sap/ui/core/library";
import type { GuardRouter } from "ui5/guard/router/types";
import { callUnsafe, captureHashWrites, flushPromises, GuardRouterClass, initHashChanger } from "../../testHelpers";

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

QUnit.test("an attach call without a handler is passed on to EventProvider", function (assert: Assert) {
	callUnsafe(extRouter, "attachRouteMatched", { some: "data" });
	assert.ok(extRouter.hasListeners("routeMatched"), "a call without a handler is left to EventProvider, as natively");

	callUnsafe(extRouter, "attachNavigationSettled", { some: "data" });
	assert.ok(extRouter.hasListeners("navigationSettled"), "attachNavigationSettled() registers like attachEvent()");
});

QUnit.module("NativeCompat - Navigation behavior", routerPairHooks);

QUnit.test("initialize/stop behavior matches", function (assert: Assert) {
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

QUnit.module("NativeCompat - Event firing", routerPairHooks);

QUnit.test("bypassed event fires identically for unknown routes", async function (assert: Assert) {
	const done = assert.async();
	let extFired = false;
	let nativeFired = false;
	let extHash: string | undefined;
	let nativeHash: string | undefined;

	extRouter.attachBypassed((event) => {
		extHash = event.getParameter("hash");
		extFired = true;
		checkDone();
	});

	nativeRouter.attachBypassed((event) => {
		nativeHash = event.getParameter("hash");
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

	HashChanger.getInstance().replaceHash("page1", HistoryDirection.NewEntry);
	await flushPromises();

	assert.deepEqual(extMatched, ["home", "page1"], "ext router matched the replaced hash");
	assert.deepEqual(extMatched, nativeMatched, "replaceHash produces identical routeMatched sequence");
});
