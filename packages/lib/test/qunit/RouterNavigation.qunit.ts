import HashChanger from "sap/ui/core/routing/HashChanger";
import type {
	GuardContext,
	GuardFn,
	GuardRedirect,
	GuardRouter,
	Router$NavigationSettledEvent,
} from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { Router$RouteMatchedEvent } from "sap/ui/core/routing/Router";
import {
	assertBlocked,
	callUnsafe,
	captureErrorsAsync,
	captureHashWrites,
	captureWarnings,
	captureWarningsAsync,
	createRouter,
	createRouterUnsafe,
	getHash,
	flushPromises,
	initHashChanger,
	recordHashChanges,
	recordSettlements,
	type SinonTestContext,
	waitForRoute,
} from "./testHelpers";

let router: GuardRouter;

const standardHooks = {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
};

// ============================================================
// Module: Hash change simulation (direct URL entry)
// ============================================================
QUnit.module("Router - Hash change (direct URL entry)", standardHooks);

QUnit.test("Direct hash change to guarded route is blocked", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await assertBlocked(
		assert,
		router,
		() => HashChanger.getInstance().setHash("protected"),
		"Direct hash change was blocked by guard",
	);
});

QUnit.test("Direct hash change to unguarded route proceeds", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	// Navigate to forbidden (unguarded) so we're away from home
	router.navTo("forbidden");
	await waitForRoute(router, "forbidden");

	// Direct hash change to home (unguarded) should proceed
	HashChanger.getInstance().setHash("");
	await waitForRoute(router, "home");
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Unguarded route matched via hash change");
});

QUnit.test("Direct hash change with redirect restores correct hash", async function (assert: Assert) {
	router.addRouteGuard("forbidden", () => "home");
	router.initialize();
	await waitForRoute(router, "home");

	const matched: string[] = [];
	router.attachRouteMatched((event) => matched.push(String(event.getParameter("name"))));
	HashChanger.getInstance().setHash("forbidden");
	assert.deepEqual(
		await router.navigationSettled(),
		{ status: NavigationOutcome.Redirected, route: "home", hash: "" },
		"the redirect to the route that is shown settles as Redirected",
	);
	await flushPromises();

	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Hash was restored to home route");
	assert.deepEqual(matched, [], "the route that is shown does not match again");
});

QUnit.test("Direct hash change to a guard that throws restores the hash", async function (assert: Assert) {
	router.addRouteGuard("protected", () => {
		throw new Error("guard failed");
	});
	router.initialize();
	await waitForRoute(router, "home");

	await captureErrorsAsync(async () => {
		HashChanger.getInstance().setHash("protected");
		assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Error);
	});
	assert.strictEqual(getHash(), "", "hash restored to the previous route");
});

QUnit.test("Direct hash change redirect replaces the history entry", async function (assert: Assert) {
	router.addRouteGuard("forbidden", () => "protected");
	router.initialize();
	await waitForRoute(router, "home");

	const hashChanger = HashChanger.getInstance();
	const writes = await captureHashWrites(hashChanger, async () => {
		hashChanger.setHash("forbidden");
		assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Redirected);
	});

	assert.deepEqual(
		writes,
		["set:forbidden", "replace:protected"],
		"the redirect replaces the entry that the user's hash change created, and adds none",
	);
	assert.strictEqual(getHash(), "protected");
});

QUnit.test(
	"Direct hash change whose async redirect fails settles as Error and restores the hash",
	async function (assert: Assert) {
		// "detail" needs an id, so the redirect itself throws.
		router.addRouteGuard("protected", () => Promise.resolve("detail"));
		router.initialize();
		await waitForRoute(router, "home");

		const errors = await captureErrorsAsync(async () => {
			HashChanger.getInstance().setHash("protected");
			const result = await router.navigationSettled();
			assert.strictEqual(result.status, NavigationOutcome.Error);
			assert.ok(result.error instanceof Error, "the redirect's error is on the result");
		});
		assert.ok(
			errors.some((e) => e.message === 'Guard redirect target "detail" has no valid hash, navigation failed'),
			"failure is logged with the redirect target",
		);
		assert.strictEqual(getHash(), "", "hash restored to the previous route");
	},
);

QUnit.test("Blocked hash change restores the hash of the route the user is on", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");
	router.navTo("forbidden");
	await waitForRoute(router, "forbidden");

	let homeMatched = false;
	router.getRoute("home")!.attachPatternMatched(() => {
		homeMatched = true;
	});

	HashChanger.getInstance().setHash("protected");
	const result = await router.navigationSettled();

	assert.deepEqual(
		{ status: result.status, route: result.route, hash: result.hash },
		{ status: NavigationOutcome.Blocked, route: "forbidden", hash: "forbidden" },
	);
	assert.strictEqual(getHash(), "forbidden", "hash restored to the current route, not to the default route");

	// A navigation to the default route would have matched before this one does.
	router.navTo("detail", { id: "1" });
	await waitForRoute(router, "detail");
	assert.notOk(homeMatched, "the restore did not navigate to the default route");
});

QUnit.test("A blocked default route is evaluated again when its hash is parsed again", async function (assert: Assert) {
	let allowHome = false;
	router.addRouteGuard("home", () => allowHome);
	router.initialize();
	assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Blocked);

	allowHome = true;
	// UI5 delivers an unchanged hash again, e.g. after RouterHashChanger.resetHash().
	callUnsafe(router, "parse", "");
	const result = await router.navigationSettled();

	assert.deepEqual(
		{ status: result.status, route: result.route },
		{ status: NavigationOutcome.Committed, route: "home" },
		"the restore of the blocked attempt left no suppression behind",
	);
});

// ============================================================
// Module: navTo superseding a pending hash change
// ============================================================
QUnit.module("Router - navTo superseding a pending hash change", standardHooks);

/**
 * Change the hash to "forbidden", whose guard never settles by default, then run `supersede`
 * while that navigation is pending. Resolves with the status of every settlement since the hash change.
 */
async function supersedePendingHashChange(
	supersede: () => void,
	forbiddenGuard: GuardFn = () => new Promise<boolean>(() => {}),
): Promise<string[]> {
	router.addRouteGuard("forbidden", forbiddenGuard);
	router.initialize();
	await waitForRoute(router, "home");
	const statuses = recordSettlements(router);
	HashChanger.getInstance().setHash("forbidden");
	supersede();
	await flushPromises();
	return statuses;
}

