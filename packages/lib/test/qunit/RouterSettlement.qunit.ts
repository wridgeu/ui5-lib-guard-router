import HashChanger from "sap/ui/core/routing/HashChanger";
import type {
	GuardContext,
	GuardFn,
	GuardRedirect,
	GuardRouter,
	NavigationResult,
	Router$NavigationSettledEvent,
} from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { Router$BypassedEvent, Router$RouteMatchedEvent } from "sap/ui/core/routing/Router";
import {
	captureErrors,
	captureErrorsAsync,
	createRouter,
	flushPromises,
	getHash,
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
// Module: navigationSettled()
// ============================================================
QUnit.module("Router - navigationSettled()", standardHooks);

QUnit.test(
	"Resolves with 'committed' and empty route/hash on a router that never navigated",
	async function (assert: Assert) {
		const result = await router.navigationSettled();
		assert.deepEqual(
			{ status: result.status, route: result.route, hash: result.hash },
			{ status: NavigationOutcome.Committed, route: "", hash: "" },
		);
	},
);

QUnit.test("Resolves immediately with 'committed' when nothing pending", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	let result: NavigationResult | undefined;
	void router.navigationSettled().then((settled) => {
		result = settled;
	});
	// One microtask: the Promise was resolved when it was returned.
	await Promise.resolve();

	assert.deepEqual(result, { status: NavigationOutcome.Committed, route: "home", hash: "" });
});

QUnit.test("Resolves with 'committed' when sync guard allows", async function (assert: Assert) {
	router.addRouteGuard("protected", () => true);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "Status is committed");
	assert.strictEqual(result.route, "protected", "Route is target route");
	assert.strictEqual(result.hash, "protected", "Hash is target hash");
});

QUnit.test("Resolves with 'blocked' when sync guard blocks", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Status is blocked");
	assert.strictEqual(result.route, "home", "Route stays on current route");
	assert.strictEqual(result.hash, "", "Hash stays on current hash");
});

QUnit.test("Resolves with 'redirected' when guard redirects (string)", async function (assert: Assert) {
	router.addRouteGuard("forbidden", () => "home");
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "protected");

	router.navTo("forbidden");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Redirected, "Status is redirected");
	assert.strictEqual(result.route, "home", "Route is redirect target");
});

QUnit.test("Resolves with 'committed' when async guard allows", async function (assert: Assert) {
	router.addRouteGuard("protected", () => Promise.resolve(true));
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "Status is committed");
	assert.strictEqual(result.route, "protected", "Route is target route");
});

QUnit.test("Resolves with 'blocked' when async guard blocks", async function (assert: Assert) {
	router.addRouteGuard("protected", () => Promise.resolve(false));
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Status is blocked");
	assert.strictEqual(result.route, "home", "Route stays on current route");
});

QUnit.test("Resolves with 'redirected' when async guard redirects", async function (assert: Assert) {
	router.addRouteGuard("forbidden", () => Promise.resolve("home"));
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "protected");

	router.navTo("forbidden");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Redirected, "Status is redirected");
	assert.strictEqual(result.route, "home", "Route is redirect target");
});

QUnit.test("Resolves with 'cancelled' when navigation is superseded", async function (assert: Assert) {
	const pendingGuard = Promise.withResolvers<boolean>();
	router.addRouteGuard("protected", () => pendingGuard.promise);
	router.initialize();
	await waitForRoute(router, "home");

	// Start slow navigation
	router.navTo("protected");
	const settledPromise = router.navigationSettled();

	// Supersede with immediate navigation
	router.navTo("forbidden");
	await waitForRoute(router, "forbidden");

	assert.deepEqual(
		await settledPromise,
		{ status: NavigationOutcome.Cancelled, route: "home", hash: "" },
		"cancelled, on the route and hash that were current when it was superseded",
	);
});

QUnit.test("Multiple callers receive the same result", async function (assert: Assert) {
	router.addRouteGuard("protected", () => Promise.resolve(true));
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const [result1, result2, result3] = await Promise.all([
		router.navigationSettled(),
		router.navigationSettled(),
		router.navigationSettled(),
	]);
	const committed = { status: NavigationOutcome.Committed, route: "protected", hash: "protected" };
	assert.deepEqual([result1, result2, result3], [committed, committed, committed], "All callers get the result");
});

QUnit.test("Resolves with 'redirected' when guard returns GuardRedirect object", async function (assert: Assert) {
	const target: GuardRedirect = { route: "detail", parameters: { id: "42" } };
	router.addRouteGuard("forbidden", () => target);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("forbidden");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Redirected, "Status is redirected");
	assert.strictEqual(result.route, "detail", "Route is redirect target");
	assert.strictEqual(result.hash, "detail/42", "Hash includes parameters");
});

QUnit.test("Async leave guard block produces 'blocked' status", async function (assert: Assert) {
	router.addLeaveGuard("home", () => Promise.resolve(false));
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Async leave guard block is reflected");
	assert.strictEqual(result.route, "home", "Route stays on home");
});

QUnit.test("Resolves with 'committed' for navigation without guards", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "No-guard navigation is committed");
	assert.strictEqual(result.route, "protected", "Route is target route");
});

