import Router from "ui5/ext/routing/Router";
import MobileRouter from "sap/m/routing/Router";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type { RouterInstance } from "ui5/ext/routing/types";
import { initHashChanger } from "./testHelpers";

/**
 * Verify that ui5.ext.routing.Router is a true drop-in replacement
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
let extRouter: RouterInstance;
let nativeRouter: MobileRouter;

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
	},
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