QUnit.test("a blocked navTo restores the hash", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	const statuses = await supersedePendingHashChange(() => router.navTo("protected"));

	assert.deepEqual(statuses, [NavigationOutcome.Cancelled, NavigationOutcome.Blocked]);
	assert.strictEqual(getHash(), "", "the URL is back on the route the router stays on");
});

QUnit.test("a navTo whose guard throws restores the hash", async function (assert: Assert) {
	router.addRouteGuard("protected", () => {
		throw new Error("guard failed");
	});
	await captureErrorsAsync(async () => {
		const statuses = await supersedePendingHashChange(() => router.navTo("protected"));
		assert.deepEqual(statuses, [NavigationOutcome.Cancelled, NavigationOutcome.Error]);
	});
	assert.strictEqual(getHash(), "");
});

QUnit.test("a navTo whose async redirect fails restores the hash", async function (assert: Assert) {
	// "detail" needs an id, so the redirect itself throws.
	router.addRouteGuard("protected", async () => "detail");
	await captureErrorsAsync(async () => {
		const statuses = await supersedePendingHashChange(() => router.navTo("protected"));
		assert.deepEqual(statuses, [NavigationOutcome.Cancelled, NavigationOutcome.Error]);
	});
	assert.strictEqual(getHash(), "");
});

QUnit.test("a navTo whose redirect target blocks restores the hash", async function (assert: Assert) {
	router.addRouteGuard("protected", () => ({ route: "detail", parameters: { id: "1" } }));
	router.addRouteGuard("detail", () => false);
	const statuses = await supersedePendingHashChange(() => router.navTo("protected"));

	assert.deepEqual(statuses, [NavigationOutcome.Cancelled, NavigationOutcome.Blocked]);
	assert.strictEqual(getHash(), "");
});

QUnit.test(
	"a blocked navTo restores the hash after another navTo superseded the hash change",
	async function (assert: Assert) {
		router.addRouteGuard("protected", () => new Promise<boolean>(() => {}));
		router.addRouteGuard("detail", () => false);
		const statuses = await supersedePendingHashChange(() => {
			router.navTo("protected");
			router.navTo("detail", { id: "1" });
		});

		assert.deepEqual(statuses, [
			NavigationOutcome.Cancelled,
			NavigationOutcome.Cancelled,
			NavigationOutcome.Blocked,
		]);
		assert.strictEqual(getHash(), "");
	},
);

QUnit.test("navTo to the current route restores the hash", async function (assert: Assert) {
	const statuses = await supersedePendingHashChange(() => router.navTo("home"));

	assert.deepEqual(statuses, [NavigationOutcome.Cancelled]);
	assert.strictEqual(getHash(), "");
});

QUnit.test("navTo to an unknown route restores the hash", async function (assert: Assert) {
	let statuses: string[] = [];
	await captureWarningsAsync(async () => {
		statuses = await supersedePendingHashChange(() => router.navTo("nonexistent"));
	});

	assert.deepEqual(statuses, [NavigationOutcome.Cancelled]);
	assert.strictEqual(getHash(), "");
});

QUnit.test(
	"an allowed navTo moves on from the superseded hash without restoring it",
	async function (this: SinonTestContext, assert: Assert) {
		const replaceHash = this.spy(HashChanger.getInstance(), "replaceHash");
		const statuses = await supersedePendingHashChange(() => router.navTo("protected"));
		assert.deepEqual(statuses, [NavigationOutcome.Cancelled, NavigationOutcome.Committed]);
		assert.strictEqual(
			replaceHash.callCount,
			0,
			"the superseded entry stays in the history, as with the base router",
		);
		assert.strictEqual(getHash(), "protected");
	},
);

QUnit.test("a redirect to the superseded hash commits it", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	// Pending for the hash change, allowed when the redirect evaluates the route again.
	let forbiddenGuardCalls = 0;
	const forbiddenGuard: GuardFn = () => (++forbiddenGuardCalls === 1 ? new Promise<boolean>(() => {}) : true);
	let statuses: string[] = [];
	const warnings = await captureWarningsAsync(async () => {
		statuses = await supersedePendingHashChange(() => router.navTo("protected"), forbiddenGuard);
	});
	const result = await router.navigationSettled();

	assert.deepEqual(statuses, [NavigationOutcome.Cancelled, NavigationOutcome.Redirected]);
	assert.deepEqual(
		{ route: result.route, hash: result.hash },
		{ route: "forbidden", hash: "forbidden" },
		"the router is on the route the URL already shows",
	);
	assert.deepEqual(warnings, [], "the redirect is not reported as blocked");
	assert.strictEqual(getHash(), "forbidden");
});

QUnit.test(
	"a blocked hash change back to the URL from before restores the committed hash when the URL showed another",
	async function (assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");
		const hashChanger = HashChanger.getInstance();
		hashChanger.setHash("protected");
		await waitForRoute(router, "protected");
		// A parse() call commits a hash that the URL does not show.
		router.parse("forbidden");
		await waitForRoute(router, "forbidden");
		// Pending for the first hash change, blocks the second.
		let leaveGuardCalls = 0;
		router.addLeaveGuard("forbidden", () => (++leaveGuardCalls === 1 ? new Promise<boolean>(() => {}) : false));
		const statuses = recordSettlements(router);

		hashChanger.setHash("detail/1");
		hashChanger.setHash("protected");

		assert.deepEqual(statuses, [NavigationOutcome.Cancelled, NavigationOutcome.Blocked]);
		assert.strictEqual(getHash(), "forbidden", "the URL shows the hash of the route that is displayed");
	},
);

// ============================================================
// Module: Sequential navigation with dynamic guard state
// ============================================================
QUnit.module("Router - Sequential navigation with changing guards", standardHooks);

QUnit.test("Guard state change between navigations is respected", async function (assert: Assert) {
	let allowNavigation = false;
	router.addRouteGuard("protected", () => (allowNavigation ? true : "home"));
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	assert.deepEqual(
		await router.navigationSettled(),
		{ status: NavigationOutcome.Redirected, route: "home", hash: "" },
		"First attempt redirected to home",
	);

	allowNavigation = true;
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(HashChanger.getInstance().getHash(), "protected", "Second attempt allowed after state change");
});

QUnit.test("Adding guard mid-session blocks subsequent navigations", async function (assert: Assert) {
	router.initialize();

	// First nav: no guards, should work
	router.navTo("protected");
	await waitForRoute(router, "protected");

	// Now add a guard
	router.addRouteGuard("protected", () => false);

	// Navigate away and back
	router.navTo("home");
	await waitForRoute(router, "home");
	await assertBlocked(assert, router, () => router.navTo("protected"), "Guard added mid-session blocked navigation");
});