QUnit.test("Resolves with 'bypassed' for unmatched hash without guards", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	HashChanger.getInstance().setHash("some/unknown/path");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Bypassed, "Unmatched hash settles as bypassed");
	assert.strictEqual(result.route, "", "Route is empty when no route matched");
	assert.strictEqual(result.hash, "some/unknown/path", "Hash is the attempted unmatched hash");
});

QUnit.test("Resolves with 'bypassed' when leave guard allows unmatched hash", async function (assert: Assert) {
	router.addLeaveGuard("home", () => true);
	router.initialize();
	await waitForRoute(router, "home");

	HashChanger.getInstance().setHash("some/unknown/path");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Bypassed, "Allowed unmatched hash settles as bypassed");
	assert.strictEqual(result.route, "", "Route is empty when no route matched");
	assert.strictEqual(result.hash, "some/unknown/path", "Hash is the attempted unmatched hash");
});

QUnit.test("Unmatched hash settles as 'bypassed' and still fires UI5 bypassed event", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	const bypassedEventPromise = new Promise<string>((resolve) => {
		const onBypassed = (event: Router$BypassedEvent) => {
			resolve(event.getParameter("hash") as string);
		};
		router.attachBypassed(onBypassed);
	});

	HashChanger.getInstance().setHash("some/unknown/path");
	const [result, bypassedHash] = await Promise.all([router.navigationSettled(), bypassedEventPromise]);

	assert.strictEqual(result.status, NavigationOutcome.Bypassed, "Settlement reports bypassed");
	assert.strictEqual(result.route, "", "Settlement route is empty");
	assert.strictEqual(result.hash, "some/unknown/path", "Settlement hash is the unmatched hash");
	assert.strictEqual(bypassedHash, "some/unknown/path", "UI5 bypassed event still fires with the same hash");
});

QUnit.test("Successive navigations each produce independent results", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	// First: blocked
	router.navTo("protected");
	const result1 = await router.navigationSettled();
	assert.strictEqual(result1.status, NavigationOutcome.Blocked, "First navigation blocked");

	// Second: committed (different route, no guard)
	router.navTo("forbidden");
	const result2 = await router.navigationSettled();
	assert.strictEqual(result2.status, NavigationOutcome.Committed, "Second navigation committed");
	assert.strictEqual(result2.route, "forbidden", "Route is forbidden");
});

QUnit.test("Idle replay returns the most recent settlement, not a stale one", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	// First: blocked
	router.navTo("protected");
	await router.navigationSettled();

	// Second: committed (overrides _lastSettlement)
	router.navTo("forbidden");
	await router.navigationSettled();

	// Idle replay should return the latest (committed), not the earlier (blocked)
	const replay = await router.navigationSettled();
	assert.strictEqual(replay.status, NavigationOutcome.Committed, "Replay returns latest settlement");
	assert.strictEqual(replay.route, "forbidden", "Replay route is from latest navigation");
});

QUnit.test("Idle replay after bypassed returns bypassed status", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	HashChanger.getInstance().setHash("some/unknown/path");
	const first = await router.navigationSettled();
	const second = await router.navigationSettled();

	assert.strictEqual(first.status, NavigationOutcome.Bypassed, "First call returns bypassed");
	assert.strictEqual(second.status, NavigationOutcome.Bypassed, "Idle replay returns bypassed");
	assert.strictEqual(second.route, "", "Idle replay keeps empty route");
	assert.strictEqual(second.hash, "some/unknown/path", "Idle replay keeps unmatched hash");
});

QUnit.test("Resolves with 'cancelled' when stop() is called during async guard", async function (assert: Assert) {
	const pendingGuard = Promise.withResolvers<boolean>();
	router.addRouteGuard("protected", () => pendingGuard.promise);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const settledPromise = router.navigationSettled();
	router.stop();

	const result = await settledPromise;
	assert.strictEqual(result.status, NavigationOutcome.Cancelled, "stop() cancels pending navigation");
});

QUnit.test("Idle call after stop returns synthetic committed with empty state", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await router.navigationSettled();
	router.stop();

	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "Idle fallback uses committed status");
	assert.strictEqual(result.route, "", "Idle fallback clears the route after stop()");
	assert.strictEqual(result.hash, "", "Idle fallback clears the hash after stop()");
});

