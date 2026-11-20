import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardContext, GuardRedirect, GuardRouter, Router$NavigationSettledEvent } from "ui5/guard/router/types";
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