QUnit.test("Removing guard mid-session allows subsequent navigations", async function (assert: Assert) {
	const guard: GuardFn = () => false;
	router.addRouteGuard("protected", guard);
	router.initialize();

	router.navTo("protected");
	assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Blocked, "First attempt: blocked");

	// Remove the guard
	router.removeRouteGuard("protected", guard);

	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(HashChanger.getInstance().getHash(), "protected", "Navigation allowed after guard removed");
});

// ============================================================
// Module: Guard re-entrancy (guard triggers navigation)
// ============================================================
QUnit.module("Router - Guard re-entrancy", standardHooks);

QUnit.test("Guard that returns redirect does not cause infinite loop", async function (assert: Assert) {
	let guardCallCount = 0;
	router.addRouteGuard("forbidden", () => {
		guardCallCount++;
		return "home";
	});
	router.initialize();

	router.navTo("forbidden");
	await router.navigationSettled();
	assert.strictEqual(guardCallCount, 1, "Guard only called once (no infinite loop)");
});

QUnit.test("Multiple route guards with cross-redirects settle correctly", async function (assert: Assert) {
	// forbidden -> redirects to protected -> redirects to home
	// The redirect chain evaluates guards on each hop.
	router.addRouteGuard("forbidden", () => "protected");
	router.addRouteGuard("protected", () => "home");
	router.initialize();

	router.navTo("forbidden");
	await waitForRoute(router, "home");
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Cross-redirect chain followed to home");
});

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
// Module: Nested navigation from routeMatched handler
// ============================================================
QUnit.module("Router - Nested navigation from routeMatched handler", standardHooks);

QUnit.test("navTo from routeMatched handler runs leave guards for the NEW route", async function (assert: Assert) {
	// Scenario: home → protected (routeMatched fires, handler calls navTo("forbidden"))
	// The leave guard on "protected" should run, NOT the leave guard on "home" a second time
	let homeLeaveGuardCallCount = 0;
	let protectedLeaveGuardCallCount = 0;

	router.addLeaveGuard("home", () => {
		homeLeaveGuardCallCount++;
		return true;
	});
	router.addLeaveGuard("protected", () => {
		protectedLeaveGuardCallCount++;
		return true;
	});

	router.initialize();
	await waitForRoute(router, "home");

	// Reset counts after initial navigation
	homeLeaveGuardCallCount = 0;
	protectedLeaveGuardCallCount = 0;

	// Navigate to protected, then immediately navigate to forbidden from the handler
	router.getRoute("protected")!.attachPatternMatched(function handler() {
		router.getRoute("protected")!.detachPatternMatched(handler);
		// This navTo happens inside the routeMatched event for "protected"
		// Leave guards for "protected" should run (we're leaving protected to go to forbidden)
		router.navTo("forbidden");
	});

	router.navTo("protected");
	await waitForRoute(router, "forbidden");

	// The home leave guard should have run ONCE (when leaving home to go to protected)
	assert.strictEqual(homeLeaveGuardCallCount, 1, "Home leave guard ran exactly once (home → protected)");
	// The protected leave guard should run ONCE (when leaving protected to go to forbidden)
	assert.strictEqual(
		protectedLeaveGuardCallCount,
		1,
		"Protected leave guard ran exactly once (protected → forbidden from routeMatched handler)",
	);
});

QUnit.test("an async navTo started while a route is matched can still be cancelled", async function (assert: Assert) {
	router.addRouteGuard("detail", () => Promise.resolve(true));
	router.initialize();
	await waitForRoute(router, "home");

	// beforeRouteMatched fires while the hash change is matched; patternMatched waits for the views.
	let started = false;
	router.attachBeforeRouteMatched(() => {
		if (started) return;
		started = true;
		router.navTo("detail", { id: "1" });
	});
	const statuses = recordSettlements(router);

	router.navTo("protected");
	router.navTo("forbidden");

	assert.deepEqual(
		statuses,
		[NavigationOutcome.Committed, NavigationOutcome.Cancelled, NavigationOutcome.Committed],
		"the pending navigation started by the handler is cancelled by the next navTo",
	);
	assert.strictEqual(getHash(), "forbidden");
});

QUnit.test("an allowed navTo matches its route while the hash change is dispatched", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	let matched = false;
	router.attachBeforeRouteMatched(() => {
		matched = true;
	});
	const matchedDuringHashChange: boolean[] = [];
	const listener = (): void => {
		matchedDuringHashChange.push(matched);
	};
	const hashChanger = HashChanger.getInstance();
	hashChanger.attachEvent("hashChanged", listener);
	try {
		router.navTo("protected");
	} finally {
		hashChanger.detachEvent("hashChanged", listener);
	}

	assert.deepEqual(matchedDuringHashChange, [true], "like the native router, later listeners see the matched route");
});

// ============================================================
// Module: navTo preflight
// ============================================================
QUnit.module("Router - navTo preflight", standardHooks);

QUnit.test("blocked programmatic navTo does not change the hash", function (assert) {
	router.addGuard(() => false);
	router.initialize();

	const recorder = recordHashChanges();
	router.navTo("protected");
	recorder.stop();

	assert.deepEqual(recorder.hashes, [], "Hash was never set by the blocked navTo");
});

QUnit.test("a blocked navTo() leaves a hash alone that the router did not parse", async function (assert) {
	HashChanger.getInstance().setHash("forbidden");
	router.addRouteGuard("protected", () => false);
	router.initialize(true);
	const recorder = recordHashChanges();

	router.navTo("protected");
	const result = await router.navigationSettled();
	await flushPromises();
	recorder.stop();

	assert.strictEqual(result.status, NavigationOutcome.Blocked);
	assert.deepEqual(recorder.hashes, [], "the navigation never moved the hash, so there is nothing to restore");
	assert.strictEqual(getHash(), "forbidden");
});

QUnit.test("parse() of the committed hash does not cancel a pending navTo()", async function (assert) {
	let allow!: (allowed: boolean) => void;
	router.addRouteGuard(
		"protected",
		() =>
			new Promise<boolean>((resolve) => {
				allow = resolve;
			}),
	);
	router.initialize();
	await waitForRoute(router, "home");
	const statuses = recordSettlements(router);

	router.navTo("protected");
	router.parse("");
	allow(true);
	await flushPromises();

	assert.deepEqual(statuses, [NavigationOutcome.Committed], "the navigation that had not moved the hash goes on");
	assert.strictEqual(getHash(), "protected");
});

