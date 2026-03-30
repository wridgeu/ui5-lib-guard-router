import HashChanger from "sap/ui/core/routing/HashChanger";
import type {
	GuardContext,
	GuardFn,
	GuardRedirect,
	GuardRouter,
	Router$NavigationSettledEvent,
} from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { Router$BypassedEvent } from "sap/ui/core/routing/Router";
import { createRouter, initHashChanger, nextTick, waitForRoute } from "./testHelpers";

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

const safeDestroyHooks = {
	beforeEach: standardHooks.beforeEach,
	afterEach: function () {
		try {
			router.destroy();
		} catch {
			/* already destroyed */
		}
		HashChanger.getInstance().setHash("");
	},
};

// ============================================================
// Module: navigationSettled()
// ============================================================
QUnit.module("Router - navigationSettled()", standardHooks);

QUnit.test("Resolves immediately with 'committed' when nothing pending", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "Status is committed");
	assert.strictEqual(result.route, "home", "Route is current route");
	assert.strictEqual(result.hash, "", "Hash is current hash");
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
	router.addRouteGuard("protected", () => {
		return new Promise((resolve) => setTimeout(() => resolve(true), 100));
	});
	router.initialize();
	await waitForRoute(router, "home");

	// Start slow navigation
	router.navTo("protected");
	const settledPromise = router.navigationSettled();

	// Supersede with immediate navigation
	router.navTo("forbidden");
	await waitForRoute(router, "forbidden");

	const result = await settledPromise;
	assert.strictEqual(result.status, NavigationOutcome.Cancelled, "Status is cancelled");
	assert.strictEqual(result.route, "home", "Route is the route active when cancelled");
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
	assert.strictEqual(result1.status, NavigationOutcome.Committed, "First caller gets committed");
	assert.strictEqual(result2.status, NavigationOutcome.Committed, "Second caller gets committed");
	assert.strictEqual(result3.status, NavigationOutcome.Committed, "Third caller gets committed");
	assert.strictEqual(result1.route, result2.route, "All callers get the same route");
	assert.strictEqual(result2.route, result3.route, "All callers get the same route");
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

