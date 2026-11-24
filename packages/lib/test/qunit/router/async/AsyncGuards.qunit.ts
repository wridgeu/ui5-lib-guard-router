import Log from "sap/base/Log";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardContext, GuardRouter } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { Router$RouteMatchedEvent } from "sap/ui/core/routing/Router";
import {
	addGuardUnsafe,
	assertBlocked,
	captureWarningsAsync,
	flushPromises,
	getHash,
	isMatching,
	recordSettlements,
	type SinonTestContext,
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

QUnit.module("Router - Sync until a guard returns a Promise", standardHooks);

QUnit.test("an all-sync navTo commits before navTo returns", async function (assert) {
	router.addGuard(() => true);
	router.addRouteGuard("protected", () => true);
	router.initialize();
	await waitForRoute(router, "home");
	const settled = recordSettlements(router);

	router.navTo("protected");

	assert.strictEqual(getHash(), "protected", "hash changed in the same tick");
	assert.deepEqual(settled, [NavigationOutcome.Committed], "settled in the same tick");
});

QUnit.test("an all-sync hash change commits before setHash returns", async function (assert) {
	router.addRouteGuard("protected", () => true);
	router.initialize();
	await waitForRoute(router, "home");
	const settled = recordSettlements(router);

	HashChanger.getInstance().setHash("protected");

	assert.deepEqual(settled, [NavigationOutcome.Committed], "settled in the same tick");
});

QUnit.test("a sync block settles before navTo returns", async function (assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");
	const settled = recordSettlements(router);

	router.navTo("protected");

	assert.strictEqual(getHash(), "", "hash unchanged");
	assert.deepEqual(settled, [NavigationOutcome.Blocked], "settled in the same tick");
});

QUnit.test("a sync block on a hash change restores the hash before setHash returns", async function (assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");
	const settled = recordSettlements(router);

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
	const settled = recordSettlements(router);

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

	const settled = recordSettlements(router);
	router.navTo("forbidden");
	assert.strictEqual(getHash(), "forbidden", "committed in the same tick");
	assert.deepEqual(settled, [NavigationOutcome.Committed]);
});

QUnit.test("an all-sync redirect chain finishes before navTo returns, with one settlement", async function (assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => ({ route: "detail", parameters: { id: "1" } }));
	router.initialize();
	await waitForRoute(router, "home");
	const settled = recordSettlements(router);

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
	const settled = recordSettlements(router);

	router.navTo("protected");

	assert.strictEqual(detailCalls, 0, "the hop after the async one has not run yet");
	assert.deepEqual(settled, [], "not settled yet");
	assert.strictEqual(getHash(), "", "hash unchanged yet");

	assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Redirected);
	assert.strictEqual(detailCalls, 1);
	assert.strictEqual(getHash(), "detail/1");
	assert.deepEqual(settled, [NavigationOutcome.Redirected], "one settlement for the whole chain");
});

QUnit.module("Router - Mixed sync/async guard pipelines", standardHooks);

QUnit.test("Sync global guard allows, async route guard allows", async function (assert: Assert) {
	router.addGuard(() => true);
	router.addRouteGuard("protected", async () => true);
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(getHash(), "protected", "Navigation allowed through sync global + async route guard");
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
	assert.strictEqual(getHash(), "protected", "Navigation allowed through async global + sync route guard");
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
	const result = await router.navigationSettled();
	assert.deepEqual(
		{ status: result.status, route: result.route, hash: result.hash },
		{ status: NavigationOutcome.Redirected, route: "home", hash: "" },
		"Sync route guard redirected after async global allowed",
	);
});

QUnit.module("Router - Guard context across navigations", standardHooks);