QUnit.test("Cancelled settlement sees an already-aborted signal", async function (assert: Assert) {
	let capturedSignal: AbortSignal | null = null;
	const pendingGuard = Promise.withResolvers<boolean>();
	router.addRouteGuard("protected", (context: GuardContext) => {
		capturedSignal = context.signal;
		return pendingGuard.promise;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const settledPromise = router.navigationSettled();
	router.navTo("forbidden");

	const result = await settledPromise;
	assert.strictEqual(result.status, NavigationOutcome.Cancelled, "Navigation was cancelled");
	assert.ok(capturedSignal, "Signal was captured");
	assert.ok(capturedSignal!.aborted, "Signal is already aborted when Cancelled settlement resolves");
});

QUnit.test("Idle call after Blocked replays Blocked status", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const first = await router.navigationSettled();
	assert.strictEqual(first.status, NavigationOutcome.Blocked, "First call returns Blocked");

	// Router is idle; second call should replay the last settlement
	const second = await router.navigationSettled();
	assert.strictEqual(second.status, NavigationOutcome.Blocked, "Idle replay returns Blocked");
	assert.strictEqual(second.route, "home", "Replayed route is correct");
	assert.strictEqual(second.hash, "", "Replayed hash is correct");
});

QUnit.test("Idle call after Cancelled replays Cancelled status", async function (assert: Assert) {
	const pendingGuard = Promise.withResolvers<boolean>();
	router.addRouteGuard("protected", () => pendingGuard.promise);
	router.initialize();
	await waitForRoute(router, "home");

	// Start slow navigation
	router.navTo("protected");
	const settledPromise = router.navigationSettled();

	// Navigate back to current hash. Cancels without starting a new pipeline.
	// With navTo preflight, the hash never changed, so use navTo("home") for
	// same-hash dedup cancellation.
	router.navTo("home");

	const first = await settledPromise;
	assert.strictEqual(first.status, NavigationOutcome.Cancelled, "Pending nav was cancelled");

	// Router is now idle -- second call should replay the last settlement
	const second = await router.navigationSettled();
	assert.strictEqual(second.status, NavigationOutcome.Cancelled, "Idle replay returns Cancelled");
	assert.strictEqual(second.route, "home", "Replayed route is correct");
});

QUnit.test("Cancelling the initial navigation reports empty route and hash", async function (assert: Assert) {
	const pendingGuard = Promise.withResolvers<boolean>();
	router.addGuard(() => pendingGuard.promise);
	router.initialize();

	const settledPromise = router.navigationSettled();
	router.stop();

	const result = await settledPromise;
	assert.deepEqual(
		{ status: result.status, route: result.route, hash: result.hash },
		{ status: NavigationOutcome.Cancelled, route: "", hash: "" },
	);
});

QUnit.test("Redirect to nonexistent route settles as blocked", async function (assert: Assert) {
	router.addGuard((context: GuardContext) => {
		if (context.toRoute === "home") {
			return "nonExistentRoute";
		}
		return true;
	});
	router.initialize();

	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Failed redirect settles as blocked");
	assert.strictEqual(result.route, "", "Route reflects where the router stayed");
	assert.strictEqual(result.hash, "", "Hash is empty before the first navigation committed");
});

QUnit.test("Async redirect to nonexistent route settles as blocked", async function (assert: Assert) {
	router.addRouteGuard("protected", async () => "nonExistentRoute");
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Failed async redirect settles as blocked");
	assert.strictEqual(result.route, "home", "Route reflects where the router stayed");
	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"",
		"Browser hash unchanged (preflight blocked before hash update)",
	);
});

QUnit.test("GuardRedirect object to nonexistent route settles as blocked", async function (assert: Assert) {
	router.addRouteGuard("protected", (): GuardRedirect => ({ route: "nonExistentRoute", parameters: { id: "1" } }));
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Failed GuardRedirect settles as blocked");
	assert.strictEqual(result.route, "home", "Route reflects where the router stayed");
});

QUnit.test("Blocked navigation does not fire patternMatched on target route", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	let matched = false;
	router.getRoute("protected")!.attachPatternMatched(() => {
		matched = true;
	});

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Navigation was blocked");

	await flushPromises();
	assert.notOk(matched, "patternMatched never fired on the blocked target route");
});

// ============================================================
// Module: Restore and settlement invariants
// ============================================================
QUnit.module("Router - Restore and settlement invariants", standardHooks);

QUnit.test("Blocked setHash restores hash and suppresses patternMatched", async function (assert: Assert) {
	let matched = false;

	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	router.getRoute("protected")!.attachPatternMatched(() => {
		matched = true;
	});

	// Use setHash to go through the parse() path where the hash actually
	// changes before guards run. This exercises _restoreHash and the
	// suppressed parse cycle that undoes the hash change.
	HashChanger.getInstance().setHash("protected");
	const result = await router.navigationSettled();
	await flushPromises();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Navigation settled as blocked");
	assert.strictEqual(result.route, "home", "Current route stayed on home");
	assert.strictEqual(result.hash, "", "Settlement hash stayed on the previous hash");
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Browser hash was restored to the previous value");
	assert.notOk(matched, "Suppressed restore parse did not fire patternMatched on the blocked target");
});

