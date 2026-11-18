import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardRouter } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import { captureHashWrites, flushPromises, recordSettlements, waitForRoute, routerHooks } from "../../testHelpers";

let router: GuardRouter;

const standardHooks = routerHooks(
	(created) => {
		router = created;
	},
	() => router,
);

// ============================================================
// Module: Redirect to the route that is shown
// ============================================================
QUnit.module("Router - Redirect to the route that is shown", standardHooks);

QUnit.test(
	"a navTo() that is redirected to the route that is shown matches no route again",
	async function (assert: Assert) {
		router.addRouteGuard("forbidden", () => "protected");
		router.initialize();
		router.navTo("protected");
		await waitForRoute(router, "protected");
		const matched: string[] = [];
		router.attachRouteMatched((event) => matched.push(String(event.getParameter("name"))));
		const statuses = recordSettlements(router);

		const writes = await captureHashWrites(HashChanger.getInstance(), () => {
			router.navTo("forbidden");
		});

		assert.deepEqual(
			await router.navigationSettled(),
			{ status: NavigationOutcome.Redirected, route: "protected", hash: "protected" },
			"the navigation settles as Redirected on the route that is shown",
		);
		assert.deepEqual(statuses, [NavigationOutcome.Redirected], "once");
		assert.deepEqual(matched, [], "no route matched again");
		assert.deepEqual(writes, [], "no hash was written");

		router.parse("protected");
		await flushPromises();
		assert.deepEqual(matched, ["protected"], "a hash that is parsed again still matches its route again");
	},
);

QUnit.test(
	"an async redirect chain that ends on the route that is shown matches no route again",
	async function (assert: Assert) {
		router.addRouteGuard("forbidden", async () => ({ route: "detail", parameters: { id: "1" } }));
		router.addRouteGuard("detail", async () => "home");
		router.initialize();
		await waitForRoute(router, "home");
		const matched: string[] = [];
		router.attachRouteMatched((event) => matched.push(String(event.getParameter("name"))));

		router.navTo("forbidden");

		assert.deepEqual(await router.navigationSettled(), {
			status: NavigationOutcome.Redirected,
			route: "home",
			hash: "",
		});
		await flushPromises();
		assert.deepEqual(matched, [], "no route matched again");
		router.navTo("protected");
		await waitForRoute(router, "protected");
		assert.deepEqual(matched, ["protected"], "the next navigation runs as usual");
	},
);