QUnit.test("blocked programmatic navTo settles as Blocked", async function (assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Settlement is Blocked");
	assert.strictEqual(result.route, "home", "Route stays on home");
});

QUnit.test("redirected programmatic navTo does not create intermediate hash", function (assert) {
	router.addRouteGuard("protected", () => "home");
	router.initialize();

	const recorder = recordHashChanges();
	router.navTo("protected");
	recorder.stop();

	assert.deepEqual(recorder.hashes, [], "Hash did not visit intermediate protected route");
});

QUnit.test("redirected programmatic navTo settles as Redirected", async function (assert) {
	router.addRouteGuard("protected", () => "home");
	router.initialize();

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Redirected, "Settlement is Redirected");
	assert.strictEqual(result.route, "home", "Route is home after redirect");
});

QUnit.test("allowed programmatic navTo is not double-guarded in parse", async function (assert) {
	let guardCallCount = 0;
	router.addGuard(() => {
		guardCallCount++;
		return true;
	});
	router.initialize();
	guardCallCount = 0; // reset after initialize fires parse

	router.navTo("protected");
	await router.navigationSettled();

	assert.strictEqual(guardCallCount, 1, "Guard ran exactly once, not in both navTo and parse");
});

QUnit.test("async blocked programmatic navTo does not change the hash", async function (assert) {
	router.addGuard(() => Promise.resolve(false));
	router.initialize();

	const recorder = recordHashChanges();
	router.navTo("protected");
	await router.navigationSettled();
	recorder.stop();

	assert.deepEqual(recorder.hashes, [], "Hash was never set by the async blocked navTo");
});

QUnit.test("async redirected programmatic navTo settles as Redirected", async function (assert) {
	router.addRouteGuard("protected", () => Promise.resolve("home"));
	router.initialize();

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Redirected, "Settlement is Redirected");
	assert.strictEqual(result.route, "home", "Route is home after async redirect");
});

QUnit.test("navTo with replace=true works through preflight with guards", async function (assert) {
	let guardCallCount = 0;
	router.addGuard(() => {
		guardCallCount++;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");
	guardCallCount = 0;

	// Navigate to protected first (creates history entry)
	router.navTo("protected");
	await router.navigationSettled();
	assert.strictEqual(getHash(), "protected", "Navigated to protected");
	assert.strictEqual(guardCallCount, 1, "Guard ran for first navigation");

	// Navigate with replace=true (3-arg overload)
	router.navTo("forbidden", {}, true);
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "Navigation committed");
	assert.strictEqual(getHash(), "forbidden", "Hash updated to forbidden");
	assert.strictEqual(guardCallCount, 2, "Guard ran for replace navigation");
});

QUnit.test("navTo with replace=true works through preflight (4-arg overload)", async function (assert) {
	router.addGuard(() => true);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await router.navigationSettled();

	// Navigate with replace=true (4-arg overload)
	router.navTo("forbidden", {}, {}, true);
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "Navigation committed");
	assert.strictEqual(getHash(), "forbidden", "Hash updated to forbidden");
});

QUnit.test("A redirected navTo() writes its target the way the call asked for", async function (assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("detail", (context) =>
		context.toArguments.id === "1" ? { route: "detail", parameters: { id: "7" } } : true,
	);
	router.initialize();
	await waitForRoute(router, "home");

	const writes = await captureHashWrites(HashChanger.getInstance(), async () => {
		router.navTo("protected");
		await router.navigationSettled();
		router.navTo("detail", { id: "1" });
		await router.navigationSettled();
		router.navTo("home");
		await router.navigationSettled();
		router.navTo("protected", {}, true);
		await router.navigationSettled();
		router.navTo("detail", { id: "1" }, undefined, true);
		await router.navigationSettled();
	});

	assert.deepEqual(
		writes,
		["set:forbidden", "set:detail/7", "set:", "replace:forbidden", "replace:detail/7"],
		"string and object redirect targets add a history entry, so that Back returns to the origin, unless the call replaces",
	);
});

QUnit.test(
	"A redirect chain after navTo() writes only its final target, as one history entry",
	async function (assert) {
		router.addRouteGuard("protected", () => "forbidden");
		router.addRouteGuard("forbidden", async () => ({ route: "detail", parameters: { id: "7" } }));
		router.initialize();
		await waitForRoute(router, "home");

		const writes = await captureHashWrites(HashChanger.getInstance(), async () => {
			router.navTo("protected");
			await router.navigationSettled();
		});

		assert.deepEqual(writes, ["set:detail/7"], "the hops in between never reach the URL");
	},
);

QUnit.test("navTo returns this for chaining", function (assert) {
	router.initialize();
	const result = router.navTo("home");
	assert.strictEqual(result, router, "navTo returns this");
});

QUnit.test("navTo to unknown route cancels pending async guard pipeline", async function (assert) {
	let resolveGuard!: (value: boolean) => void;
	router.addGuard(
		() =>
			new Promise<boolean>((r) => {
				resolveGuard = r;
			}),
	);
	router.initialize();

	// Start an async preflight to a guarded route.
	router.navTo("protected");
	const settled = router.navigationSettled();

	// While the async guard is pending, navTo to an unknown route.
	// This must cancel the pending navigation so settlement resolvers drain.
	router.navTo("nonexistent");

	// Resolve the now-stale guard to prove it is discarded.
	resolveGuard(true);

	const result = await settled;
	assert.strictEqual(
		result.status,
		NavigationOutcome.Cancelled,
		"Pending navigation cancelled when unknown-route navTo supersedes it",
	);
});

QUnit.test("navTo to unknown route then real route works after cancellation", async function (assert) {
	let resolveGuard!: (value: boolean) => void;
	router.addGuard((context) => {
		if (context.toRoute === "forbidden") {
			return true;
		}
		return new Promise<boolean>((r) => {
			resolveGuard = r;
		});
	});
	router.initialize();

	// Start async preflight.
	router.navTo("protected");
	const firstSettled = router.navigationSettled();

	// Unknown route supersedes.
	router.navTo("nonexistent");
	resolveGuard(true);

	const cancelResult = await firstSettled;
	assert.strictEqual(cancelResult.status, NavigationOutcome.Cancelled, "First navigation cancelled");

	// Subsequent navTo to a real route must work normally.
	router.navTo("forbidden");
	const secondResult = await router.navigationSettled();
	assert.strictEqual(secondResult.status, NavigationOutcome.Committed, "Subsequent navigation commits");
	assert.strictEqual(secondResult.route, "forbidden", "Landed on forbidden");
});