QUnit.test(
	"Async navTo started from a Blocked settlement handler survives the hash restore",
	async function (assert: Assert) {
		router.addRouteGuard("protected", () => false);
		router.addRouteGuard("forbidden", () => Promise.resolve(true));
		router.initialize();
		await waitForRoute(router, "home");

		router.attachNavigationSettled(function handler(event: Router$NavigationSettledEvent) {
			if (event.getParameter("status") !== NavigationOutcome.Blocked) return;
			router.detachNavigationSettled(handler);
			// Runs before the router restores the hash of the blocked navigation.
			router.navTo("forbidden");
		});

		HashChanger.getInstance().setHash("protected");
		const result = await router.navigationSettled();

		assert.strictEqual(
			result.status,
			NavigationOutcome.Committed,
			"the restore did not cancel the handler's navigation",
		);
		assert.strictEqual(result.route, "forbidden");
		assert.strictEqual(HashChanger.getInstance().getHash(), "forbidden");
	},
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

// ============================================================
// Module: navigationSettled event
// ============================================================
QUnit.module("Router - navigationSettled event", standardHooks);

QUnit.test("fires on committed navigation", async function (assert) {
	const events: { status: string; route: string; hash: string }[] = [];
	router.attachNavigationSettled((event) => {
		events.push({
			status: event.getParameter("status") as string,
			route: event.getParameter("route") as string,
			hash: event.getParameter("hash") as string,
		});
	});
	router.initialize();
	await waitForRoute(router, "home");

	assert.strictEqual(events.length, 1, "Event fired once");
	assert.strictEqual(events[0].status, NavigationOutcome.Committed, "Status is Committed");
	assert.strictEqual(events[0].route, "home", "Route is home");
});

QUnit.test("fires on blocked navigation", async function (assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	const events: { status: string; route: string }[] = [];
	router.attachNavigationSettled((event) => {
		events.push({
			status: event.getParameter("status") as string,
			route: event.getParameter("route") as string,
		});
	});

	router.navTo("protected");
	await router.navigationSettled();

	assert.strictEqual(events.length, 1, "Event fired once for blocked navigation");
	assert.strictEqual(events[0].status, NavigationOutcome.Blocked, "Status is Blocked");
	assert.strictEqual(events[0].route, "home", "Route stays home");
});

QUnit.test("fires on redirected navigation", async function (assert) {
	router.addRouteGuard("protected", () => "home");
	router.initialize();
	await waitForRoute(router, "home");

	const statuses = recordSettlements(router);

	router.navTo("protected");
	await router.navigationSettled();

	assert.deepEqual(statuses, [NavigationOutcome.Redirected], "one event, with the Redirected status");
});

QUnit.test("fires on cancelled navigation", async function (assert) {
	const pendingGuard = Promise.withResolvers<boolean>();
	router.initialize();
	await waitForRoute(router, "home");
	router.addGuard(() => pendingGuard.promise);

	const statuses = recordSettlements(router);

	router.navTo("protected");
	router.navTo("home"); // cancels first

	await router.navigationSettled();

	assert.deepEqual(statuses, [NavigationOutcome.Cancelled], "one event, with the Cancelled status");
});

QUnit.test("fires on bypassed navigation", async function (assert) {
	router.initialize();
	await waitForRoute(router, "home");

	const events: { status: string; route: string; hash: string }[] = [];
	router.attachNavigationSettled((event) => {
		events.push({
			status: event.getParameter("status") as string,
			route: event.getParameter("route") as string,
			hash: event.getParameter("hash") as string,
		});
	});

	HashChanger.getInstance().setHash("nonexistent/route/that/matches/nothing");
	await router.navigationSettled();

	assert.strictEqual(events.length, 1, "Event fired once for bypassed navigation");
	assert.strictEqual(events[0].status, NavigationOutcome.Bypassed, "Status is Bypassed");
	assert.strictEqual(events[0].route, "", "Route is empty for bypassed");
});

QUnit.test("detachNavigationSettled stops delivery", async function (assert) {
	const events: string[] = [];
	const oListener = {};
	const handler = (event: Router$NavigationSettledEvent) => {
		events.push(event.getParameter("status") as string);
	};

	router.attachNavigationSettled(handler, oListener);
	router.initialize();
	await waitForRoute(router, "home");
	assert.strictEqual(events.length, 1, "Handler received initial settlement");

	router.detachNavigationSettled(handler, oListener);

	router.navTo("forbidden");
	await router.navigationSettled();
	assert.strictEqual(events.length, 1, "Handler no longer receives events after detach");
});

// ============================================================
// Module: detachNavigationSettled oListener optional
// ============================================================
QUnit.module("Router - detachNavigationSettled oListener optional", standardHooks);

QUnit.test(
	"detachNavigationSettled works without oListener when attached without one",
	async function (assert: Assert) {
		const events: string[] = [];

		const handler = (event: Router$NavigationSettledEvent) => {
			events.push(event.getParameter("status") as string);
		};

		router.attachNavigationSettled(handler);
		router.initialize();
		await waitForRoute(router, "home");
		assert.strictEqual(events.length, 1, "Handler received initial settlement");

		// Detach without oListener. This should compile and work at runtime
		(router as GuardRouter).detachNavigationSettled(handler);

		router.navTo("forbidden");
		await router.navigationSettled();
		assert.strictEqual(events.length, 1, "Handler no longer receives events after detach without oListener");
	},
);

// ============================================================
// Module: Edge cases and recovery
// ============================================================
QUnit.module("Router - Edge cases and recovery", standardHooks);

QUnit.test("resolving orphaned guard after stop() has no side effect", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	let resolveGuard!: (value: boolean) => void;
	const guard: GuardFn = () =>
		new Promise<boolean>((resolve) => {
			resolveGuard = resolve;
		});
	router.addGuard(guard);

	router.navTo("protected");
	router.stop();

	// Resolve the orphaned guard after stop
	resolveGuard(true);
	await flushPromises();

	assert.strictEqual(
		HashChanger.getInstance().getHash(),
		"",
		"Hash was not changed by stale guard resolution after stop",
	);
});

