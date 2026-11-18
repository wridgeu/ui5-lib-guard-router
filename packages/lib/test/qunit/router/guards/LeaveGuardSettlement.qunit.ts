import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardRouter } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import { waitForRoute, routerHooks } from "../../testHelpers";

let router: GuardRouter;

const standardHooks = routerHooks(
	(created) => {
		router = created;
	},
	() => router,
);

// ============================================================
// Module: Settlement for leave guard scenarios
// ============================================================
QUnit.module("Router - Settlement for leave guard scenarios", standardHooks);

QUnit.test("Leave guard block settlement includes correct route and hash", async function (assert: Assert) {
	router.addLeaveGuard("home", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Status is blocked");
	assert.strictEqual(result.route, "home", "Route stayed on home");
	assert.strictEqual(result.hash, "", "Hash stayed empty");
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Browser hash was restored");
});

QUnit.test("Leave guard allows then enter guard blocks: settlement is blocked", async function (assert: Assert) {
	router.addLeaveGuard("home", () => true);
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Leave allowed + enter blocked = blocked");
	assert.strictEqual(result.route, "home", "Route stayed on home");
});

QUnit.test(
	"Async leave guard allows then async enter guard redirects: settlement is redirected",
	async function (assert: Assert) {
		router.addLeaveGuard("home", async () => true);
		router.addRouteGuard("protected", async () => "forbidden");
		router.initialize();
		await waitForRoute(router, "home");

		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Redirected, "Leave allowed + enter redirect = redirected");
		assert.strictEqual(result.route, "forbidden", "Route is redirect target");
	},
);
