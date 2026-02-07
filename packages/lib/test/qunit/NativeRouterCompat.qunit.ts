import Router from "ui5/ext/routing/Router";
import MobileRouter from "sap/m/routing/Router";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type { RouterInstance } from "ui5/ext/routing/types";
import { initHashChanger, nextTick } from "./testHelpers";

/**
 * Native Router Compatibility Tests
 *
 * These tests verify that ui5.ext.routing.Router behaves identically to
 * sap.m.routing.Router when no guards are registered. This ensures it's
 * a true drop-in replacement.
 */

function createRouterConfig(): [object[], object] {
	const routes = [
		{ name: "home", pattern: "" },
		{ name: "page1", pattern: "page1" },
		{ name: "page2", pattern: "page2" },
		{ name: "detail", pattern: "detail/{id}" },
		{ name: "nested", pattern: "category/{catId}/product/{prodId}" }
	];
	const config = { async: true };
	return [routes, config];
}

// ============================================================
// Module: API parity
// ============================================================
let extRouter: RouterInstance;
let nativeRouter: any; // MobileRouter lacks usable TS types from .extend()

QUnit.module("NativeCompat - API parity", {
	beforeEach: function () {
		initHashChanger();
		const [routes, config] = createRouterConfig();
		extRouter = new (Router as any)(routes, config) as RouterInstance;
		nativeRouter = new MobileRouter(routes, config);
	},
	afterEach: function () {
		extRouter.destroy();
		nativeRouter.destroy();
		HashChanger.getInstance().setHash("");
	}
});

QUnit.test("Both routers are instances of sap.m.routing.Router", function (assert: Assert) {
	assert.ok(extRouter.isA("sap.m.routing.Router"), "ext router isA sap.m.routing.Router");
	assert.ok(nativeRouter.isA("sap.m.routing.Router"), "native router isA sap.m.routing.Router");
});

QUnit.test("Both routers have the same public routing methods", function (assert: Assert) {
	const methods = ["navTo", "getRoute", "getRouteInfoByHash", "match", "initialize", "stop", "destroy"];
	for (const method of methods) {
		assert.ok(typeof (extRouter as any)[method] === "function", `ext router has ${method}`);
		assert.ok(typeof nativeRouter[method] === "function", `native router has ${method}`);
	}
});

QUnit.test("ext router has additional guard methods", function (assert: Assert) {
	assert.ok(typeof extRouter.addGuard === "function", "has addGuard");
	assert.ok(typeof extRouter.removeGuard === "function", "has removeGuard");
	assert.ok(typeof extRouter.addRouteGuard === "function", "has addRouteGuard");
	assert.ok(typeof extRouter.removeRouteGuard === "function", "has removeRouteGuard");
});

// ============================================================
// Module: Route matching parity
// ============================================================
let router: RouterInstance;

QUnit.module("NativeCompat - Route matching", {
	beforeEach: function () {
		initHashChanger();
		const [routes, config] = createRouterConfig();
		router = new (Router as any)(routes, config) as RouterInstance;
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	}
});

QUnit.test("match() returns true for known hashes", function (assert: Assert) {
	assert.ok(router.match(""), "empty hash matches home");
	assert.ok(router.match("page1"), "page1 matches");
	assert.ok(router.match("detail/123"), "detail/123 matches");
	assert.ok(router.match("category/1/product/2"), "nested route matches");
});

QUnit.test("match() returns false for unknown hashes", function (assert: Assert) {
	assert.notOk(router.match("nonexistent"), "unknown hash does not match");
	assert.notOk(router.match("detail"), "detail without param does not match");
});

QUnit.test("getRouteInfoByHash returns correct info", function (assert: Assert) {
	const info = router.getRouteInfoByHash("detail/42");
	assert.ok(info, "Info returned for detail/42");
	assert.strictEqual(info!.name, "detail", "Route name is detail");
	assert.deepEqual(info!.arguments, { id: "42" }, "Arguments extracted correctly");
});

QUnit.test("getRouteInfoByHash returns correct info for nested params", function (assert: Assert) {
	const info = router.getRouteInfoByHash("category/electronics/product/laptop");
	assert.ok(info, "Info returned for nested route");
	assert.strictEqual(info!.name, "nested", "Route name is nested");
	assert.deepEqual(info!.arguments, { catId: "electronics", prodId: "laptop" }, "Nested arguments correct");
});

// ============================================================
// Module: Navigation parity
// ============================================================
QUnit.module("NativeCompat - Navigation", {
	beforeEach: function () {
		initHashChanger();
		const [routes, config] = createRouterConfig();
		router = new (Router as any)(routes, config) as RouterInstance;
		router.initialize();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	}
});

QUnit.test("navTo triggers routeMatched", function (assert: Assert) {
	const done = assert.async();
	router.attachRouteMatched((event: any) => {
		if (event.getParameter("name") === "page1") {
			assert.ok(true, "routeMatched fired for page1");
			done();
		}
	});
	router.navTo("page1");
});

QUnit.test("navTo with replace triggers routeMatched", function (assert: Assert) {
	const done = assert.async();
	router.attachRouteMatched((event: any) => {
		if (event.getParameter("name") === "page2") {
			assert.ok(true, "routeMatched fired for page2 with replace");
			done();
		}
	});
	router.navTo("page2", {}, {}, true);
});

QUnit.test("navTo with parameters triggers routePatternMatched", function (assert: Assert) {
	const done = assert.async();
	router.getRoute("detail")!.attachPatternMatched((event: any) => {
		assert.strictEqual(event.getParameter("arguments").id, "7", "Parameter extracted");
		done();
	});
	router.navTo("detail", { id: "7" });
});

QUnit.test("Hash change triggers route matching", function (assert: Assert) {
	const done = assert.async();
	router.getRoute("page1")!.attachPatternMatched(() => {
		assert.ok(true, "Hash change triggered route match");
		done();
	});
	HashChanger.getInstance().setHash("page1");
});

QUnit.test("stop() prevents further routing", function (assert: Assert) {
	const done = assert.async();

	// Wait for initialize()'s async routing to settle before stopping
	router.getRoute("home")!.attachPatternMatched(function initHandler() {
		router.getRoute("home")!.detachPatternMatched(initHandler);

		let matched = false;
		router.stop();

		router.attachRouteMatched(() => {
			matched = true;
		});

		HashChanger.getInstance().setHash("page1");

		nextTick(200).then(() => {
			assert.notOk(matched, "No routing after stop()");
			done();
		});
	});
});

QUnit.test("initialize() after stop() resumes routing", function (assert: Assert) {
	const done = assert.async();
	router.stop();
	router.initialize();

	router.getRoute("page1")!.attachPatternMatched(() => {
		assert.ok(true, "Routing resumed after initialize()");
		done();
	});

	router.navTo("page1");
});