QUnit.test("settlement outcome reflects redirect origin", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	router.addRouteGuard("protected", () => "forbidden");

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Redirected, "Redirected navigation settles as Redirected");
	assert.strictEqual(result.route, "forbidden", "Settlement route is the redirect target");
});

QUnit.test("settlement outcome reflects parse-path origin (direct hash change)", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	HashChanger.getInstance().setHash("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Committed,
		"Parse-path guardless navigation settles as Committed",
	);
	assert.strictEqual(result.route, "protected", "Settlement route is the hash change target");
});

QUnit.test("router recovers when a redirect target has no valid hash", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	// Guard redirects to "detail" without providing the mandatory {id} parameter:
	// the guard failed, not the caller of navTo().
	const redirectGuard: GuardFn = () => "detail";
	router.addRouteGuard("protected", redirectGuard);
	const statuses = recordSettlements(router);

	const errors = captureErrors(() => router.navTo("protected"));

	assert.deepEqual(statuses, [NavigationOutcome.Error], "the navigation settles as Error within navTo()");
	assert.ok((await router.navigationSettled()).error instanceof Error, "the error is on the result");
	assert.deepEqual(
		errors.map((e) => e.message),
		['Guard redirect target "detail" has no valid hash, navigation failed'],
	);
	assert.strictEqual(getHash(), "", "the hash never changed");

	// Verify guards still work on subsequent navigation (not permanently bypassed)
	router.removeRouteGuard("protected", redirectGuard);
	const blockGuard: GuardFn = () => false;
	router.addGuard(blockGuard);

	router.navTo("forbidden");
	const result = await router.navigationSettled();
	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"Guard pipeline still works after recovered redirect failure",
	);
});

QUnit.test("async redirect failure drains settlement resolvers", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	// Async guard that resolves with a redirect to "detail" (missing mandatory {id}).
	// The redirect throws, but navigationSettled() must still resolve (not hang).
	router.addRouteGuard("protected", async () => "detail");

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Error, "Async redirect failure settles as Error");
});

// ============================================================
// Module: NavigationOutcome.Error
// ============================================================
QUnit.module("Router - NavigationOutcome.Error", standardHooks);

QUnit.test("result.error is undefined for non-error settlements", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	const committed = await router.navigationSettled();
	assert.strictEqual(committed.status, NavigationOutcome.Committed, "Committed status");
	assert.strictEqual(committed.error, undefined, "No error on committed");

	router.addRouteGuard("protected", () => false);
	router.navTo("protected");
	const blocked = await router.navigationSettled();
	assert.strictEqual(blocked.status, NavigationOutcome.Blocked, "Blocked status");
	assert.strictEqual(blocked.error, undefined, "No error on blocked");
});

QUnit.test("navigationSettled event carries error field", async function (assert: Assert) {
	const thrownError = new Error("event test");
	router.addGuard(() => {
		throw thrownError;
	});
	router.initialize();

	let eventError: unknown;
	let eventStatus: string | undefined;
	router.attachNavigationSettled((event) => {
		eventStatus = event.getParameter("status") as string;
		eventError = event.getParameter("error");
	});

	router.navTo("protected");
	await router.navigationSettled();

	assert.strictEqual(eventStatus, NavigationOutcome.Error, "Event status is Error");
	assert.strictEqual(eventError, thrownError, "Event carries the error");
});

QUnit.test("idle replay after error returns Error status with error", async function (assert: Assert) {
	const thrownError = new Error("replay test");
	const throwingGuard: GuardFn = () => {
		throw thrownError;
	};
	// Only this route fails, so the error is not that of the initial navigation.
	router.addRouteGuard("protected", throwingGuard);
	router.initialize();
	await waitForRoute(router, "home");

	const failed = { status: NavigationOutcome.Error, route: "home", hash: "", error: thrownError };
	captureErrors(() => router.navTo("protected"));
	assert.deepEqual(await router.navigationSettled(), failed, "First settlement is Error");

	// Remove guard and query idle settlement
	router.removeRouteGuard("protected", throwingGuard);
	assert.deepEqual(await router.navigationSettled(), failed, "Replay returns the same result");
});

QUnit.test("guard error on the initial navigation settles with empty route and hash", async function (assert: Assert) {
	const thrownError = new Error("initial failure");
	router.addGuard(() => {
		throw thrownError;
	});
	router.initialize();

	const result = await router.navigationSettled();
	assert.deepEqual(
		{ status: result.status, route: result.route, hash: result.hash },
		{ status: NavigationOutcome.Error, route: "", hash: "" },
	);
	assert.strictEqual(result.error, thrownError);
});

QUnit.test(
	"a hash change whose sync redirect has no valid hash settles as Error and restores the hash",
	async function (assert: Assert) {
		router.addRouteGuard("protected", () => "detail"); // "detail" needs an id
		router.initialize();
		await waitForRoute(router, "home");
		const statuses = recordSettlements(router);

		const errors = captureErrors(() => HashChanger.getInstance().setHash("protected"));

		assert.deepEqual(statuses, [NavigationOutcome.Error], "settled within the hash change");
		assert.ok((await router.navigationSettled()).error instanceof Error, "the error is on the result");
		assert.deepEqual(
			errors.map((e) => e.message),
			['Guard redirect target "detail" has no valid hash, navigation failed'],
		);
		assert.strictEqual(getHash(), "", "hash restored to the route the user is on");
	},
);

