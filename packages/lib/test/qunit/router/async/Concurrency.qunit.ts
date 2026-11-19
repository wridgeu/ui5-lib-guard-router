import sinon from "sinon";
import Log from "sap/base/Log";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardContext, GuardFn, GuardRouter } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { Router$RouteMatchedEvent } from "sap/ui/core/routing/Router";
import {
	captureErrorsAsync,
	flushPromises,
	getHash,
	recordSettlements,
	waitForRoute,
	routerHooks,
} from "../../testHelpers";

let router: GuardRouter;

const standardHooks = routerHooks(
	(created) => {
		router = created;
	},
	() => router,
);

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
	assert.strictEqual(getHash(), "detail/1", "Hash reflects the second (winning) navigation");
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
	assert.strictEqual(getHash(), "detail/2", "Second navigation won, redirect from first was discarded");
});

/**
 * Resolve a superseded guard after the winning navigation settled and assert
 * that the stale result fires no settlement and leaves the last one in place.
 */
async function assertStaleResultIgnored(assert: Assert, resolveStale: () => void): Promise<void> {
	const winner = await router.navigationSettled();
	const lateSettlements = recordSettlements(router);

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

/** What the router logs at debug level while `fn` runs, as [message, details] pairs. */
async function captureRouterDebugLogs(fn: () => Promise<void>): Promise<unknown[][]> {
	const stub = sinon.stub(Log, "debug");
	try {
		await fn();
	} finally {
		stub.restore();
	}
	return stub
		.getCalls()
		.filter((call) => call.args[2] === "ui5.guard.router.Router")
		.map((call) => [call.args[0], call.args[1]]);
}

QUnit.test("Superseded async preflight result is reported in the debug log", async function (assert: Assert) {
	const slowGuard = Promise.withResolvers<boolean>();
	router.addRouteGuard("protected", () => slowGuard.promise);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	router.navTo("detail", { id: "1" });
	const logs = await captureRouterDebugLogs(async () => {
		slowGuard.resolve(true);
		await flushPromises();
	});

	assert.deepEqual(logs, [["Async preflight result discarded (superseded by newer navigation)", "protected"]]);
});

QUnit.test("Superseded async hash-change result is reported in the debug log", async function (assert: Assert) {
	const slowGuard = Promise.withResolvers<boolean>();
	router.addRouteGuard("protected", () => slowGuard.promise);
	router.initialize();
	await waitForRoute(router, "home");

	HashChanger.getInstance().setHash("protected");
	HashChanger.getInstance().setHash("detail/1");
	const logs = await captureRouterDebugLogs(async () => {
		slowGuard.resolve(true);
		await flushPromises();
	});

	assert.deepEqual(logs, [["Async guard result discarded (superseded by newer navigation)", "protected"]]);
});

/**
 * A navigationSettled listener supersedes the navigation that is committing and then throws.
 * The failure belongs to the superseded navigation and must not settle.
 */
async function assertSupersededFailureIgnored(assert: Assert, navigate: () => void): Promise<void> {
	router.addRouteGuard("protected", () => Promise.resolve(true));
	router.initialize();
	await waitForRoute(router, "home");

	const statuses = recordSettlements(router);
	router.attachNavigationSettled(() => {
		if (statuses.length > 1) return;
		router.navTo("forbidden");
		throw new Error("listener failed after superseding");
	});

	const errors = await captureErrorsAsync(async () => {
		navigate();
		await flushPromises();
	});

	assert.deepEqual(
		errors,
		[{ message: "A navigationSettled handler threw", details: "Error: listener failed after superseding" }],
		"the listener's error is logged",
	);
	assert.deepEqual(
		statuses,
		[NavigationOutcome.Committed, NavigationOutcome.Committed],
		"no Error settlement for the superseded navigation",
	);
	const last = await router.navigationSettled();
	assert.strictEqual(last.status, NavigationOutcome.Committed, "last settlement is the newer navigation");
	assert.strictEqual(last.route, "forbidden");
	assert.strictEqual(getHash(), "forbidden");
}

QUnit.test("Failure of a superseded async preflight does not settle", async function (assert: Assert) {
	await assertSupersededFailureIgnored(assert, () => router.navTo("protected"));
});

QUnit.test("Failure of a superseded async hash change does not settle", async function (assert: Assert) {
	await assertSupersededFailureIgnored(assert, () => HashChanger.getInstance().setHash("protected"));
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
	assert.deepEqual(
		matchedRoutes,
		["protected", "forbidden", "detail"],
		"each navigation committed within its navTo(), and the last one is the last route matched",
	);
	assert.strictEqual(getHash(), "detail/1");
});

QUnit.test("Rapid async navigations - only the last navigation matches a route", async function (assert: Assert) {
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
	assert.strictEqual(matchedRoutes.length, 1, "Only one navigation matched a route");
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

QUnit.test("Hash change back to the current hash cancels a pending hash-change guard", async function (assert: Assert) {
	const pendingGuard = Promise.withResolvers<boolean>();
	let homeGuardCalls = 0;
	router.addRouteGuard("protected", () => pendingGuard.promise);
	router.addRouteGuard("home", () => {
		homeGuardCalls++;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");
	homeGuardCalls = 0;
	const settled = recordSettlements(router);

	// Browser navigation: the hash changes first, then the guard runs.
	HashChanger.getInstance().setHash("protected");
	// Browser back while the guard is pending.
	HashChanger.getInstance().setHash("");

	assert.deepEqual(settled, [NavigationOutcome.Cancelled], "pending navigation cancelled, nothing else settled");
	assert.strictEqual(homeGuardCalls, 0, "no guards run for the route the router is already on");

	pendingGuard.resolve(true);
	await flushPromises();
	assert.deepEqual(settled, [NavigationOutcome.Cancelled], "stale guard result is discarded");
	assert.strictEqual(getHash(), "");
});

QUnit.test(
	"Hash change back to the current hash cancels a navigation that superseded another hash change",
	async function (assert: Assert) {
		const pendingGuard = Promise.withResolvers<boolean>();
		router.addLeaveGuard("home", () => pendingGuard.promise);
		router.initialize();
		await waitForRoute(router, "home");
		const settled = recordSettlements(router);

		const hashChanger = HashChanger.getInstance();
		hashChanger.setHash("protected");
		hashChanger.setHash("forbidden");
		hashChanger.setHash("");

		assert.deepEqual(
			settled,
			[NavigationOutcome.Cancelled, NavigationOutcome.Cancelled],
			"both pending navigations are cancelled",
		);

		pendingGuard.resolve(true);
		await flushPromises();
		assert.deepEqual(
			settled,
			[NavigationOutcome.Cancelled, NavigationOutcome.Cancelled],
			"the stale guard results are discarded",
		);
		assert.strictEqual((await router.navigationSettled()).route, "home", "the router stays on its route");
	},
);

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
