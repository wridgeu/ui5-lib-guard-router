import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardContext, GuardFn, GuardRouter } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { Router$RouteMatchedEvent } from "sap/ui/core/routing/Router";
import {
	addGuardUnsafe,
	assertBlocked,
	createRouter,
	flushPromises,
	getHash,
	initHashChanger,
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
// Module: Sync until a guard returns a Promise
// ============================================================
QUnit.module("Router - Sync until a guard returns a Promise", standardHooks);

/** Record each settlement's status as it fires, so a test can check what settled before navTo/setHash returned. */
function recordSettlements(): string[] {
	const statuses: string[] = [];
	router.attachNavigationSettled((event) => {
		statuses.push(event.getParameter("status") as string);
	});
	return statuses;
}

QUnit.test("an all-sync navTo commits before navTo returns", async function (assert) {
	router.addGuard(() => true);
	router.addRouteGuard("protected", () => true);
	router.initialize();
	await waitForRoute(router, "home");
	const settled = recordSettlements();

	router.navTo("protected");

	assert.strictEqual(getHash(), "protected", "hash changed in the same tick");
	assert.deepEqual(settled, [NavigationOutcome.Committed], "settled in the same tick");
});

QUnit.test("an all-sync hash change commits before setHash returns", async function (assert) {
	router.addRouteGuard("protected", () => true);
	router.initialize();
	await waitForRoute(router, "home");
	const settled = recordSettlements();

	HashChanger.getInstance().setHash("protected");

	assert.deepEqual(settled, [NavigationOutcome.Committed], "settled in the same tick");
});

QUnit.test("a sync block settles before navTo returns", async function (assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");
	const settled = recordSettlements();

	router.navTo("protected");

	assert.strictEqual(getHash(), "", "hash unchanged");
	assert.deepEqual(settled, [NavigationOutcome.Blocked], "settled in the same tick");
});

QUnit.test("a sync block on a hash change restores the hash before setHash returns", async function (assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");
	const settled = recordSettlements();

	HashChanger.getInstance().setHash("protected");

	assert.strictEqual(getHash(), "", "hash restored in the same tick");
	assert.deepEqual(settled, [NavigationOutcome.Blocked], "settled in the same tick");
});

QUnit.test("guards after one that returns a Promise wait for it", async function (assert) {
	const calls: string[] = [];
	router.addGuard(() => {
		calls.push("async global");
		return Promise.resolve(true);
	});
	router.addRouteGuard("protected", () => {
		calls.push("route");
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");
	calls.length = 0;
	const settled = recordSettlements();

	router.navTo("protected");

	assert.deepEqual(calls, ["async global"], "the route guard has not run yet");
	assert.deepEqual(settled, [], "not settled yet");
	assert.strictEqual(getHash(), "", "hash unchanged yet");

	assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Committed);
	assert.deepEqual(calls, ["async global", "route"]);
	assert.strictEqual(getHash(), "protected");
});

QUnit.test("an async leave guard defers the enter guards", async function (assert) {
	const calls: string[] = [];
	router.addLeaveGuard("home", () => {
		calls.push("leave");
		return Promise.resolve(true);
	});
	router.addGuard(() => {
		calls.push("global");
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");
	calls.length = 0;

	router.navTo("protected");
	assert.deepEqual(calls, ["leave"], "enter guards have not run yet");

	assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Committed);
	assert.deepEqual(calls, ["leave", "global"]);
});

QUnit.test("the next navigation starts sync again", async function (assert) {
	router.addGuard((context) => (context.toRoute === "protected" ? Promise.resolve(true) : true));
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	assert.strictEqual(getHash(), "", "the async navigation has not committed yet");
	await router.navigationSettled();

	const settled = recordSettlements();
	router.navTo("forbidden");
	assert.strictEqual(getHash(), "forbidden", "committed in the same tick");
	assert.deepEqual(settled, [NavigationOutcome.Committed]);
});

QUnit.test("an all-sync redirect chain finishes before navTo returns, with one settlement", async function (assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => ({ route: "detail", parameters: { id: "1" } }));
	router.initialize();
	await waitForRoute(router, "home");
	const settled = recordSettlements();

	router.navTo("protected");

	assert.strictEqual(getHash(), "detail/1", "both hops ran in the same tick");
	assert.deepEqual(settled, [NavigationOutcome.Redirected], "one settlement for the whole chain");
});

QUnit.test("an async redirect hop makes the remaining hops async", async function (assert) {
	let detailCalls = 0;
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => Promise.resolve({ route: "detail", parameters: { id: "1" } }));
	router.addRouteGuard("detail", () => {
		detailCalls++;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");
	const settled = recordSettlements();

	router.navTo("protected");

	assert.strictEqual(detailCalls, 0, "the hop after the async one has not run yet");
	assert.deepEqual(settled, [], "not settled yet");
	assert.strictEqual(getHash(), "", "hash unchanged yet");

	assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Redirected);
	assert.strictEqual(detailCalls, 1);
	assert.strictEqual(getHash(), "detail/1");
	assert.deepEqual(settled, [NavigationOutcome.Redirected], "one settlement for the whole chain");
});

// ============================================================
// Module: Mixed sync/async guard pipelines
// ============================================================
QUnit.module("Router - Mixed sync/async guard pipelines", standardHooks);

QUnit.test("Sync global guard allows, async route guard allows", async function (assert: Assert) {
	router.addGuard(() => true);
	router.addRouteGuard("protected", async () => true);
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"protected",
		"Navigation allowed through sync global + async route guard",
	);
});

QUnit.test("Sync global guard allows, async route guard blocks", async function (assert: Assert) {
	router.addGuard(() => true);
	router.addRouteGuard("protected", async () => false);
	router.initialize();
	await assertBlocked(
		assert,
		router,
		() => router.navTo("protected"),
		"Async route guard blocked after sync global allowed",
	);
});

QUnit.test("Async global guard allows, sync route guard allows", async function (assert: Assert) {
	router.addGuard(async () => true);
	router.addRouteGuard("protected", () => true);
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"protected",
		"Navigation allowed through async global + sync route guard",
	);
});