// ============================================================
// Module: Navigating from a navigationSettled handler
// ============================================================
QUnit.module("Router - Navigating from a navigationSettled handler", standardHooks);

const never = (): Promise<boolean> => new Promise(() => {});

QUnit.test("a handler can navigate when a navTo() cancels a pending navigation", async function (assert: Assert) {
	router.addRouteGuard("protected", never);
	router.initialize();
	await waitForRoute(router, "home");

	const settlements: string[] = [];
	router.attachNavigationSettled((event: Router$NavigationSettledEvent) => {
		settlements.push(`${event.getParameter("status")} ${event.getParameter("route")}`);
		if (event.getParameter("status") === NavigationOutcome.Cancelled) {
			router.navTo("detail", { id: "1" });
		}
	});

	router.navTo("protected");
	router.navTo("forbidden");

	assert.deepEqual(
		settlements,
		["cancelled home", "committed detail", "committed forbidden"],
		"the handler's navigation commits, then the navigation that cancelled",
	);
	assert.strictEqual(getHash(), "forbidden");
	assert.strictEqual((await router.navigationSettled()).route, "forbidden");
});

QUnit.test(
	"a hash change is dropped when a handler navigated away on the cancellation it caused",
	async function (assert: Assert) {
		router.addRouteGuard("protected", never);
		router.initialize();
		await waitForRoute(router, "home");

		const settlements: string[] = [];
		router.attachNavigationSettled((event: Router$NavigationSettledEvent) => {
			settlements.push(`${event.getParameter("status")} ${event.getParameter("route")}`);
			if (event.getParameter("status") === NavigationOutcome.Cancelled) {
				router.navTo("detail", { id: "1" });
			}
		});

		HashChanger.getInstance().setHash("protected");
		HashChanger.getInstance().setHash("forbidden");
		await flushPromises();

		assert.deepEqual(
			settlements,
			["cancelled home", "committed detail"],
			"the handler's navigation is the last one",
		);
		assert.strictEqual(getHash(), "detail/1", "the URL shows the route the router is on");
		assert.strictEqual((await router.navigationSettled()).route, "detail");
	},
);

QUnit.test(
	"a navigation a handler starts on a cancellation is superseded by the navigation that cancelled",
	async function (assert: Assert) {
		let allowDetail!: (allowed: boolean) => void;
		let detailSignal: AbortSignal | undefined;
		router.addRouteGuard("protected", never);
		router.addRouteGuard("detail", (context: GuardContext) => {
			detailSignal = context.signal;
			return new Promise<boolean>((resolve) => {
				allowDetail = resolve;
			});
		});
		router.initialize();
		await waitForRoute(router, "home");

		const settlements: string[] = [];
		let navigated = false;
		router.attachNavigationSettled((event: Router$NavigationSettledEvent) => {
			settlements.push(`${event.getParameter("status")} ${event.getParameter("route")}`);
			if (event.getParameter("status") === NavigationOutcome.Cancelled && !navigated) {
				navigated = true;
				router.navTo("detail", { id: "1" });
			}
		});

		router.navTo("protected");
		router.navTo("forbidden");
		allowDetail(true);
		await flushPromises();

		assert.deepEqual(settlements, ["cancelled home", "committed forbidden"], "only the later navigation commits");
		assert.ok(detailSignal?.aborted, "the superseded navigation's signal is aborted");
		assert.strictEqual(getHash(), "forbidden");
	},
);

QUnit.test(
	"a handler that navigates on when a navigation commits gets its own route displayed",
	async function (assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");

		const matched: string[] = [];
		router.attachRouteMatched((event: Router$RouteMatchedEvent) => {
			matched.push(event.getParameter("name")!);
		});
		let navigated = false;
		router.attachNavigationSettled((event: Router$NavigationSettledEvent) => {
			if (event.getParameter("route") === "protected" && !navigated) {
				navigated = true;
				router.navTo("forbidden");
			}
		});

		router.navTo("protected");
		await waitForRoute(router, "forbidden");
		await flushPromises();

		assert.deepEqual(matched, ["forbidden"], "the route that was left again within its settlement is not matched");
		assert.strictEqual(getHash(), "forbidden");
		assert.strictEqual((await router.navigationSettled()).route, "forbidden");
	},
);

// ============================================================
// Module: Errors while a navigation is applied
// ============================================================
QUnit.module("Router - Errors while a navigation is applied", standardHooks);

QUnit.test(
	"an error thrown while an async-guarded navigation commits is logged and does not settle again",
	async function (assert: Assert) {
		router.addRouteGuard("protected", async () => true);
		router.initialize();
		await waitForRoute(router, "home");
		router.attachBeforeRouteMatched(() => {
			throw new Error("handler failed");
		});
		const statuses = recordSettlements(router);

		const errors = await captureErrorsAsync(async () => {
			router.navTo("protected");
			await flushPromises();
		});

		assert.deepEqual(statuses, [NavigationOutcome.Committed], "the committed navigation is not reported as failed");
		assert.deepEqual(
			errors.map((e) => [e.message, e.details]),
			[["Navigation failed after its guards had settled", "Error: handler failed"]],
		);
		assert.strictEqual((await router.navigationSettled()).route, "protected");
	},
);