QUnit.test("async preflight superseded by second navTo cancels first", async function (assert) {
	let resolveGuard!: (value: boolean) => void;
	router.addGuard(
		() =>
			new Promise<boolean>((r) => {
				resolveGuard = r;
			}),
	);
	router.initialize();

	router.navTo("protected"); // starts async preflight
	const settled = router.navigationSettled();
	router.navTo("forbidden"); // supersedes first

	resolveGuard(true); // resolves the second guard (shared variable was overwritten by navTo("forbidden"))

	const result = await settled;
	assert.strictEqual(result.status, NavigationOutcome.Cancelled, "First navigation cancelled");
});

QUnit.test("duplicate navTo to same pending hash is a no-op", async function (assert) {
	let guardCallCount = 0;
	router.addGuard(async () => {
		guardCallCount++;
		return true;
	});
	router.initialize();
	guardCallCount = 0;

	router.navTo("protected");
	router.navTo("protected"); // same hash, should be deduped
	await router.navigationSettled();

	assert.strictEqual(guardCallCount, 1, "Guard ran only once despite duplicate navTo");
});

// Preflight: the hash never changed, so nothing is restored. For the parse path, where the hash
// has changed and is restored, see "Router - Hash change (direct URL entry)".

QUnit.test("blocked via navTo leaves hash unchanged", async function (this: SinonTestContext, assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	const recorder = recordHashChanges();
	const replaceHash = this.spy(HashChanger.getInstance(), "replaceHash");
	router.navTo("protected");
	await router.navigationSettled();
	recorder.stop();

	assert.strictEqual(replaceHash.callCount, 0, "a blocked navTo does not rewrite the history entry");
	assert.deepEqual(recorder.hashes, [], "Hash unchanged - preflight never changed it");
});

QUnit.test("rejected async guard via navTo leaves hash unchanged", async function (assert) {
	router.addRouteGuard("protected", () => Promise.reject(new Error("guard error")));
	router.initialize();
	await waitForRoute(router, "home");

	const recorder = recordHashChanges();
	router.navTo("protected");
	const result = await router.navigationSettled();
	recorder.stop();
	assert.strictEqual(result.status, NavigationOutcome.Error, "Rejected guard settles as Error");
	assert.deepEqual(recorder.hashes, [], "Hash unchanged after rejected async preflight guard");
});

QUnit.test(
	"external hash change to same pending hash during async preflight restores hash on block",
	async function (assert) {
		let resolveGuard!: (value: boolean) => void;
		router.addRouteGuard(
			"protected",
			() =>
				new Promise<boolean>((r) => {
					resolveGuard = r;
				}),
		);
		router.initialize();
		await waitForRoute(router, "home");

		const hashBefore = getHash();
		router.navTo("protected"); // async preflight, hash unchanged

		// Simulate external navigation to the same hash (URL bar, bookmark, etc.)
		// while the async preflight is still pending. parse() must not silently
		// drop this; it should cancel the preflight and take over.
		HashChanger.getInstance().setHash("protected");

		// Now block the guard.
		resolveGuard(false);
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Blocked, "Navigation blocked");
		assert.strictEqual(getHash(), hashBefore, "Hash restored after block - browser URL matches router state");
	},
);

QUnit.test("setHash during async preflight supersedes the preflight", async function (assert) {
	router.addRouteGuard("protected", async () => true);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const settledPromise = router.navigationSettled();

	// Browser back / direct hash change while async preflight is pending.
	// parse() bumps the generation counter, cancelling the preflight.
	HashChanger.getInstance().setHash("forbidden");

	const result = await settledPromise;
	assert.strictEqual(result.status, NavigationOutcome.Cancelled, "Preflight cancelled by parse");

	// The parse-driven navigation should proceed normally.
	await waitForRoute(router, "forbidden");
	assert.strictEqual(getHash(), "forbidden", "parse-driven navigation committed");
});

QUnit.test("redirect to nonexistent via setHash restores the hash", async function (assert) {
	router.addRouteGuard("protected", () => "nonExistentRoute");
	router.initialize();
	await waitForRoute(router, "home");

	HashChanger.getInstance().setHash("protected");
	await router.navigationSettled();
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Hash was restored after block");
});

QUnit.test("redirect to nonexistent via navTo leaves hash unchanged", async function (assert) {
	router.addRouteGuard("protected", () => "nonExistentRoute");
	router.initialize();
	await waitForRoute(router, "home");

	const recorder = recordHashChanges();
	router.navTo("protected");
	await router.navigationSettled();
	recorder.stop();
	assert.deepEqual(recorder.hashes, [], "Hash unchanged - preflight never changed it");
});

QUnit.test("async redirect to nonexistent via navTo leaves hash unchanged", async function (assert) {
	router.addRouteGuard("protected", () => Promise.resolve("nonExistentRoute"));
	router.initialize();
	await waitForRoute(router, "home");

	const recorder = recordHashChanges();
	router.navTo("protected");
	await router.navigationSettled();
	recorder.stop();
	assert.deepEqual(recorder.hashes, [], "Hash unchanged - preflight never changed it");
});

QUnit.test("navTo to unknown route logs the base router's warning", function (assert: Assert) {
	router.initialize();

	const warnings = captureWarnings(() => router.navTo("nonexistent"));

	assert.ok(
		warnings.some((w) => /Route with name "?nonexistent"? does not exist/.test(w.message)),
		"unknown route is reported like sap.m.routing.Router does",
	);
});