QUnit.test("Async global guard allows, sync route guard blocks", async function (assert: Assert) {
	router.addGuard(async () => true);
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await assertBlocked(
		assert,
		router,
		() => router.navTo("protected"),
		"Sync route guard blocked after async global allowed",
	);
});

QUnit.test("Async global guard allows, sync route guard redirects", async function (assert: Assert) {
	router.addGuard(async () => true);
	router.addRouteGuard("forbidden", () => "home");
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("forbidden");
	await waitForRoute(router, "home");
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"",
		"Sync route guard redirected after async global allowed",
	);
});

// ============================================================
// Module: Overlapping async navigations
// ============================================================
QUnit.module("Router - Overlapping async navigations", standardHooks);

QUnit.test("Slower first navigation is superseded by faster second navigation", async function (assert: Assert) {
	const slowGuard = Promise.withResolvers<boolean>();
	router.addRouteGuard("protected", () => slowGuard.promise);
	router.addRouteGuard("detail", async () => true);
	router.initialize();

	let protectedMatched = false;
	router.getRoute("protected")!.attachPatternMatched(() => {
		protectedMatched = true;
	});

	router.navTo("protected");
	router.navTo("detail", { id: "1" });

	await router.navigationSettled();
	slowGuard.resolve(true);
	await flushPromises();
	assert.notOk(protectedMatched, "Slow first navigation was superseded");
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"detail/1",
		"Hash reflects the second (winning) navigation",
	);
});

QUnit.test("Superseded async guard result does not apply", async function (assert: Assert) {
	const slowResult = Promise.withResolvers<string>();
	let slowGuardCalled = false;
	const slowGuard: GuardFn = () => {
		slowGuardCalled = true;
		return slowResult.promise;
	};
	router.initialize();
	await waitForRoute(router, "home");
	router.addGuard(slowGuard);

	router.navTo("protected");
	assert.ok(slowGuardCalled, "Slow guard is pending for the first navigation");

	router.removeGuard(slowGuard);
	router.navTo("detail", { id: "2" });

	await router.navigationSettled();
	slowResult.resolve("forbidden"); // This redirect should be discarded
	await flushPromises();
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"detail/2",
		"Second navigation won, redirect from first was discarded",
	);
});

/**
 * Resolve a superseded guard after the winning navigation settled and assert
 * that the stale result fires no settlement and leaves the last one in place.
 */
async function assertStaleResultIgnored(assert: Assert, resolveStale: () => void): Promise<void> {
	const winner = await router.navigationSettled();
	const lateSettlements: string[] = [];
	router.attachNavigationSettled((event) => lateSettlements.push(event.getParameters().status));

	resolveStale();
	await flushPromises();

	assert.deepEqual(lateSettlements, [], "stale guard result fires no settlement");
	assert.deepEqual(await router.navigationSettled(), winner, "last settlement is still the winning navigation");
}