QUnit.test(
	"an error thrown before an async-guarded navigation settled fails it",
	async function (this: SinonTestContext, assert: Assert) {
		router.addRouteGuard("protected", async () => true);
		router.initialize();
		await waitForRoute(router, "home");
		const statuses = recordSettlements(router);
		this.stub(router.getHashChanger(), "setHash").throws(new Error("hash failed"));

		const errors = await captureErrorsAsync(async () => {
			router.navTo("protected");
			await flushPromises();
		});

		assert.deepEqual(statuses, [NavigationOutcome.Error], "the navigation settles once, as Error");
		assert.deepEqual(
			errors.map((e) => [e.message, e.details]),
			[["Navigation failed after its guards had settled", "Error: hash failed"]],
		);
		const result = await router.navigationSettled();
		assert.strictEqual(result.route, "home", "the router stays on the current route");
		assert.ok(result.error instanceof Error, "the error is on the result");
	},
);

QUnit.test(
	"an error thrown before an async-guarded hash change settled fails it and restores the hash",
	async function (assert: Assert) {
		router.addRouteGuard("protected", async () => "forbidden");
		router.initialize();
		await waitForRoute(router, "home");
		const statuses = recordSettlements(router);
		// The redirect fails to write its hash. Restoring the hash afterwards works.
		const hashChanger = router.getHashChanger();
		const replaceHash = hashChanger.replaceHash;
		hashChanger.replaceHash = () => {
			hashChanger.replaceHash = replaceHash;
			throw new Error("hash failed");
		};

		const errors = await captureErrorsAsync(async () => {
			HashChanger.getInstance().setHash("protected");
			await flushPromises();
		});

		assert.deepEqual(statuses, [NavigationOutcome.Error], "the navigation settles once, as Error");
		assert.deepEqual(
			errors.map((e) => [e.message, e.details]),
			[["Navigation failed after its guards had settled", "Error: hash failed"]],
		);
		assert.strictEqual(getHash(), "", "the hash that the failed navigation left in the URL is restored");
	},
);

// ============================================================
// Module: Guards that navigate
// ============================================================
QUnit.module("Router - Guards that navigate", standardHooks);

const STALE_RESULTS: [string, GuardRedirect | boolean][] = [
	["false", false],
	["true", true],
	["a redirect", { route: "detail", parameters: { id: "1" } }],
];

/** Guard "protected" with a sync guard that navigates to "forbidden" before it returns each of {@link STALE_RESULTS}. */
async function assertGuardNavigationWins(assert: Assert, navigate: () => void): Promise<void> {
	let result: GuardRedirect | boolean = false;
	router.addRouteGuard("protected", () => {
		router.navTo("forbidden");
		return result;
	});
	router.initialize();
	await waitForRoute(router, "home");

	const settlements: string[] = [];
	router.attachNavigationSettled((event: Router$NavigationSettledEvent) => {
		settlements.push(`${event.getParameter("status")} ${event.getParameter("route")}`);
	});

	for (const [label, value] of STALE_RESULTS) {
		result = value;
		navigate();
		await flushPromises();

		assert.deepEqual(
			settlements,
			["cancelled home", "committed forbidden"],
			`guard returns ${label}: only the guard's navigation settles after the cancellation`,
		);
		assert.strictEqual(getHash(), "forbidden", `guard returns ${label}: the URL shows the guard's target`);
		assert.strictEqual((await router.navigationSettled()).route, "forbidden");

		router.navTo("home");
		await flushPromises();
		settlements.length = 0;
	}
}

QUnit.test("navTo(): the result of a sync guard that navigated is dropped", async function (assert: Assert) {
	await assertGuardNavigationWins(assert, () => router.navTo("protected"));
});

QUnit.test("hash change: the result of a sync guard that navigated is dropped", async function (assert: Assert) {
	await assertGuardNavigationWins(assert, () => HashChanger.getInstance().setHash("protected"));
});

QUnit.test(
	"a sync guard that starts an async-guarded navigation and blocks leaves that navigation pending",
	async function (assert: Assert) {
		router.addRouteGuard("protected", () => {
			router.navTo("forbidden");
			return false;
		});
		router.addRouteGuard("forbidden", async () => true);
		router.initialize();
		await waitForRoute(router, "home");
		const statuses = recordSettlements(router);

		HashChanger.getInstance().setHash("protected");
		assert.deepEqual(
			statuses,
			[NavigationOutcome.Cancelled],
			"no Blocked settlement for the superseded hash change",
		);
		assert.strictEqual(getHash(), "protected", "the hash is not restored: the guard's navigation will move it");

		const result = await router.navigationSettled();
		assert.strictEqual(result.route, "forbidden", "the guard's navigation committed");
		assert.strictEqual(getHash(), "forbidden");
	},
);