QUnit.test("Guard context has correct fromRoute and fromHash after prior navigation", async function (assert: Assert) {
	let capturedContext: GuardContext | null = null;
	router.initialize();

	router.navTo("detail", { id: "42" });
	await waitForRoute(router, "detail");

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
	"Multiple async guards - the first that blocks short-circuits the remaining",
	async function (assert: Assert) {
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
		assert.deepEqual(order, [1, 2], "Third guard was short-circuited after the second blocked");
	},
);

QUnit.test("Async guard returning invalid value treats as block", async function (assert: Assert) {
	addGuardUnsafe(router, async () => 42);
	router.initialize();
	await assertBlocked(assert, router, () => router.navTo("protected"), "Async invalid guard return treated as block");
});

QUnit.test("an invalid value from the guard of a superseded navigation is not logged", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");
	const pending = Promise.withResolvers<unknown>();
	addGuardUnsafe(router, (context: GuardContext) => (context.toRoute === "protected" ? pending.promise : true));
	router.navTo("protected");
	router.navTo("detail", { id: "1" });
	await waitForRoute(router, "detail");

	const warnings = await captureWarningsAsync(async () => {
		pending.resolve(42);
		await flushPromises();
	});
	assert.deepEqual(warnings, [], "no warning for the discarded result");
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

QUnit.module("Router - Async leave guard abort check before enter phase", standardHooks);

QUnit.test(
	"enter guards do not run for superseded navigation after async leave guard resolves",
	async function (assert: Assert) {
		let enterGuardCalls = 0;

		router.initialize();
		await waitForRoute(router, "home");

		const leaveResolvers: Array<(value: boolean) => void> = [];
		router.addLeaveGuard(
			"home",
			() =>
				new Promise<boolean>((resolve) => {
					leaveResolvers.push(resolve);
				}),
		);

		router.addRouteGuard("protected", () => {
			enterGuardCalls++;
			return true;
		});

		router.navTo("protected");

		// Supersede: navigate via setHash to trigger the parse() path (browser-initiated
		// navigation) rather than the navTo preflight path.
		// This cancels the first navigation's pipeline.
		HashChanger.getInstance().setHash("forbidden");
		leaveResolvers[1](true);
		await waitForRoute(router, "forbidden");

		// The enter guard for "protected" should NOT fire because the signal is aborted.
		leaveResolvers[0](true);
		await flushPromises();

		assert.strictEqual(enterGuardCalls, 0, "No enter guard ran for the superseded navigation");
	},
);

QUnit.module("Router - Native matching flag", standardHooks);

// A canary for UI5 itself: the router mirrors the private member `_bMatchingProcessStarted`, so
// this fails if UI5 renames it or stops writing it.
QUnit.test("UI5 sets the flag for the time of a route match", async function (assert) {
	router.initialize();
	await waitForRoute(router, "home");
	assert.strictEqual(isMatching(router), false, "no match is in progress");

	router.navTo("protected");
	assert.strictEqual(isMatching(router), true, "UI5 set the flag within navTo");

	await waitForRoute(router, "protected");
	assert.strictEqual(isMatching(router), false, "UI5 cleared the flag before the route events");
});

QUnit.test(
	"the flag is set while a navigation waits for async guards, until it ends without a match",
	async function (this: SinonTestContext, assert) {
		let decision: { resolve: (allowed: boolean) => void; reject: (error: Error) => void } | undefined;
		router.addRouteGuard(
			"protected",
			() =>
				new Promise<boolean>((resolve, reject) => {
					decision = { resolve, reject };
				}),
		);
		router.initialize();
		await waitForRoute(router, "home");

		const endings: [status: string, end: () => void][] = [
			[NavigationOutcome.Blocked, () => decision?.resolve(false)],
			[NavigationOutcome.Error, () => decision?.reject(new Error("guard failed"))],
			[NavigationOutcome.Cancelled, () => router.navTo("home")],
		];
		this.stub(Log, "error");
		for (const [status, end] of endings) {
			router.navTo("protected");
			assert.strictEqual(isMatching(router), true, `set while navTo waits for the guard (${status})`);
			end();
			const settled = await router.navigationSettled();
			assert.strictEqual(settled.status, status, `the navigation settles as ${status}`);
			assert.strictEqual(isMatching(router), false, `cleared by the ${status} settlement`);
		}

		HashChanger.getInstance().setHash("protected");
		assert.strictEqual(isMatching(router), true, "set while a hash change waits for the guard");
		router.stop();
		assert.strictEqual(isMatching(router), false, "cleared by stop()");
	},
);

QUnit.test("guards that decide synchronously do not set the flag", async function (assert) {
	let duringGuard: unknown;
	router.addRouteGuard("forbidden", () => {
		duringGuard = isMatching(router);
		return false;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("forbidden");

	assert.strictEqual(duringGuard, false, "not set while the guard runs: UI5 has not matched a route yet");
	assert.strictEqual(isMatching(router), false, "not set after the block");
});

QUnit.test(
	"a Promise that waits for routeMatched during pending guards resolves when the navigation is blocked",
	async function (assert) {
		let allow: (allowed: boolean) => void = () => {};
		router.addRouteGuard(
			"protected",
			() =>
				new Promise<boolean>((resolve) => {
					allow = resolve;
				}),
		);
		router.initialize();
		await waitForRoute(router, "home");
		const handler = sinon.spy();

		router.navTo("protected");
		router.attachRouteMatched(handler);
		// A component target waits for a nested router like this.
		const matched = new Promise((resolve) => {
			router.attachRouteMatched(resolve);
		});
		allow(false);
		await router.navigationSettled();

		assert.strictEqual(await matched, undefined, "the Promise resolved without a routeMatched event");
		assert.strictEqual(handler.callCount, 0, "the handler was not called: no route matched");
	},
);

QUnit.test(
	"a Promise that waits for routeMatched keeps waiting while the navigation that took over waits for guards",
	async function (assert) {
		let allow: (allowed: boolean) => void = () => {};
		const pending = (): Promise<boolean> =>
			new Promise<boolean>((resolve) => {
				allow = resolve;
			});
		router.addRouteGuard("protected", pending);
		router.addRouteGuard("forbidden", pending);
		router.initialize();
		await waitForRoute(router, "home");
		const statuses = recordSettlements(router);

		router.navTo("protected");
		let resolved = false;
		void new Promise((resolve) => {
			router.attachRouteMatched(resolve);
		}).then(() => {
			resolved = true;
		});
		router.navTo("forbidden");
		await flushPromises();
		assert.deepEqual(statuses, [NavigationOutcome.Cancelled], "the first navigation was cancelled");
		assert.notOk(resolved, "the Promise still waits: the second navigation may end in a route match");

		allow(false);
		await flushPromises();
		assert.ok(resolved, "the Promise resolved when the second navigation was blocked");
	},
);

QUnit.test(
	"a Promise that waits for routeMatched while no match is pending resolves with the next match",
	async function (assert) {
		router.addRouteGuard("forbidden", () => false);
		router.initialize();
		await waitForRoute(router, "home");
		const resolved: (Router$RouteMatchedEvent | undefined)[] = [];
		const matched = new Promise<Router$RouteMatchedEvent | undefined>((resolve) => {
			router.attachRouteMatched(resolve);
		}).then((event) => {
			resolved.push(event);
		});

		router.navTo("forbidden");
		await flushPromises();
		assert.strictEqual(resolved.length, 0, "a blocked navigation does not resolve it");

		router.navTo("protected");
		await matched;
		assert.strictEqual(resolved[0]?.getParameter("name"), "protected", "the next routeMatched does");
	},
);