QUnit.test(
	"preflight that blocks or fails never writes to the HashChanger",
	async function (this: SinonTestContext, assert: Assert) {
		router.addRouteGuard("protected", () => false);
		router.addRouteGuard("forbidden", () => {
			throw new Error("sync guard error");
		});
		router.addRouteGuard("detail", (context) => {
			if (context.toArguments.id === "reject") return Promise.reject(new Error("async guard error"));
			// "detail" needs an id, so this redirect itself throws.
			if (context.toArguments.id === "bad-redirect") return Promise.resolve("detail");
			return "protected"; // redirect into a blocking guard
		});
		router.initialize();
		await waitForRoute(router, "home");

		const hashChanger = HashChanger.getInstance();
		const setHash = this.spy(hashChanger, "setHash");
		const replaceHash = this.spy(hashChanger, "replaceHash");
		const statuses: string[] = [];
		const restores: number[] = [];
		const errors = await captureErrorsAsync(async () => {
			for (const navigate of [
				() => router.navTo("protected"),
				() => router.navTo("forbidden"),
				() => router.navTo("detail", { id: "reject" }),
				() => router.navTo("detail", { id: "bad-redirect" }),
				() => router.navTo("detail", { id: "blocked-redirect" }),
			]) {
				navigate();
				statuses.push((await router.navigationSettled()).status);
				restores.push(replaceHash.callCount);
			}
		});

		assert.deepEqual(statuses, [
			NavigationOutcome.Blocked,
			NavigationOutcome.Error,
			NavigationOutcome.Error,
			NavigationOutcome.Error,
			NavigationOutcome.Blocked,
		]);
		assert.ok(
			errors.some((e) => e.message === 'Guard redirect target "detail" has no valid hash, navigation failed'),
			"failed redirect is logged with the redirect target",
		);
		assert.strictEqual(setHash.callCount, 0, "no history entry added");
		assert.deepEqual(restores, [0, 0, 0, 0, 0], "no hash restore after any of them: the hash never changed");
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

// ============================================================
// Module: Guards on redirect targets
// ============================================================
QUnit.module("Router - Guards on redirect targets", standardHooks);

QUnit.test("Guard on redirect target is evaluated", async function (assert: Assert) {
	const called: string[] = [];
	router.addRouteGuard("protected", () => {
		called.push("protected");
		return "forbidden";
	});
	router.addRouteGuard("forbidden", () => {
		called.push("forbidden");
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "forbidden");
	assert.deepEqual(called, ["protected", "forbidden"], "Both guards ran");
	assert.deepEqual(
		await router.navigationSettled(),
		{ status: NavigationOutcome.Redirected, route: "forbidden", hash: "forbidden" },
		"Settled as Redirected on the redirect target",
	);
	assert.strictEqual(getHash(), "forbidden", "Landed on redirect target");
});

QUnit.test("Guard on redirect target blocks entire chain", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	const recorder = recordHashChanges();
	router.navTo("protected");
	const result = await router.navigationSettled();
	recorder.stop();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Chain blocked");
	assert.deepEqual(recorder.hashes, [], "Hash unchanged (preflight)");
});

QUnit.test("Redirect chain follows multiple hops (A -> B -> C)", async function (assert: Assert) {
	// Chain: protected -> forbidden -> detail (avoids redirecting back to current route)
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => ({ route: "detail", parameters: { id: "chain" } }));
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "detail");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Redirected, "Settled as Redirected");
	assert.strictEqual(getHash(), "detail/chain", "Landed on final hop");
});

QUnit.test("Redirect loop (A -> B -> A) is detected and blocked", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => "protected");
	router.initialize();
	await waitForRoute(router, "home");

	const errors = await captureErrorsAsync(async () => {
		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Blocked, "Loop blocked");
	});
	assert.deepEqual(
		errors.map((e) => e.message),
		["Guard redirect loop detected: protected -> forbidden -> protected"],
		"the error names every hash of the loop",
	);
});

QUnit.test("Guard on redirect target receives correct context", async function (assert: Assert) {
	let capturedContext: GuardContext | undefined;
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", (ctx: GuardContext) => {
		capturedContext = ctx;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "forbidden");
	assert.ok(capturedContext, "Guard on redirect target was called");
	assert.strictEqual(capturedContext!.toRoute, "forbidden", "toRoute is redirect target");
	assert.strictEqual(capturedContext!.toHash, "forbidden", "toHash is redirect target hash");
	assert.strictEqual(capturedContext!.fromRoute, "home", "fromRoute is original source");
	assert.strictEqual(capturedContext!.fromHash, "", "fromHash is original source hash");
});

QUnit.test("Leave guards run only on first hop, not on redirect hops", async function (assert: Assert) {
	let leaveCallCount = 0;
	router.addLeaveGuard("home", () => {
		leaveCallCount++;
		return true;
	});
	router.addRouteGuard("protected", () => "forbidden");
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "forbidden");
	assert.strictEqual(leaveCallCount, 1, "Leave guard ran exactly once (first hop only)");
});

QUnit.test("Async guards in redirect chain work correctly", async function (assert: Assert) {
	router.addRouteGuard("protected", async () => "forbidden");
	router.addRouteGuard("forbidden", async () => true);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "forbidden");
	assert.strictEqual(getHash(), "forbidden", "Async chain resolved to redirect target");
});

QUnit.test("Superseding navigation during async redirect chain cancels the chain", async function (assert: Assert) {
	router.addRouteGuard("protected", async () => "forbidden");
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	// Supersede before the async guard resolves
	router.navTo("detail", { id: "1" });
	await waitForRoute(router, "detail");
	await flushPromises();
	assert.strictEqual(getHash(), "detail/1", "Superseding navigation won");
});

QUnit.test("Self-redirect (A -> A) detected as loop", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "protected");
	router.initialize();
	await waitForRoute(router, "home");

	const errors = await captureErrorsAsync(async () => {
		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Blocked, "Self-redirect blocked");
	});
	assert.ok(
		errors.some((e) => e.message.includes("redirect loop detected")),
		"Loop detection error logged",
	);
});

QUnit.test("Redirect to unknown route is treated as blocked", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "nonexistent");
	router.initialize();
	await waitForRoute(router, "home");

	const warnings = await captureWarningsAsync(async () => {
		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Blocked, "Unknown redirect target blocked");
	});
	assert.deepEqual(
		warnings.map((w) => w.message),
		['Guard redirect target "nonexistent" is not a known route, treating as blocked'],
		"one warning that names the target",
	);
});

QUnit.test("Guard on redirect target that throws settles as Error", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => {
		throw new Error("guard explosion");
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Error, "Chain settles as Error when guard throws");
});

QUnit.test("Async guard rejecting during redirect chain settles as Error", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", async () => {
		throw new Error("async guard explosion in redirect chain");
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(
		result.status,
		NavigationOutcome.Error,
		"Async rejection in redirect chain settles as Error, not Blocked",
	);
	assert.ok(result.error instanceof Error, "error is captured on result");
});