QUnit.test(
	"a blocked navTo() to the empty hash that superseded the first hash change does not evaluate that hash again",
	async function (assert: Assert) {
		HashChanger.getInstance().setHash("protected");
		router.addRouteGuard("protected", never);
		let homeGuardCalls = 0;
		router.addRouteGuard("home", () => {
			homeGuardCalls++;
			return false;
		});
		const statuses = recordSettlements(router);

		router.initialize();
		router.navTo("home");
		await flushPromises();

		assert.deepEqual(statuses, [NavigationOutcome.Cancelled, NavigationOutcome.Blocked], "blocked once");
		assert.strictEqual(homeGuardCalls, 1, "restoring the empty hash did not run the guard that just blocked it");
		assert.strictEqual(getHash(), "", "the pending hash is gone from the URL");
	},
);

QUnit.test(
	"a hash change from a guard that is blocked takes the URL back to before both hash changes",
	async function (assert: Assert) {
		const hashChanger = HashChanger.getInstance();
		router.addRouteGuard("protected", () => {
			hashChanger.setHash("forbidden");
			return true;
		});
		router.addRouteGuard("forbidden", () => false);
		router.initialize();
		await waitForRoute(router, "home");
		const statuses = recordSettlements(router);

		hashChanger.setHash("protected");

		assert.deepEqual(statuses, [NavigationOutcome.Cancelled, NavigationOutcome.Blocked]);
		assert.strictEqual(getHash(), "", "the URL shows the committed hash, not the one the guard left");
	},
);

// ============================================================
// Module: Hash changes from a navigationSettled handler
// ============================================================
QUnit.module("Router - Hash changes from a navigationSettled handler", standardHooks);

/**
 * Change the hash to "forbidden" (async guard) from the handler of the first `status` settlement
 * that `navigate` causes, and check that the hash change keeps its URL and commits.
 */
async function assertHandlerHashChangeSurvives(assert: Assert, status: string, navigate: () => void): Promise<void> {
	router.addRouteGuard("forbidden", async () => true);
	router.initialize();
	await waitForRoute(router, "home");

	let hashInHandler: string | undefined;
	router.attachNavigationSettled((event: Router$NavigationSettledEvent) => {
		if (event.getParameter("status") === status && hashInHandler === undefined) {
			hashInHandler = getHash();
			HashChanger.getInstance().setHash("forbidden");
		}
	});

	navigate();
	assert.strictEqual(getHash(), "forbidden", "the restore did not overwrite the handler's hash");

	const result = await router.navigationSettled();
	assert.deepEqual(
		{ status: result.status, route: result.route, hash: result.hash },
		{ status: NavigationOutcome.Committed, route: "forbidden", hash: "forbidden" },
	);
	assert.strictEqual(getHash(), "forbidden", "the URL shows the committed route");
	assert.strictEqual(hashInHandler, "", `the ${status} handler ran on the restored hash`);
}

QUnit.test("a hash change from a Blocked handler keeps its URL", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	await assertHandlerHashChangeSurvives(assert, NavigationOutcome.Blocked, () =>
		HashChanger.getInstance().setHash("protected"),
	);
});

QUnit.test("a hash change from an Error handler keeps its URL", async function (assert: Assert) {
	router.addRouteGuard("protected", () => {
		throw new Error("guard failed");
	});
	const errors = await captureErrorsAsync(() =>
		assertHandlerHashChangeSurvives(assert, NavigationOutcome.Error, () =>
			HashChanger.getInstance().setHash("protected"),
		),
	);
	assert.strictEqual(errors.length, 1, "the guard error is logged");
});

QUnit.test(
	"a hash change from a Cancelled handler keeps its URL when the cancellation restores the hash",
	async function (assert: Assert) {
		router.addRouteGuard("protected", never);
		await assertHandlerHashChangeSurvives(assert, NavigationOutcome.Cancelled, () => {
			HashChanger.getInstance().setHash("protected");
			router.navTo("home"); // back to the current route: cancels and restores
		});
	},
);

// ============================================================
// Module: navigationSettled handlers that throw
// ============================================================
QUnit.module("Router - navigationSettled handlers that throw", standardHooks);

QUnit.test("the route of a committed navigation is still displayed", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");
	router.attachNavigationSettled(() => {
		throw new Error("handler failed");
	});

	const errors = await captureErrorsAsync(async () => {
		router.navTo("protected");
		await waitForRoute(router, "protected");
	});

	assert.deepEqual(
		errors,
		[{ message: "A navigationSettled handler threw", details: "Error: handler failed" }],
		"the error is logged",
	);
	assert.strictEqual(getHash(), "protected");
});

QUnit.test("a hash change that cancels a pending navigation is still evaluated", async function (assert: Assert) {
	router.addRouteGuard("protected", () => new Promise<boolean>(() => {}));
	router.initialize();
	await waitForRoute(router, "home");
	router.navTo("protected");
	router.attachNavigationSettled((event) => {
		if (event.getParameter("status") === NavigationOutcome.Cancelled) throw new Error("handler failed");
	});

	const errors = await captureErrorsAsync(async () => {
		HashChanger.getInstance().setHash("forbidden");
		await waitForRoute(router, "forbidden");
	});

	assert.deepEqual(
		errors,
		[{ message: "A navigationSettled handler threw", details: "Error: handler failed" }],
		"the error is logged",
	);
	assert.deepEqual(await router.navigationSettled(), {
		status: NavigationOutcome.Committed,
		route: "forbidden",
		hash: "forbidden",
	});
});
