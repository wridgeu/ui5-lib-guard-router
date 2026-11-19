import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardRouter, GuardContext, GuardRedirect, Router$NavigationSettledEvent } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import {
	captureHashWrites,
	flushPromises,
	recordSettlements,
	waitForRoute,
	routerHooks,
	captureWarningsAsync,
	getHash,
	type SinonTestContext,
} from "../../testHelpers";
import type { Router$RouteMatchedEvent } from "sap/ui/core/routing/Router";

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

// ============================================================
// Module: GuardRedirect with componentTargetInfo
// ============================================================
QUnit.module("Router - GuardRedirect with componentTargetInfo", standardHooks);

QUnit.test("GuardRedirect with componentTargetInfo redirects and arrives at target", async function (assert: Assert) {
	router.addRouteGuard("forbidden", (): GuardRedirect => ({
		route: "detail",
		parameters: { id: "cti-1" },
		componentTargetInfo: {},
	}));
	router.initialize();
	router.navTo("forbidden");
	await waitForRoute(router, "detail");
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"detail/cti-1",
		"Redirect with componentTargetInfo landed with correct params",
	);
});

QUnit.test(
	"GuardRedirect forwards non-empty componentTargetInfo to navTo",
	async function (this: SinonTestContext, assert: Assert) {
		const expectedCTI = { detail: { route: "sub", parameters: { subId: "x" } } };
		const navToSpy = this.spy(router, "navTo");

		router.addRouteGuard("forbidden", (): GuardRedirect => ({
			route: "detail",
			parameters: { id: "cti-2" },
			componentTargetInfo: expectedCTI,
		}));
		let targetGuardCalls = 0;
		router.addRouteGuard("detail", () => {
			targetGuardCalls++;
			return true;
		});
		router.initialize();
		const settlements: unknown[] = [];
		router.attachNavigationSettled((event: Router$NavigationSettledEvent) => {
			settlements.push([event.getParameter("status"), event.getParameter("route"), event.getParameter("hash")]);
		});
		const warnings = await captureWarningsAsync(async () => {
			router.navTo("forbidden");
			await waitForRoute(router, "detail");
			// The hash changes after the component targets resolved; let that reach the router.
			await flushPromises();
		});

		const redirectCall = navToSpy.getCalls().find((c) => c.args[0] === "detail");
		assert.ok(redirectCall, "navTo was called with redirect target 'detail'");
		assert.deepEqual(
			redirectCall!.args[2],
			expectedCTI,
			"Non-empty componentTargetInfo forwarded to navTo during redirect",
		);
		assert.deepEqual(
			settlements,
			[[NavigationOutcome.Redirected, "detail", "detail/cti-2"]],
			"the redirect settles once, as Redirected on its target",
		);
		assert.strictEqual(targetGuardCalls, 1, "the target's guard ran once");
		assert.deepEqual(warnings, [], "the redirect is not reported as blocked");
		assert.strictEqual(getHash(), "detail/cti-2");
	},
);

QUnit.test(
	"a redirect to the route that is shown leaves the URL to a settlement handler that navigated on",
	async function (assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");
		router.navTo("detail", { id: "7" });
		await waitForRoute(router, "detail");
		router.addRouteGuard("protected", (): GuardRedirect => ({
			route: "detail",
			parameters: { id: "7" },
			componentTargetInfo: { nested: { route: "list" } },
		}));
		router.attachNavigationSettled((event: Router$NavigationSettledEvent) => {
			if (event.getParameter("status") === NavigationOutcome.Redirected) router.navTo("forbidden");
		});

		router.navTo("protected");
		// With component targets UI5 would write the hash of the redirect target in a later task.
		await flushPromises();
		await flushPromises();

		assert.strictEqual(getHash(), "forbidden", "the URL stays where the handler navigated");
		assert.deepEqual(
			await router.navigationSettled(),
			{ status: NavigationOutcome.Committed, route: "forbidden", hash: "forbidden" },
			"the router is on the handler's route",
		);
	},
);

// ============================================================
// Module: Redirect edge cases
// ============================================================
QUnit.module("Router - Redirect edge cases", standardHooks);

QUnit.test("Global guard redirect short-circuits route-specific guard", async function (assert: Assert) {
	router.addGuard((context: GuardContext) => {
		if (context.toRoute === "protected") return "forbidden";
		return true;
	});
	let routeGuardCalled = false;
	router.addRouteGuard("protected", () => {
		routeGuardCalled = true;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Redirected, "Global guard redirect took effect");
	assert.strictEqual(result.route, "forbidden", "Redirected to forbidden");
	assert.notOk(routeGuardCalled, "Route guard was short-circuited by global guard redirect");
});

// ============================================================
// Module: Redirect guard bypass regression
// ============================================================
QUnit.module("Router - Redirect guard bypass regression", standardHooks);

QUnit.test("navTo from navigationSettled handler during redirect still runs guards", async function (assert: Assert) {
	// A guard on "forbidden" redirects to "home".
	// A navigationSettled handler calls navTo("protected") when it sees the Redirected status.
	// A global guard blocks "protected" (and lets the redirect itself through).
	//
	// Regression guard: _flushSettlement fires the navigationSettled event
	// synchronously. The phase is set to idle before _flushSettlement, so
	// navTo() from the handler enters the full guard pipeline.
	router.addRouteGuard("forbidden", () => "home");
	router.addGuard((ctx: GuardContext) => ctx.toRoute !== "protected");

	router.initialize();
	await waitForRoute(router, "home");

	let nestedNavFired = false;
	const handler = (evt: Router$NavigationSettledEvent): void => {
		if (evt.getParameter("status") === NavigationOutcome.Redirected && !nestedNavFired) {
			nestedNavFired = true;
			// This fires synchronously during _flushSettlement while _phase is idle.
			// The guard should still block this navTo, but the bug bypasses it.
			router.navTo("protected");
		}
	};

	router.attachNavigationSettled(handler);

	router.navTo("forbidden");
	await flushPromises();
	await router.navigationSettled();

	assert.ok(nestedNavFired, "Handler issued the nested navTo('protected')");
	assert.strictEqual(getHash(), "", "Hash stayed on home; guard blocked the nested navTo('protected')");
});

QUnit.test(
	"navTo from a hashSet handler while a navigation commits still runs guards",
	async function (assert: Assert) {
		router.addRouteGuard("protected", () => false);
		router.initialize();
		await waitForRoute(router, "home");
		const matched: string[] = [];
		router.attachRouteMatched((event: Router$RouteMatchedEvent) => {
			matched.push(event.getParameter("name")!);
		});
		const statuses = recordSettlements(router);
		// UI5 fires hashSet within navTo(), before the hash changes: the router is committing "forbidden".
		HashChanger.getInstance().attachEventOnce("hashSet", () => {
			router.navTo("protected");
		});

		router.navTo("forbidden");
		await waitForRoute(router, "forbidden");

		assert.deepEqual(
			statuses,
			[NavigationOutcome.Blocked, NavigationOutcome.Committed],
			"the guard blocked the handler's navigation",
		);
		assert.deepEqual(matched, ["forbidden"], "the guarded route was never displayed");
		assert.strictEqual(getHash(), "forbidden");
	},
);