QUnit.test("Max redirect depth exceeded blocks with error", async function (assert: Assert) {
	// Create a chain that exceeds MAX_REDIRECT_DEPTH (10) using parameterized redirects
	// to the same route with different params (different hashes, avoids visited-set detection).
	let callCount = 0;
	router.addRouteGuard("detail", (ctx: GuardContext) => {
		callCount++;
		const currentId = Number(ctx.toArguments.id ?? "0");
		return { route: "detail", parameters: { id: String(currentId + 1) } };
	});
	router.initialize();
	await waitForRoute(router, "home");

	const errors = await captureErrorsAsync(async () => {
		router.navTo("detail", { id: "0" });
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Blocked, "Depth exceeded blocked");
	});
	// 1 initial guard call + MAX_REDIRECT_DEPTH (10) redirect hops = 11 total
	assert.strictEqual(callCount, 11, "Guard ran for the initial hop plus MAX_REDIRECT_DEPTH (10) redirect hops");
	const chain = Array.from({ length: 11 }, (_, i) => `detail/${i}`).join(" -> ");
	assert.deepEqual(
		errors.map((e) => e.message),
		[`Guard redirect chain exceeded maximum depth (10): ${chain}`],
		"the error names every hash of the chain",
	);
});

QUnit.test("Redirect chain works via parse (browser back/forward)", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => true);
	router.initialize();
	await waitForRoute(router, "home");

	// Simulate browser navigation (hash change without navTo)
	HashChanger.getInstance().setHash("protected");
	await waitForRoute(router, "forbidden");
	assert.strictEqual(getHash(), "forbidden", "Parse-path redirect chain resolved");
});

QUnit.test("Redirect to current hash evaluates guards and commits", async function (assert: Assert) {
	let homeGuardCalled = false;
	router.addRouteGuard("protected", () => "home");
	router.addRouteGuard("home", () => {
		homeGuardCalled = true;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Redirected, "Redirected settlement");
	assert.ok(homeGuardCalled, "Guard on redirect target (current hash) was evaluated");
});

QUnit.test("A redirect hop that fails after an async guard settles as Error", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	// "detail" needs {id}: resolving this redirect throws inside the hop's async continuation.
	router.addRouteGuard("forbidden", async () => "detail");
	router.initialize();
	await waitForRoute(router, "home");

	const recorder = recordHashChanges();
	const errors = await captureErrorsAsync(async () => {
		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Error, "the chain settles as Error");
		assert.ok(result.error instanceof Error, "the error is on the result");
		assert.strictEqual(result.route, "home", "the router stays on the current route");
	});
	recorder.stop();

	assert.deepEqual(
		errors.map((e) => e.message),
		['Guard redirect target "detail" has no valid hash, navigation failed'],
	);
	assert.deepEqual(recorder.hashes, [], "hash unchanged (preflight)");
});

QUnit.test(
	"A redirect chain cancelled from inside a guard does not settle again when a later hop fails",
	async function (assert: Assert) {
		router.addRouteGuard("protected", () => "forbidden");
		router.addRouteGuard("forbidden", async () => ({ route: "detail", parameters: { id: "1" } }));
		router.addRouteGuard("detail", () => {
			router.navTo("home"); // back to the current route: cancels the chain
			return "detail"; // needs {id}: resolving this redirect throws
		});
		router.initialize();
		await waitForRoute(router, "home");

		const statuses = recordSettlements(router);

		const errors = await captureErrorsAsync(async () => {
			router.navTo("protected");
			await flushPromises();
		});

		assert.deepEqual(statuses, [NavigationOutcome.Cancelled], "the cancelled chain settled once");
		assert.deepEqual(errors, [], "the failure of the cancelled chain is not reported");
	},
);

QUnit.test(
	"navTo from a navigationSettled handler during a redirect keeps its pending guards",
	async function (assert: Assert) {
		router.addRouteGuard("protected", () => "forbidden");
		router.addRouteGuard("detail", async () => true);
		router.initialize();
		await waitForRoute(router, "home");

		let navigated = false;
		router.attachNavigationSettled((event: Router$NavigationSettledEvent) => {
			if (event.getParameter("status") === NavigationOutcome.Redirected && !navigated) {
				navigated = true;
				router.navTo("detail", { id: "1" });
			}
		});

		router.navTo("protected");
		const result = await router.navigationSettled();

		assert.deepEqual(
			{ status: result.status, route: result.route, hash: result.hash },
			{ status: NavigationOutcome.Committed, route: "detail", hash: "detail/1" },
			"the handler's navigation finished its async guard and committed",
		);
	},
);

QUnit.test(
	"Guards still run after a redirect failed to change the hash",
	async function (this: SinonTestContext, assert: Assert) {
		router.addRouteGuard("protected", () => "forbidden");
		router.initialize();
		await waitForRoute(router, "home");

		const setHash = this.stub(HashChanger.getInstance(), "setHash").throws(new Error("history unavailable"));
		assert.throws(() => router.navTo("protected"), /history unavailable/, "the failure reaches the caller");
		setHash.restore();

		router.addGuard(() => false);
		router.navTo("detail", { id: "1" });
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Blocked, "the next navigation is guarded");
		assert.strictEqual(getHash(), "", "hash unchanged");
	},
);

QUnit.test(
	"Guards still run after an allowed navTo failed to change the hash",
	async function (this: SinonTestContext, assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");

		const setHash = this.stub(HashChanger.getInstance(), "setHash").throws(new Error("history unavailable"));
		assert.throws(() => router.navTo("protected"), /history unavailable/, "the failure reaches the caller");
		assert.throws(
			() => router.navTo("protected", {}, false, { skipGuards: true }),
			/history unavailable/,
			"a navTo that skips guards fails the same way",
		);
		setHash.restore();

		router.addGuard(() => false);
		HashChanger.getInstance().setHash("detail/1");
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Blocked, "the next hash change is guarded");
		assert.strictEqual(getHash(), "", "hash restored");
	},
);

QUnit.test(
	"Redirect to the default hash commits when no navigation has committed yet",
	async function (assert: Assert) {
		let allowHome = false;
		let homeLeaveCalls = 0;
		router.addRouteGuard("home", () => allowHome);
		router.addLeaveGuard("home", () => {
			homeLeaveCalls++;
			return true;
		});
		router.addRouteGuard("protected", () => "home");
		router.initialize();
		assert.strictEqual(
			(await router.navigationSettled()).status,
			NavigationOutcome.Blocked,
			"default route blocked",
		);

		allowHome = true;
		const homeMatched = waitForRoute(router, "home");
		router.navTo("protected");
		const result = await router.navigationSettled();

		assert.deepEqual(
			{ status: result.status, route: result.route, hash: result.hash },
			{ status: NavigationOutcome.Redirected, route: "home", hash: "" },
			"settled on the redirect target, not treated as blocked",
		);
		await homeMatched;
		assert.strictEqual(getHash(), "");

		router.navTo("forbidden");
		await router.navigationSettled();
		assert.strictEqual(homeLeaveCalls, 1, "the router is on home: its leave guard runs on the next navigation");
	},
);