QUnit.test("Leave guard block produces 'blocked' status", async function (assert: Assert) {
	router.addLeaveGuard("home", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Leave guard block is reflected");
	assert.strictEqual(result.route, "home", "Route stays on home");
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
	router.addRouteGuard("protected", () => {
		return new Promise((resolve) => setTimeout(() => resolve(true), 200));
	});
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
	router.addRouteGuard("protected", async (context: GuardContext) => {
		capturedSignal = context.signal;
		await nextTick(200);
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const settledPromise = router.navigationSettled();
	await nextTick(10);
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
	router.addRouteGuard("protected", () => {
		return new Promise((resolve) => setTimeout(() => resolve(true), 100));
	});
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
});

QUnit.test("Async redirect to nonexistent route settles as blocked", async function (assert: Assert) {
	router.addRouteGuard("protected", async () => {
		await nextTick(10);
		return "nonExistentRoute";
	});
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

	await nextTick();
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
	await nextTick();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Navigation settled as blocked");
	assert.strictEqual(result.route, "home", "Current route stayed on home");
	assert.strictEqual(result.hash, "", "Settlement hash stayed on the previous hash");
	assert.strictEqual(HashChanger.getInstance().getHash(), "", "Browser hash was restored to the previous value");
	assert.notOk(matched, "Suppressed restore parse did not fire patternMatched on the blocked target");
});

// ============================================================
// Module: Destroy during redirect
// ============================================================
QUnit.module("Router - Destroy during redirect", safeDestroyHooks);

QUnit.test(
	"Destroying router while async guard is evaluating a redirect does not throw",
	async function (assert: Assert) {
		router.addRouteGuard("protected", async () => {
			await nextTick(50);
			return "forbidden"; // redirect
		});
		router.initialize();
		await waitForRoute(router, "home");

		router.navTo("protected");
		await nextTick(10); // guard still pending (50ms)
		router.destroy();

		// Wait for the guard promise to resolve in the background
		await nextTick(200);
		assert.ok(true, "No errors thrown after destroy during pending redirect");
	},
);

QUnit.test("Destroy during redirect settles pending navigationSettled as cancelled", async function (assert: Assert) {
	router.addRouteGuard("protected", async () => {
		await nextTick(100);
		return "forbidden"; // redirect
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const settledPromise = router.navigationSettled();
	await nextTick(10); // guard still pending (100ms)
	router.destroy();

	const result = await settledPromise;
	assert.strictEqual(
		result.status,
		NavigationOutcome.Cancelled,
		"Settlement is cancelled on destroy during redirect",
	);
});

// ============================================================
// Module: navigationSettled after destroy
// ============================================================
QUnit.module("Router - navigationSettled after destroy", safeDestroyHooks);

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

QUnit.test("navigationSettled resolves for pending navigation when destroy is called", async function (assert: Assert) {
	router.addRouteGuard("protected", async () => {
		await nextTick(200);
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const settledPromise = router.navigationSettled();
	await nextTick(10); // guard still pending (200ms)
	router.destroy();

	const result = await settledPromise;
	assert.strictEqual(
		result.status,
		NavigationOutcome.Cancelled,
		"Pending settlement resolved as cancelled on destroy",
	);
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
		router.addLeaveGuard("home", async () => {
			await nextTick(10);
			return true;
		});
		router.addRouteGuard("protected", async () => {
			await nextTick(10);
			return "forbidden";
		});
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

	const events: { status: string }[] = [];
	router.attachNavigationSettled((event) => {
		events.push({ status: event.getParameter("status") as string });
	});

	router.navTo("protected");
	await router.navigationSettled();

	assert.ok(
		events.some((e) => e.status === NavigationOutcome.Redirected),
		"At least one event has Redirected status",
	);
});

QUnit.test("fires on cancelled navigation", async function (assert) {
	router.addGuard(() => new Promise<boolean>((r) => setTimeout(() => r(true), 100)));
	router.initialize();
	await waitForRoute(router, "home");

	const events: { status: string }[] = [];
	router.attachNavigationSettled((event) => {
		events.push({ status: event.getParameter("status") as string });
	});

	router.navTo("protected");
	router.navTo("home"); // cancels first

	await router.navigationSettled();

	assert.ok(
		events.some((e) => e.status === NavigationOutcome.Cancelled),
		"Cancelled event fired",
	);
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
	await nextTick();

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

QUnit.test("router recovers when redirect target throws", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	// Guard redirects to "detail" without providing mandatory {id} parameter.
	// super.navTo() throws for missing mandatory params, which must not leave
	// the router in a broken state.
	const redirectGuard: GuardFn = () => "detail";
	router.addRouteGuard("protected", redirectGuard);

	let threw = false;
	try {
		router.navTo("protected");
	} catch {
		threw = true;
	}
	assert.ok(threw, "navTo threw when redirect target has missing mandatory parameters");

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
	const result = await Promise.race([
		router.navigationSettled(),
		new Promise<never>((_, reject) =>
			setTimeout(
				() => reject(new Error("navigationSettled() never resolved after async redirect failure")),
				1000,
			),
		),
	]);

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
	router.addGuard(throwingGuard);
	router.initialize();

	router.navTo("protected");
	const errorResult = await router.navigationSettled();
	assert.strictEqual(errorResult.status, NavigationOutcome.Error, "First settlement is Error");

	// Remove guard and query idle settlement
	router.removeGuard(throwingGuard);
	const replay = await router.navigationSettled();
	assert.strictEqual(replay.status, NavigationOutcome.Error, "Replay returns Error");
	assert.strictEqual(replay.error, thrownError, "Replay includes the error");
});
