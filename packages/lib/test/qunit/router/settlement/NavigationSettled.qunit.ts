import HashChanger from "sap/ui/core/routing/HashChanger";
import type {
	GuardContext,
	GuardRedirect,
	GuardRouter,
	NavigationResult,
	Router$NavigationSettledEvent,
} from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { Router$BypassedEvent } from "sap/ui/core/routing/Router";
import {
	flushPromises,
	recordSettlements,
	type SinonTestContext,
	waitForRoute,
	routerHooks,
	getHash,
} from "../../testHelpers";

let router: GuardRouter;

const standardHooks = routerHooks(
	(created) => {
		router = created;
	},
	() => router,
);

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

QUnit.test(
	"attachNavigationSettled and attachRouteMatched pass data and listener, with and without data",
	async function (assert: Assert) {
		const data = { id: "data" };
		const listener = { id: "listener" };
		const calls: string[] = [];
		function record(this: unknown, event: { getId(): string }, eventData?: unknown): void {
			calls.push(`${event.getId()} ${this === listener} ${eventData === data}`);
		}
		router.attachNavigationSettled(data, record, listener);
		router.attachNavigationSettled(record, listener);
		router.attachRouteMatched(data, record, listener);
		router.attachRouteMatched(record, listener);

		router.initialize();
		await waitForRoute(router, "home");
		await flushPromises();

		assert.deepEqual(calls.toSorted(), [
			"navigationSettled true false",
			"navigationSettled true true",
			"routeMatched true false",
			"routeMatched true true",
		]);
	},
);

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
	assert.strictEqual(getHash(), "", "Browser hash unchanged (preflight blocked before hash update)");
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

QUnit.test(
	"Resolves at once with the last settlement while an allowed navigation writes its hash",
	async function (assert: Assert) {
		let whileCommitting: Promise<NavigationResult> | undefined;
		let navigating = false;
		// Attached before initialize(), so it runs before the router receives the hash change.
		router.getHashChanger().attachEvent("hashChanged", () => {
			if (navigating) whileCommitting = router.navigationSettled();
		});
		router.initialize();
		await waitForRoute(router, "home");

		navigating = true;
		router.navTo("protected");
		navigating = false;
		assert.deepEqual(
			await whileCommitting,
			{ status: NavigationOutcome.Committed, route: "home", hash: "" },
			"the navigation was guarded already, so nothing was pending",
		);
	},
);

// ============================================================
// Module: Restore and settlement invariants
// ============================================================
QUnit.module("Router - Restore and settlement invariants", standardHooks);

QUnit.test(
	"a blocked hash change that is reported without the hash before it is undone to the empty hash",
	async function (this: SinonTestContext, assert: Assert) {
		router.addRouteGuard("protected", () => false);
		router.initialize();
		await waitForRoute(router, "home");
		// UI5 reports the first hash change of a page without oldHash.
		const fireEvent = this.stub(HashChanger.getInstance(), "fireEvent").callsFake(function (
			this: HashChanger,
			...args
		) {
			if (args[0] === "hashChanged") Reflect.deleteProperty(args[1] ?? {}, "oldHash");
			return fireEvent.wrappedMethod.apply(this, args);
		});

		HashChanger.getInstance().setHash("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Blocked, "the hash change is blocked");
		assert.strictEqual(getHash(), "", "and undone to the empty hash");
	},
);

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
	assert.strictEqual(getHash(), "", "Browser hash was restored to the previous value");
	assert.notOk(matched, "Suppressed restore parse did not fire patternMatched on the blocked target");
});

QUnit.test(
	"Async navTo started from a Blocked settlement handler is not undone by the hash restore",
	async function (assert: Assert) {
		router.addRouteGuard("protected", () => false);
		router.addRouteGuard("forbidden", () => Promise.resolve(true));
		router.initialize();
		await waitForRoute(router, "home");

		router.attachNavigationSettled(function handler(event: Router$NavigationSettledEvent) {
			if (event.getParameter("status") !== NavigationOutcome.Blocked) return;
			router.detachNavigationSettled(handler);
			// The router has restored the hash of the blocked navigation by now.
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
		assert.strictEqual(getHash(), "forbidden");
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
			status: event.getParameter("status"),
			route: event.getParameter("route"),
			hash: event.getParameter("hash"),
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
			status: event.getParameter("status"),
			route: event.getParameter("route"),
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
			status: event.getParameter("status"),
			route: event.getParameter("route"),
			hash: event.getParameter("hash"),
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
		events.push(event.getParameter("status"));
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
			events.push(event.getParameter("status"));
		};

		router.attachNavigationSettled(handler);
		router.initialize();
		await waitForRoute(router, "home");
		assert.strictEqual(events.length, 1, "Handler received initial settlement");

		router.detachNavigationSettled(handler);

		router.navTo("forbidden");
		await router.navigationSettled();
		assert.strictEqual(events.length, 1, "Handler no longer receives events after detach without oListener");
	},
);