QUnit.test(
	"Guard on a redirect target of the initial navigation sees an empty source",
	async function (assert: Assert) {
		let hop: GuardContext | undefined;
		router.addRouteGuard("home", () => "protected");
		router.addRouteGuard("protected", (context: GuardContext) => {
			hop = context;
			return true;
		});
		router.initialize();

		assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Redirected);
		assert.strictEqual(hop!.fromRoute, "", "no source route before the first navigation");
		assert.strictEqual(hop!.fromHash, "", "no source hash before the first navigation");
	},
);

QUnit.test("a redirect commits the route that matches its hash, as navTo() does", async function (assert: Assert) {
	// "items/5" is the hash of "item", but UI5 displays "list": the first route that matches wins.
	router.destroy();
	router = createRouterUnsafe(
		[
			{ name: "home", pattern: "" },
			{ name: "list", pattern: "items/:id:" },
			{ name: "item", pattern: "items/{id}" },
			{ name: "protected", pattern: "protected" },
		],
		{ async: true },
	);
	router.addRouteGuard("protected", () => ({ route: "item", parameters: { id: "5" } }));
	router.initialize();
	await waitForRoute(router, "home");
	const settled: string[] = [];
	for (const navigate of [() => router.navTo("item", { id: "5" }), () => router.navTo("protected")]) {
		navigate();
		await waitForRoute(router, "list");
		settled.push((await router.navigationSettled()).route);
		router.navTo("home");
		await waitForRoute(router, "home");
	}

	assert.deepEqual(settled, ["list", "list"], "navTo() and the redirect are on the route that UI5 displays");
});

QUnit.test("GuardRedirect object without a mandatory parameter settles as Error", async function (assert: Assert) {
	router.addRouteGuard("protected", async () => ({ route: "detail" }));
	router.initialize();
	await waitForRoute(router, "home");

	await captureErrorsAsync(async () => {
		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Error, "fails like a string redirect, not Blocked");
		assert.ok(result.error instanceof Error, "the UI5 error is on the result");
	});
});

// ============================================================
// Module: Deferred hash change of component targets
// ============================================================
QUnit.module("Router - Deferred hash change of component targets", standardHooks);

QUnit.test(
	"the deferred hash change of a committed navigation does not cancel a navTo() started meanwhile",
	async function (assert: Assert) {
		let allow!: (allowed: boolean) => void;
		router.addRouteGuard(
			"protected",
			() =>
				new Promise<boolean>((resolve) => {
					allow = resolve;
				}),
		);
		router.initialize();
		await waitForRoute(router, "home");
		const statuses = recordSettlements(router);

		// With component target info, UI5 changes the hash only after the component targets resolved.
		router.navTo("detail", { id: "1" }, { detail: { route: "sub", parameters: { subId: "x" } } });
		assert.strictEqual(getHash(), "", "the hash change is still on its way");
		router.navTo("protected");
		await flushPromises();
		await flushPromises();
		assert.strictEqual(getHash(), "detail/1", "the deferred hash change arrived");

		allow(true);
		await flushPromises();

		assert.deepEqual(
			statuses,
			[NavigationOutcome.Committed, NavigationOutcome.Committed],
			"the pending navigation was not cancelled",
		);
		assert.strictEqual(getHash(), "protected");
	},
);

// ============================================================
// Module: Hash change refused by the hash changer
// ============================================================
QUnit.module("Router - Hash change refused by the hash changer", standardHooks);

// The Fiori launchpad refuses a hash change while it asks the user about unsaved data.
QUnit.test(
	"an allowed navTo() whose hash change is refused does not commit",
	async function (this: SinonTestContext, assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");
		const statuses = recordSettlements(router);

		const setHash = this.stub(router.getHashChanger(), "setHash");
		// Without component targets UI5 changes the hash at once, also for an empty componentTargetInfo.
		router.navTo("protected", {}, {});
		setHash.restore();
		assert.deepEqual(
			await router.navigationSettled(),
			{ status: NavigationOutcome.Blocked, route: "home", hash: "" },
			"the router stays on the route it is on",
		);

		router.navTo("protected");
		await waitForRoute(router, "protected");
		assert.deepEqual(
			statuses,
			[NavigationOutcome.Blocked, NavigationOutcome.Committed],
			"the route can still be reached",
		);
	},
);

QUnit.test(
	"a redirect whose hash change is refused does not commit",
	async function (this: SinonTestContext, assert: Assert) {
		router.addRouteGuard("protected", () => "forbidden");
		router.initialize();
		await waitForRoute(router, "home");
		const statuses = recordSettlements(router);

		const setHash = this.stub(router.getHashChanger(), "setHash");
		router.navTo("protected");
		setHash.restore();
		assert.deepEqual(
			await router.navigationSettled(),
			{ status: NavigationOutcome.Blocked, route: "home", hash: "" },
			"the router stays on the route it is on",
		);

		router.navTo("protected");
		await waitForRoute(router, "forbidden");
		assert.deepEqual(
			statuses,
			[NavigationOutcome.Blocked, NavigationOutcome.Redirected],
			"the redirect target can still be reached",
		);
	},
);

for (const [kind, guard] of [
	["a sync", (): boolean => false],
	["an async", (): Promise<boolean> => Promise.resolve(false)],
] as const) {
	QUnit.test(
		`a hash change that ${kind} guard blocks settles although its restore is refused`,
		async function (this: SinonTestContext, assert: Assert) {
			router.addRouteGuard("protected", guard);
			router.initialize();
			await waitForRoute(router, "home");
			const statuses = recordSettlements(router);

			const hashChanger = HashChanger.getInstance();
			const replaceHash = this.stub(hashChanger, "replaceHash");
			hashChanger.setHash("protected");
			await flushPromises();
			replaceHash.restore();

			assert.deepEqual(statuses, [NavigationOutcome.Blocked], "the navigation settles as Blocked");
		},
	);
}