QUnit.test("Superseded async preflight result does not settle", async function (assert: Assert) {
	const slowGuard = Promise.withResolvers<boolean>();
	router.addRouteGuard("protected", () => slowGuard.promise);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	router.navTo("detail", { id: "1" });

	await assertStaleResultIgnored(assert, () => slowGuard.resolve(true));
});

QUnit.test(
	"Stale result arriving while the newer navigation is still evaluating is ignored",
	async function (assert: Assert) {
		const staleGuard = Promise.withResolvers<boolean>();
		const winnerGuard = Promise.withResolvers<boolean>();
		router.addRouteGuard("protected", () => staleGuard.promise);
		router.addRouteGuard("detail", () => winnerGuard.promise);
		router.initialize();
		await waitForRoute(router, "home");
		const settlements: string[] = [];
		router.attachNavigationSettled((event) => settlements.push(event.getParameters().status));

		router.navTo("protected");
		router.navTo("detail", { id: "1" });
		staleGuard.resolve(true);
		await flushPromises();
		assert.deepEqual(settlements, [NavigationOutcome.Cancelled], "only the superseded navigation has settled");

		winnerGuard.resolve(true);
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Committed, "newer navigation commits");
		assert.strictEqual(result.route, "detail", "newer navigation reaches its route");
		assert.deepEqual(
			settlements,
			[NavigationOutcome.Cancelled, NavigationOutcome.Committed],
			"no stale settlement",
		);
	},
);

QUnit.test("Superseded async hash-change result does not settle", async function (assert: Assert) {
	const slowGuard = Promise.withResolvers<boolean>();
	router.addRouteGuard("protected", () => slowGuard.promise);
	router.initialize();
	await waitForRoute(router, "home");

	HashChanger.getInstance().setHash("protected");
	HashChanger.getInstance().setHash("detail/1");

	await assertStaleResultIgnored(assert, () => slowGuard.resolve(true));
});

QUnit.test("Superseded async redirect-chain result does not settle", async function (assert: Assert) {
	const slowTargetGuard = Promise.withResolvers<boolean>();
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => slowTargetGuard.promise);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	router.navTo("detail", { id: "1" });

	await assertStaleResultIgnored(assert, () => slowTargetGuard.resolve(true));
});

// ============================================================
// Module: Guard context across navigations
// ============================================================
QUnit.module("Router - Guard context across navigations", standardHooks);

QUnit.test("Guard context has correct fromRoute and fromHash after prior navigation", async function (assert: Assert) {
	let capturedContext: GuardContext | null = null;
	router.initialize();

	// Navigate to detail/42 first (no guards)
	router.navTo("detail", { id: "42" });
	await waitForRoute(router, "detail");

	// Now add a guard that captures context
	router.addGuard((context: GuardContext) => {
		capturedContext = context;
		return true;
	});
	router.navTo("protected");
	await waitForRoute(router, "protected");

	assert.ok(capturedContext, "Context was captured");
	assert.strictEqual(capturedContext!.fromRoute, "detail", "fromRoute is correct");
	assert.strictEqual(capturedContext!.fromHash, "detail/42", "fromHash is correct");
	assert.strictEqual(capturedContext!.toRoute, "protected", "toRoute is correct");
	assert.strictEqual(capturedContext!.toHash, "protected", "toHash is correct");
});

QUnit.test("Guard context fromRoute/fromHash are empty on initial navigation", async function (assert: Assert) {
	let capturedContext: GuardContext | null = null;
	router.addGuard((context: GuardContext) => {
		capturedContext = context;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	assert.ok(capturedContext, "Context was captured on init");
	assert.strictEqual(capturedContext!.fromRoute, "", "fromRoute is empty on initial nav");
	assert.strictEqual(capturedContext!.fromHash, "", "fromHash is empty on initial nav");
});

// ============================================================
// Module: Async guard edge cases
// ============================================================
QUnit.module("Router - Async guard edge cases", standardHooks);

QUnit.test("Async route-specific guard throwing error produces Error settlement", async function (assert: Assert) {
	const thrownError = new Error("Async route guard error");
	router.addRouteGuard("protected", async () => {
		throw thrownError;
	});
	router.initialize();
	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Error, "Status is Error");
	assert.strictEqual(result.error, thrownError, "Error is the thrown value");
});

QUnit.test(
	"Async route-specific guard returning rejected promise produces Error settlement",
	async function (assert: Assert) {
		const rejectedError = new Error("Route guard rejected");
		router.addRouteGuard("protected", () => Promise.reject(rejectedError));
		router.initialize();
		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Error, "Status is Error");
		assert.strictEqual(result.error, rejectedError, "Error is the rejected value");
	},
);

