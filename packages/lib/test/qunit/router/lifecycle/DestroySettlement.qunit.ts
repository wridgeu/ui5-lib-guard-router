import type { GuardRouter } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import { captureErrorsAsync, flushPromises, recordHashChanges, waitForRoute, routerHooks } from "../../testHelpers";

let router: GuardRouter;

const standardHooks = routerHooks(
	(created) => {
		router = created;
	},
	() => router,
);

// ============================================================
// Module: Destroy during redirect
// ============================================================
QUnit.module("Router - Destroy during redirect", standardHooks);

QUnit.test(
	"destroy() while a guard is pending settles as Cancelled, and the guard's late redirect does nothing",
	async function (assert: Assert) {
		const redirectGuard = Promise.withResolvers<string>();
		router.addRouteGuard("protected", () => redirectGuard.promise);
		router.initialize();
		await waitForRoute(router, "home");

		router.navTo("protected");
		const settledPromise = router.navigationSettled();
		router.destroy();

		assert.deepEqual(
			await settledPromise,
			{ status: NavigationOutcome.Cancelled, route: "home", hash: "" },
			"the pending navigation is cancelled",
		);

		const recorder = recordHashChanges();
		const errors = await captureErrorsAsync(async () => {
			redirectGuard.resolve("forbidden");
			await flushPromises();
		});
		recorder.stop();
		assert.deepEqual(errors, [], "the late redirect logs no error");
		assert.deepEqual(recorder.hashes, [], "and does not change the hash");
	},
);

// ============================================================
// Module: navigationSettled after destroy
// ============================================================
QUnit.module("Router - navigationSettled after destroy", standardHooks);

QUnit.test("navigationSettled called after destroy resolves immediately", async function (assert: Assert) {
	router.addRouteGuard("protected", () => true);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await router.navigationSettled();
	router.destroy();

	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "Returns default Committed status");
	assert.strictEqual(result.route, "protected", "Route reflects last committed navigation");
	assert.strictEqual(result.hash, "protected", "Hash reflects last committed navigation");
});