QUnit.test("Multiple async guards - first rejection short-circuits remaining", async function (assert: Assert) {
	const order: number[] = [];
	router.initialize();
	await waitForRoute(router, "home");

	router.addGuard(async () => {
		order.push(1);
		return true;
	});
	router.addGuard(async () => {
		order.push(2);
		return false;
	});
	router.addGuard(async () => {
		order.push(3);
		return true;
	});

	router.navTo("protected");
	await router.navigationSettled();
	assert.deepEqual(order, [1, 2], "Third guard was short-circuited after second rejected");
});

QUnit.test("Async route guard redirects", async function (assert: Assert) {
	router.addRouteGuard("protected", async () => "home");
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "home");
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Async route guard redirected to home");
});

QUnit.test("Guard returning null is treated as block", async function (assert: Assert) {
	addGuardUnsafe(router, () => null);
	router.initialize();
	await assertBlocked(assert, router, () => router.navTo("protected"), "Null guard return treated as block");
});

QUnit.test("Guard returning undefined is treated as block", async function (assert: Assert) {
	addGuardUnsafe(router, () => undefined);
	router.initialize();
	await assertBlocked(assert, router, () => router.navTo("protected"), "Undefined guard return treated as block");
});

QUnit.test("Async guard returning invalid value treats as block", async function (assert: Assert) {
	addGuardUnsafe(router, async () => 42);
	router.initialize();
	await assertBlocked(assert, router, () => router.navTo("protected"), "Async invalid guard return treated as block");
});

QUnit.test("Async guard returning invalid redirect object treats as block", async function (assert: Assert) {
	addGuardUnsafe(router, async () => ({ route: "" }));
	router.initialize();
	await assertBlocked(
		assert,
		router,
		() => router.navTo("protected"),
		"Async invalid redirect object treated as block",
	);
});

// ============================================================
// Module: Rapid sequential navigations
// ============================================================
QUnit.module("Router - Rapid sequential navigations", standardHooks);

QUnit.test("Rapid sync navigations - last one wins", async function (assert: Assert) {
	const matchedRoutes: string[] = [];
	router.addGuard(() => true);
	router.initialize();
	await waitForRoute(router, "home");

	router.attachRouteMatched((event: Router$RouteMatchedEvent) => {
		matchedRoutes.push(event.getParameter("name")!);
	});

	router.navTo("protected");
	router.navTo("forbidden");
	router.navTo("detail", { id: "1" });

	await waitForRoute(router, "detail");
	const lastMatched = matchedRoutes[matchedRoutes.length - 1];
	assert.strictEqual(lastMatched, "detail", "Last rapid navigation won");
});

QUnit.test("Rapid async navigations - only last navigation settles", async function (assert: Assert) {
	const matchedRoutes: string[] = [];
	router.addGuard(async () => true);
	router.initialize();
	await waitForRoute(router, "home");

	router.attachRouteMatched((event: Router$RouteMatchedEvent) => {
		matchedRoutes.push(event.getParameter("name")!);
	});

	router.navTo("protected");
	router.navTo("forbidden");
	router.navTo("detail", { id: "1" });

	await waitForRoute(router, "detail");
	assert.strictEqual(matchedRoutes.length, 1, "Only one navigation settled");
	assert.strictEqual(matchedRoutes[0], "detail", "The last navigation won");
});

// ============================================================
// Module: Returning to current route during pending guard
// ============================================================
QUnit.module("Router - Returning to current route during pending guard", standardHooks);

QUnit.test("Navigating back to current route cancels a pending async guard", async function (assert: Assert) {
	const pendingGuard = Promise.withResolvers<boolean>();
	router.addRouteGuard("protected", () => pendingGuard.promise);
	router.initialize();
	await waitForRoute(router, "home");

	let protectedMatched = false;
	router.getRoute("protected")!.attachPatternMatched(() => {
		protectedMatched = true;
	});

	// Navigate to protected (triggers slow async guard)
	router.navTo("protected");

	// While guard is pending, navigate back to home (same-hash dedup cancels preflight).
	// With navTo preflight, the hash never changed to "protected", so
	// HashChanger.setHash("") would be a no-op. Use navTo("home") to
	// exercise the same-hash dedup in the navTo override.
	router.navTo("home");

	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Cancelled, "Navigation was cancelled");

	pendingGuard.resolve(true);
	await flushPromises();
	assert.notOk(protectedMatched, "Stale async guard result was discarded after same-hash dedup");
});

// ============================================================
// Module: Stop during pending async guard
// ============================================================
QUnit.module("Router - Stop during pending async guard", standardHooks);

QUnit.test(
	"Stopping router while async guard is pending aborts and prevents navigation",
	async function (assert: Assert) {
		let capturedSignal: AbortSignal | null = null;
		let routeMatched = false;

		router.initialize();
		await waitForRoute(router, "home");

		const pendingGuard = Promise.withResolvers<boolean>();
		router.addGuard((context: GuardContext) => {
			capturedSignal = context.signal;
			return pendingGuard.promise;
		});

		router.getRoute("protected")!.attachPatternMatched(() => {
			routeMatched = true;
		});

		router.navTo("protected");
		router.stop();

		assert.ok(capturedSignal, "Signal was captured");
		assert.ok(capturedSignal!.aborted, "Signal was aborted on stop");
		assert.notOk(router.isInitialized(), "Router stayed stopped");

		pendingGuard.resolve(true);
		await flushPromises();
		assert.notOk(routeMatched, "Navigation did not complete after stop");
	},
);

// ============================================================
// Module: AbortSignal on GuardContext
// ============================================================
QUnit.module("Router - AbortSignal on GuardContext", standardHooks);

QUnit.test("Guard context includes an AbortSignal", async function (assert: Assert) {
	let capturedSignal: AbortSignal | null = null;
	router.addGuard((context: GuardContext) => {
		capturedSignal = context.signal;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	assert.ok(capturedSignal, "Signal was provided");
	assert.ok(capturedSignal! instanceof AbortSignal, "Signal is an AbortSignal");
	assert.notOk(capturedSignal!.aborted, "Signal is not aborted after successful navigation");
});

QUnit.test("Signal is aborted when a newer navigation supersedes", async function (assert: Assert) {
	let firstSignal: AbortSignal | null = null;
	let secondSignal: AbortSignal | null = null;
	let callCount = 0;

	const slowGuard = Promise.withResolvers<boolean>();
	router.initialize();
	await waitForRoute(router, "home");
	router.addGuard(async (context: GuardContext) => {
		callCount++;
		if (callCount === 1) {
			firstSignal = context.signal;
			return slowGuard.promise;
		}
		secondSignal = context.signal;
		return true;
	});

	// First navigation (slow)
	router.navTo("protected");
	// Second navigation supersedes first
	router.navTo("detail", { id: "1" });

	await router.navigationSettled();
	assert.ok(firstSignal, "First signal was captured");
	assert.ok(firstSignal!.aborted, "First signal was aborted by second navigation");
	assert.ok(secondSignal, "Second signal was captured");
	assert.notOk(secondSignal!.aborted, "Second signal remains active");
});

QUnit.test("Signal is aborted on router destroy", async function (assert: Assert) {
	let capturedSignal: AbortSignal | null = null;
	const pendingGuard = Promise.withResolvers<boolean>();
	router.initialize();
	await waitForRoute(router, "home");
	router.addGuard((context: GuardContext) => {
		capturedSignal = context.signal;
		return pendingGuard.promise;
	});

	router.navTo("protected");
	assert.ok(capturedSignal, "Signal was captured");
	assert.notOk(capturedSignal!.aborted, "Signal is not yet aborted");

	router.destroy();
	assert.ok(capturedSignal!.aborted, "Signal was aborted on destroy");
});

QUnit.test("Signal is aborted when navigating back to current route", async function (assert: Assert) {
	let capturedSignal: AbortSignal | null = null;
	const pendingGuard = Promise.withResolvers<boolean>();
	router.addRouteGuard("protected", (context: GuardContext) => {
		capturedSignal = context.signal;
		return pendingGuard.promise;
	});
	router.initialize();
	await waitForRoute(router, "home");

	// Navigate to protected (triggers slow route guard)
	router.navTo("protected");
	assert.ok(capturedSignal, "Signal was captured");

	// Navigate back to current route while guard is pending.
	// With navTo preflight, the hash never changed to "protected", so
	// HashChanger.setHash("") would be a no-op. Use navTo("home") to
	// exercise the same-hash dedup.
	router.navTo("home");
	assert.ok(capturedSignal!.aborted, "Signal was aborted when returning to current route");
});

// ============================================================
// Module: Superseded navigation stops remaining guards
// ============================================================
QUnit.module("Router - Superseded navigation stops remaining guards", standardHooks);

QUnit.test("Guards for a superseded navigation stop executing", async function (assert: Assert) {
	const executed: number[] = [];

	// Use route-specific guards so they only run for "protected", not for "forbidden"
	const slowGuard = Promise.withResolvers<boolean>();
	router.addRouteGuard("protected", async () => {
		executed.push(1);
		return true;
	});
	router.addRouteGuard("protected", () => {
		executed.push(2);
		return slowGuard.promise; // will be superseded while pending
	});
	router.addRouteGuard("protected", async () => {
		executed.push(3); // should NOT run if superseded
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	// Start navigation that will be superseded
	router.navTo("protected");
	// Let guard 1 finish so guard 2 starts
	await flushPromises();
	// Supersede with a new navigation (no guards on "forbidden")
	router.navTo("forbidden");
	await waitForRoute(router, "forbidden");

	slowGuard.resolve(true);
	await flushPromises();
	assert.ok(executed.includes(1), "Guard 1 ran");
	assert.ok(executed.includes(2), "Guard 2 ran (was already started)");
	assert.notOk(executed.includes(3), "Guard 3 was skipped (early bailout)");
});

QUnit.test(
	"Route guards do not start when navigation is superseded during global guard",
	async function (assert: Assert) {
		let routeGuardCalled = false;

		const globalGuard = Promise.withResolvers<boolean>();
		router.addRouteGuard("protected", () => {
			routeGuardCalled = true;
			return true;
		});
		router.initialize();
		await waitForRoute(router, "home");
		router.addGuard(() => globalGuard.promise);

		// Start navigation to protected (triggers slow global guard)
		router.navTo("protected");
		// Supersede while global guard is pending
		router.navTo("forbidden");
		const forbiddenMatched = waitForRoute(router, "forbidden");
		globalGuard.resolve(true);
		await forbiddenMatched;
		await flushPromises();
		assert.notOk(routeGuardCalled, "Route guard was not started after superseded global guard");
	},
);

// ============================================================
// Module: Duplicate and overlapping navigation
// ============================================================
QUnit.module("Router - Duplicate and overlapping navigation", standardHooks);

QUnit.test(
	"Repeated navTo to same destination during pending guard runs guard only once",
	async function (assert: Assert) {
		let guardCallCount = 0;
		const pendingGuard = Promise.withResolvers<boolean>();
		router.addRouteGuard("protected", () => {
			guardCallCount++;
			return pendingGuard.promise;
		});
		router.initialize();
		await waitForRoute(router, "home");

		// First navTo triggers guard
		router.navTo("protected");
		// Second navTo to same destination while guard is pending, should be ignored
		router.navTo("protected");

		const protectedMatched = waitForRoute(router, "protected");
		pendingGuard.resolve(true);
		await protectedMatched;
		assert.strictEqual(guardCallCount, 1, "Guard only ran once (duplicate was deduped)");
	},
);

QUnit.test("navTo to different destination during pending guard supersedes the first", async function (assert: Assert) {
	const slowGuard = Promise.withResolvers<boolean>();
	router.addRouteGuard("protected", () => slowGuard.promise);
	router.addRouteGuard("detail", async () => true);
	router.initialize();
	await waitForRoute(router, "home");

	let protectedMatched = false;
	router.getRoute("protected")!.attachPatternMatched(() => {
		protectedMatched = true;
	});

	// First navTo triggers protected guard (slow)
	router.navTo("protected");
	// Different destination supersedes
	router.navTo("detail", { id: "1" });

	await waitForRoute(router, "detail");
	slowGuard.resolve(true);
	await flushPromises();
	assert.notOk(protectedMatched, "First navigation was superseded");
	assert.strictEqual(HashChanger.getInstance().getHash(), "detail/1", "Second navigation won");
});

QUnit.test("Route is navigable again after a guarded navigation completes", async function (assert: Assert) {
	let guardCallCount = 0;
	router.addRouteGuard("protected", async () => {
		guardCallCount++;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	// First navigation: guard runs and commits
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(guardCallCount, 1, "Guard ran for first navigation");

	// Navigate away
	router.navTo("home");
	await waitForRoute(router, "home");

	// Same destination again, should work (not stuck as "pending")
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(guardCallCount, 2, "Guard ran again for second navigation");
});

QUnit.test("AbortError from guard is silenced when navigation is superseded", async function (assert: Assert) {
	const unhandledRejections: PromiseRejectionEvent[] = [];
	const rejectionHandler = (event: PromiseRejectionEvent): void => {
		unhandledRejections.push(event);
	};
	window.addEventListener("unhandledrejection", rejectionHandler);

	router.addRouteGuard("protected", async (context: GuardContext) => {
		// Simulate a fetch that only ends by throwing AbortError when the signal is aborted
		await new Promise<void>((_resolve, reject) => {
			context.signal.addEventListener("abort", () => {
				reject(new DOMException("The operation was aborted.", "AbortError"));
			});
		});
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	// Start navigation (triggers guard with simulated fetch)
	router.navTo("protected");
	// Supersede while the fetch is pending
	router.navTo("forbidden");
	await waitForRoute(router, "forbidden");

	// Let any stale rejection surface
	await flushPromises();
	window.removeEventListener("unhandledrejection", rejectionHandler);
	assert.strictEqual(unhandledRejections.length, 0, "No unhandled promise rejections from AbortError");
});

// ============================================================
// Module: Abort controller cleanup (leak prevention)
// ============================================================
QUnit.module("Router - Abort controller cleanup", standardHooks);

QUnit.test(
	"Signal from a committed navigation is not retroactively aborted by the next navigation",
	async function (assert: Assert) {
		let firstSignal: AbortSignal | null = null;
		let callCount = 0;
		router.addGuard((context: GuardContext) => {
			callCount++;
			if (callCount === 1) {
				firstSignal = context.signal;
			}
			return true;
		});
		router.initialize();
		await waitForRoute(router, "home");
		callCount = 0;

		// First navigation commits successfully
		router.navTo("protected");
		await waitForRoute(router, "protected");
		assert.ok(firstSignal, "Signal was captured from first navigation");
		assert.notOk(firstSignal!.aborted, "Signal was not aborted after successful commit");

		// Second navigation should NOT retroactively abort the first signal
		router.navTo("forbidden");
		await waitForRoute(router, "forbidden");
		assert.notOk(firstSignal!.aborted, "First signal stays clean after second navigation commits");
	},
);

QUnit.test(
	"Signal from a blocked navigation is not retroactively aborted by the next navigation",
	async function (assert: Assert) {
		let blockedSignal: AbortSignal | null = null;
		let callCount = 0;
		router.addRouteGuard("protected", (context: GuardContext) => {
			callCount++;
			if (callCount === 1) {
				blockedSignal = context.signal;
			}
			return false;
		});
		router.initialize();
		await waitForRoute(router, "home");
		callCount = 0;

		// First navigation is blocked
		router.navTo("protected");
		await router.navigationSettled();
		assert.ok(blockedSignal, "Signal was captured from blocked navigation");
		assert.notOk(blockedSignal!.aborted, "Blocked signal is not aborted (guard ran to completion)");

		// Navigate to an unguarded route; the stale controller must not leak
		router.navTo("forbidden");
		await waitForRoute(router, "forbidden");
		assert.notOk(blockedSignal!.aborted, "Blocked signal stays clean after unguarded navigation");
	},
);

QUnit.test(
	"Signal from a redirected navigation is not retroactively aborted by the next navigation",
	async function (assert: Assert) {
		let redirectedSignal: AbortSignal | null = null;
		router.addRouteGuard("forbidden", (context: GuardContext) => {
			redirectedSignal = context.signal;
			return "home";
		});
		router.initialize();
		await waitForRoute(router, "home");

		// Navigation triggers redirect
		router.navTo("forbidden");
		await waitForRoute(router, "home");
		assert.ok(redirectedSignal, "Signal was captured from redirected navigation");
		assert.notOk(redirectedSignal!.aborted, "Signal was not aborted after redirect");

		// Subsequent navigation must not retroactively abort the old signal
		router.navTo("protected");
		await waitForRoute(router, "protected");
		assert.notOk(redirectedSignal!.aborted, "Redirected signal stays clean after subsequent navigation");
	},
);

// ============================================================
// Module: Guard error after signal abort
// ============================================================
QUnit.module("Router - Guard error after signal abort", standardHooks);

QUnit.test(
	"Enter guard rejecting after signal abort does not produce unhandled rejection",
	async function (assert: Assert) {
		const unhandledRejections: PromiseRejectionEvent[] = [];
		const rejectionHandler = (event: PromiseRejectionEvent): void => {
			unhandledRejections.push(event);
		};
		window.addEventListener("unhandledrejection", rejectionHandler);

		router.addRouteGuard("protected", async (context: GuardContext) => {
			await new Promise<void>((_resolve, reject) => {
				context.signal.addEventListener("abort", () => {
					reject(new Error("Resource cleanup failed"));
				});
			});
			return true;
		});
		router.initialize();
		await waitForRoute(router, "home");

		// Start navigation (guard stays pending)
		router.navTo("protected");
		// Supersede: aborts the signal, guard rejects
		router.navTo("forbidden");
		await waitForRoute(router, "forbidden");

		// Let any stale rejection surface
		await flushPromises();
		window.removeEventListener("unhandledrejection", rejectionHandler);
		assert.strictEqual(unhandledRejections.length, 0, "No unhandled rejections from guard error after abort");
	},
);

QUnit.test(
	"Leave guard rejecting after signal abort does not produce unhandled rejection",
	async function (assert: Assert) {
		const unhandledRejections: PromiseRejectionEvent[] = [];
		const rejectionHandler = (event: PromiseRejectionEvent): void => {
			unhandledRejections.push(event);
		};
		window.addEventListener("unhandledrejection", rejectionHandler);

		let leaveGuardCalls = 0;
		router.addLeaveGuard("home", (context: GuardContext) => {
			leaveGuardCalls++;
			if (leaveGuardCalls > 1) {
				return true;
			}
			return new Promise<boolean>((_resolve, reject) => {
				context.signal.addEventListener("abort", () => {
					reject(new Error("Leave guard cleanup error"));
				});
			});
		});
		router.initialize();
		await waitForRoute(router, "home");

		// Navigate to protected (leave guard on home stays pending)
		router.navTo("protected");
		// Supersede: aborts the signal, leave guard rejects
		router.navTo("forbidden");

		await router.navigationSettled();
		// Let the stale leave guard rejection surface
		await flushPromises();
		window.removeEventListener("unhandledrejection", rejectionHandler);
		assert.strictEqual(unhandledRejections.length, 0, "No unhandled rejections from leave guard error after abort");
	},
);

// ============================================================
// Module: Async leave guard abort check before enter phase
// ============================================================
QUnit.module("Router - Async leave guard abort check before enter phase", standardHooks);

QUnit.test(
	"enter guards do not run for superseded navigation after async leave guard resolves",
	async function (assert: Assert) {
		let enterGuardCalledWhileAborted = false;

		router.initialize();
		await waitForRoute(router, "home");

		// Async leave guard that resolves after manual trigger.
		// Track each promise so we can resolve the first (superseded) one.
		const leaveResolvers: Array<(value: boolean) => void> = [];
		router.addLeaveGuard(
			"home",
			() =>
				new Promise<boolean>((resolve) => {
					leaveResolvers.push(resolve);
				}),
		);

		// Enter guard on "protected" that tracks if it was called with an aborted signal
		router.addRouteGuard("protected", (ctx: GuardContext) => {
			if (ctx.signal.aborted) {
				enterGuardCalledWhileAborted = true;
			}
			return true;
		});

		// Start navigating to "protected". Triggers async leave guard (leaveResolvers[0])
		router.navTo("protected");

		// Supersede: navigate via setHash to trigger the parse() path (browser-initiated
		// navigation) rather than the navTo preflight path.
		// This cancels the first navigation's pipeline.
		HashChanger.getInstance().setHash("forbidden");
		// Resolve the second leave guard so "forbidden" can commit
		leaveResolvers[1](true);
		await waitForRoute(router, "forbidden");

		// Now resolve the FIRST (superseded) leave guard.
		// The enter guard for "protected" should NOT fire because the signal is aborted.
		leaveResolvers[0](true);
		await flushPromises();

		assert.notOk(
			enterGuardCalledWhileAborted,
			"Enter guard was not called with an aborted signal for the superseded navigation",
		);
	},
);
