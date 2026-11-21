import HashChanger from "sap/ui/core/routing/HashChanger";
import History from "sap/ui/core/routing/History";
import type { GuardRouter, NavigationResult, Router$NavigationSettledEvent } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import {
	captureHashWrites,
	createRouter,
	flushPromises,
	getHash,
	type GuardRouterClass,
	loadModule,
	recordSettlements,
	type SinonTestContext,
	waitForRoute,
	routerHooks,
} from "../../testHelpers";

/**
 * Steps through the real browser history (back, forward). A page of their own: Chrome ignores
 * history steps once a page has changed the hash about 200 times within ten seconds.
 */

let router: GuardRouter;

QUnit.module(
	"Router - Browser history",
	routerHooks(
		(created) => {
			router = created;
		},
		() => router,
	),
);

/** The next settlement of the router: a history step reaches the router in a later task. */
function nextSettlement(): Promise<NavigationResult> {
	return new Promise((resolve) => {
		router.attachEventOnce("navigationSettled", (event: Router$NavigationSettledEvent) => {
			resolve(event.getParameters());
		});
	});
}

/** Take `step` through the browser history and return how the navigation it causes settles. */
async function historyStep(step: () => void): Promise<NavigationResult> {
	const settled = nextSettlement();
	step();
	return settled;
}

/** Take `step` through the browser history and resolve once the router has received `hash`. */
function historyStepTo(step: () => void, hash: string): Promise<void> {
	return new Promise((resolve) => {
		// The browser may still report the hash changes of earlier navTo() calls.
		const onHashChange = (): void => {
			if (getHash() !== hash) return;
			window.removeEventListener("hashchange", onHashChange);
			resolve();
		};
		window.addEventListener("hashchange", onHashChange);
		step();
	});
}

async function navTo(route: string, parameters?: object): Promise<void> {
	router.navTo(route, parameters);
	await waitForRoute(router, route);
}

QUnit.test("a blocked browser back leaves the history as it was", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");
	await navTo("protected");
	const leaveGuard = (): boolean => false;
	router.addLeaveGuard("protected", leaveGuard);

	let blocked: NavigationResult | undefined;
	const writes = await captureHashWrites(HashChanger.getInstance(), async () => {
		blocked = await historyStep(() => window.history.back());
	});

	assert.deepEqual(
		blocked,
		{ status: NavigationOutcome.Blocked, route: "protected", hash: "protected" },
		"the navigation is blocked",
	);
	assert.strictEqual(getHash(), "protected", "the URL is back when the navigation settles");
	assert.deepEqual(writes, [], "no hash is written: the browser stepped forward again");
	assert.strictEqual(History.getInstance().getPreviousHash(), "", "UI5 still knows the entry before");

	router.removeLeaveGuard("protected", leaveGuard);
	const back = await historyStep(() => window.history.back());
	assert.deepEqual(
		back,
		{ status: NavigationOutcome.Committed, route: "home", hash: "" },
		"the next back arrives at the entry before",
	);
	const forward = await historyStep(() => window.history.forward());
	assert.deepEqual(
		forward,
		{ status: NavigationOutcome.Committed, route: "protected", hash: "protected" },
		"and forward at the entry that was left",
	);
});

QUnit.test("a blocked browser forward leaves the history as it was", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");
	await navTo("protected");
	await navTo("forbidden");
	await historyStep(() => window.history.back());
	assert.strictEqual(getHash(), "protected", "one step back");
	const guard = (): boolean => false;
	router.addRouteGuard("forbidden", guard);

	let blocked: NavigationResult | undefined;
	let hashWhenSettled: string | undefined;
	const writes = await captureHashWrites(HashChanger.getInstance(), async () => {
		await historyStepTo(() => window.history.forward(), "forbidden");
		// The router has blocked the navigation, and the browser has not stepped back yet.
		blocked = await router.navigationSettled();
		hashWhenSettled = getHash();
	});

	assert.strictEqual(blocked?.status, NavigationOutcome.Blocked, "the navigation is blocked");
	assert.strictEqual(hashWhenSettled, "protected", "navigationSettled() waits until the URL is back");
	assert.deepEqual(writes, [], "no hash is written: the browser stepped back again");

	router.removeRouteGuard("forbidden", guard);
	const forward = await historyStep(() => window.history.forward());
	assert.strictEqual(forward.hash, "forbidden", "the entry ahead is still there");
});

QUnit.test(
	"a blocked step over several history entries is taken back as far as it went",
	async function (assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");
		await navTo("protected");
		await navTo("forbidden");
		await navTo("detail", { id: "1" });
		const leaveGuard = (): boolean => false;
		router.addLeaveGuard("detail", leaveGuard);

		let blocked: NavigationResult | undefined;
		const writes = await captureHashWrites(HashChanger.getInstance(), async () => {
			blocked = await historyStep(() => window.history.go(-2));
		});

		assert.strictEqual(blocked?.status, NavigationOutcome.Blocked, "the navigation is blocked");
		assert.strictEqual(getHash(), "detail/1", "the URL is back on the entry that was left");
		assert.deepEqual(writes, [], "no hash is written");

		router.removeLeaveGuard("detail", leaveGuard);
		const back = await historyStep(() => window.history.back());
		assert.strictEqual(back.hash, "forbidden", "one step back arrives at the entry right before");
	},
);

QUnit.test(
	"two history steps of which the second supersedes the first are taken back together",
	async function (assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");
		await navTo("protected");
		await navTo("forbidden");
		await navTo("detail", { id: "1" });
		const decisions: ((allowed: boolean) => void)[] = [];
		const leaveGuard = (): Promise<boolean> => new Promise((resolve) => decisions.push(resolve));
		router.addLeaveGuard("detail", leaveGuard);

		// The first step back arrives, and its navigation waits for the guard.
		await historyStepTo(() => window.history.back(), "forbidden");
		assert.strictEqual(getHash(), "forbidden", "one step back");
		const cancelled = await historyStep(() => window.history.back());
		assert.strictEqual(cancelled.status, NavigationOutcome.Cancelled, "the second step cancels the first");
		assert.strictEqual(getHash(), "protected", "two steps back");

		let blocked: NavigationResult | undefined;
		const writes = await captureHashWrites(HashChanger.getInstance(), async () => {
			blocked = await historyStep(() => decisions.at(-1)?.(false));
		});

		assert.strictEqual(blocked?.status, NavigationOutcome.Blocked, "the navigation is blocked");
		assert.strictEqual(getHash(), "detail/1", "the URL is back on the entry that was left");
		assert.deepEqual(writes, [], "no hash is written: the browser took both steps back");
	},
);

QUnit.test(
	"a history step that is redirected to the route that is shown is taken back",
	async function (assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");
		await navTo("protected");
		await navTo("forbidden");
		router.addRouteGuard("protected", () => "forbidden");
		const matched: string[] = [];
		router.attachRouteMatched((event) => matched.push(String(event.getParameter("name"))));

		let redirected: NavigationResult | undefined;
		const writes = await captureHashWrites(HashChanger.getInstance(), async () => {
			redirected = await historyStep(() => window.history.back());
		});

		assert.deepEqual(
			redirected,
			{ status: NavigationOutcome.Redirected, route: "forbidden", hash: "forbidden" },
			"the navigation settles as Redirected",
		);
		assert.strictEqual(getHash(), "forbidden", "the URL is back");
		assert.deepEqual(writes, [], "no hash is written");
		assert.deepEqual(matched, [], "the route that is shown does not match again");
	},
);

QUnit.test("a history step that is redirected has its entry replaced with the target", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");
	await navTo("protected");
	await navTo("forbidden");
	router.addRouteGuard("protected", () => ({ route: "detail", parameters: { id: "7" } }));

	let redirected: NavigationResult | undefined;
	const writes = await captureHashWrites(HashChanger.getInstance(), async () => {
		redirected = await historyStep(() => window.history.back());
	});

	assert.strictEqual(redirected?.status, NavigationOutcome.Redirected, "the navigation is redirected");
	assert.deepEqual(writes, ["replace:detail/7"], "the entry of the guarded route is replaced");
	const back = await historyStep(() => window.history.back());
	assert.strictEqual(back.hash, "", "the entry before it is untouched");
});

QUnit.test(
	"a hash change that is not a history step is undone by replacing its entry",
	async function (assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");
		await navTo("protected");
		await navTo("forbidden");
		// The last step through the history: a later hash change must not be taken for it.
		await historyStep(() => window.history.back());
		router.addRouteGuard("forbidden", () => false);

		const hashChanger = HashChanger.getInstance();
		const writes = await captureHashWrites(hashChanger, () => {
			hashChanger.setHash("forbidden");
		});

		assert.deepEqual(
			writes,
			["set:forbidden", "replace:protected"],
			"the new entry is replaced, the browser takes no step",
		);
		assert.strictEqual(getHash(), "protected", "the URL is back");
	},
);

QUnit.test(
	"a hash that is replaced with the one a history step arrived at is not taken for that step",
	async function (assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");
		await navTo("protected");
		await navTo("forbidden");
		await historyStep(() => window.history.back());
		router.addRouteGuard("protected", () => false);

		// Both in one task: the browser has reported neither when the router restores the hash.
		const hashChanger = HashChanger.getInstance();
		const writes = await captureHashWrites(hashChanger, () => {
			hashChanger.setHash("forbidden");
			hashChanger.replaceHash("protected", "Unknown");
		});

		assert.deepEqual(
			writes,
			["set:forbidden", "replace:protected", "replace:forbidden"],
			"the entry is replaced, the browser takes no step",
		);
		assert.strictEqual(getHash(), "forbidden", "the URL is back on the committed hash");
	},
);

QUnit.test(
	"a navTo() while a blocked history step is taken back settles the blocked navigation first",
	async function (assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");
		await navTo("protected");
		const block = (): boolean => false;
		router.addLeaveGuard("protected", block);
		const statuses = recordSettlements(router);

		await historyStepTo(() => window.history.back(), "");
		router.removeLeaveGuard("protected", block);
		router.navTo("forbidden");

		assert.deepEqual(
			statuses,
			[NavigationOutcome.Blocked, NavigationOutcome.Committed],
			"the blocked navigation settles, then the new one",
		);
		assert.strictEqual(getHash(), "forbidden", "the new navigation moved the URL");

		// The entry that the browser was to step forward to is gone. A later step is taken back as usual.
		router.addLeaveGuard("forbidden", block);
		const blocked = await historyStep(() => window.history.back());
		assert.deepEqual(
			blocked,
			{ status: NavigationOutcome.Blocked, route: "forbidden", hash: "forbidden" },
			"the next blocked step back settles",
		);
		assert.strictEqual(getHash(), "forbidden", "with the URL back");
	},
);

QUnit.test(
	"a history step whose entry has its state replaced before the router learns of it is still taken back",
	async function (assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");
		await navTo("protected");
		router.addLeaveGuard("protected", () => false);
		// UI5's History does this when it is informed of a hash change before the router.
		const saveState = (): void => window.history.replaceState(window.history.state, "");
		window.addEventListener("popstate", saveState, { once: true });

		let blocked: NavigationResult | undefined;
		const writes = await captureHashWrites(HashChanger.getInstance(), async () => {
			blocked = await historyStep(() => window.history.back());
		});

		assert.strictEqual(blocked?.status, NavigationOutcome.Blocked, "the navigation is blocked");
		assert.strictEqual(getHash(), "protected", "the URL is back");
		assert.deepEqual(writes, [], "no hash is written: the browser stepped forward again");
	},
);

QUnit.test(
	"a history step that is redirected to the route that is shown sets the hashes of nested components once the URL is back",
	async function (this: SinonTestContext, assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");
		await navTo("protected");
		await navTo("detail", { id: "7" });
		router.addRouteGuard("protected", () => ({
			route: "detail",
			parameters: { id: "7" },
			componentTargetInfo: { nested: { route: "list" } },
		}));
		// UI5 writes the hash of the route with those of the components in its component targets.
		const hashChanger = HashChanger.getInstance();
		const writes: string[] = [];
		const replaceHash = this.stub(hashChanger, "replaceHash").callsFake(function (this: HashChanger, ...args) {
			writes.push(`replace:${args[0]} on ${getHash()}`);
			return replaceHash.wrappedMethod.apply(this, args);
		});
		const setHash = this.spy(hashChanger, "setHash");

		const redirected = await historyStep(() => window.history.back());
		await flushPromises();

		assert.strictEqual(redirected.status, NavigationOutcome.Redirected, "the navigation settles as Redirected");
		assert.strictEqual(getHash(), "detail/7", "the URL is back");
		assert.deepEqual(
			writes,
			["replace:detail/7 on detail/7"],
			"UI5 is asked to set the hashes once the URL is back, not while the browser steps",
		);
		assert.ok(setHash.notCalled, "no history entry is added");
	},
);

QUnit.test(
	"a parse() of the committed hash while a blocked history step is taken back matches its route again",
	async function (assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");
		await navTo("protected");
		router.addLeaveGuard("protected", () => false);
		const statuses = recordSettlements(router);
		await historyStepTo(() => window.history.back(), "");
		const matched: string[] = [];
		router.attachRouteMatched((event) => matched.push(String(event.getParameter("name"))));

		const blocked = nextSettlement();
		router.parse("protected");
		assert.deepEqual(statuses, [], "the blocked navigation still waits for the URL to be back");
		await blocked;
		await flushPromises();

		assert.strictEqual(getHash(), "protected", "which it is when the navigation settles");
		assert.deepEqual(statuses, [NavigationOutcome.Blocked]);
		assert.deepEqual(matched, ["protected"], "the route matched again for the parse() call, as it does natively");
	},
);

QUnit.test(
	"a navTo() that is blocked while a blocked history step is taken back leaves the URL to come back",
	async function (assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");
		await navTo("protected");
		router.addLeaveGuard("protected", () => false);
		const statuses = recordSettlements(router);
		await historyStepTo(() => window.history.back(), "");
		const matched: string[] = [];
		router.attachRouteMatched((event) => matched.push(String(event.getParameter("name"))));

		router.navTo("forbidden");
		assert.deepEqual(
			statuses,
			[NavigationOutcome.Blocked, NavigationOutcome.Blocked],
			"the blocked step settles, then the blocked navTo()",
		);
		await historyStepTo(() => {}, "protected");
		await flushPromises();

		assert.deepEqual(statuses, [NavigationOutcome.Blocked, NavigationOutcome.Blocked], "nothing else settles");
		assert.deepEqual(matched, [], "the route that is shown does not match again when the URL is back");
	},
);

QUnit.test(
	"the hash that a blocked history step was taken back to is navigated to as usual after another navigation",
	async function (assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");
		await navTo("protected");
		const block = (): boolean => false;
		router.addLeaveGuard("protected", block);
		await historyStepTo(() => window.history.back(), "");
		router.removeLeaveGuard("protected", block);
		// From the entry before: the entry that the browser was to step forward to is gone.
		await navTo("forbidden");

		HashChanger.getInstance().setHash("protected");
		await flushPromises();

		assert.deepEqual(
			await router.navigationSettled(),
			{ status: NavigationOutcome.Committed, route: "protected", hash: "protected" },
			"the navigation commits",
		);
	},
);

QUnit.test(
	"a parse() call that is blocked after a history step takes no step",
	async function (this: SinonTestContext, assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");
		await navTo("protected");
		await historyStep(() => window.history.back());
		router.addRouteGuard("forbidden", () => false);
		const statuses = recordSettlements(router);
		const go = this.spy(window.history, "go");

		router.parse("forbidden");

		assert.deepEqual(statuses, [NavigationOutcome.Blocked], "it settles at once: no hash change is to be undone");
		assert.ok(go.notCalled, "the browser is not asked to step through the history");
		assert.strictEqual(getHash(), "", "the URL is where the step had arrived");
	},
);

QUnit.test(
	"a blocked history step is taken back after a hash change that ended with the URL back",
	async function (assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");
		await navTo("protected");
		const pending = (): Promise<boolean> => new Promise(() => {});
		router.addLeaveGuard("protected", pending);
		// A hash change that is no history step waits for the guard, and ends when the user steps back.
		HashChanger.getInstance().setHash("forbidden");
		const cancelled = await historyStep(() => window.history.back());
		assert.strictEqual(cancelled.status, NavigationOutcome.Cancelled, "the step back cancels the navigation");
		router.removeLeaveGuard("protected", pending);
		router.addLeaveGuard("protected", () => false);

		let blocked: NavigationResult | undefined;
		const writes = await captureHashWrites(HashChanger.getInstance(), async () => {
			blocked = await historyStep(() => window.history.back());
		});

		assert.strictEqual(blocked?.status, NavigationOutcome.Blocked, "the next step back is blocked");
		assert.strictEqual(getHash(), "protected", "the URL is back");
		assert.deepEqual(writes, [], "no hash is written: the browser stepped forward again");
	},
);

QUnit.test("stop() forgets a history step that is being taken back", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");
	await navTo("protected");
	router.addLeaveGuard("protected", () => false);

	// The router blocks the step and asks the browser to take it back. It stops before that happens.
	await historyStepTo(() => window.history.back(), "");
	router.stop();
	await historyStepTo(() => {}, "protected");

	const statuses = recordSettlements(router);
	router.initialize();
	assert.deepEqual(statuses, [NavigationOutcome.Committed], "a router that starts again parses the hash of the URL");
	assert.deepEqual(
		await router.navigationSettled(),
		{ status: NavigationOutcome.Committed, route: "protected", hash: "protected" },
		"and is on its route",
	);
});

// On this page because Chrome also drops hash replacements once a page has changed the hash too often.
QUnit.test(
	"a router that is informed third ignores every report that is out of date after two routers have redirected",
	async function (assert: Assert) {
		// Routers without a component share the hash changer of the root: UI5 informs them in the order they started.
		const second = createRouter();
		const third = createRouter();
		const matched: string[] = [];
		third.attachRouteMatched((event) => matched.push(String(event.getParameter("name"))));
		try {
			router.addRouteGuard("protected", () => "forbidden");
			second.addRouteGuard("forbidden", () => ({ route: "detail", parameters: { id: "1" } }));
			for (const each of [router, second, third]) each.initialize();
			await flushPromises();

			// UI5 reports "detail/1" to the third router, then "forbidden", then "protected".
			HashChanger.getInstance().setHash("protected");
			await flushPromises();

			assert.strictEqual(getHash(), "detail/1", "the URL shows the target of the second redirect");
			assert.deepEqual(matched, ["home", "detail"], "the third router matched no hash that was redirected");
			assert.deepEqual(
				await third.navigationSettled(),
				{ status: NavigationOutcome.Committed, route: "detail", hash: "detail/1" },
				"and is on the route that the URL shows",
			);
		} finally {
			second.destroy();
			third.destroy();
		}
	},
);

// Last: it loads a second copy of the library.
QUnit.test(
	"without the Navigation API a blocked history step has its entry replaced",
	async function (this: SinonTestContext, assert: Assert) {
		// The router subscribes to the API when its module loads. Firefox before 147 and Safari
		// before 26.2 have none.
		const navigation = Object.getOwnPropertyDescriptor(window, "navigation");
		if (!navigation) throw new Error("The browser of this test has no Navigation API to hide");
		sap.ui.loader.config({
			paths: { "ui5/guard/router/withoutNavigationApi": sap.ui.require.toUrl("ui5/guard/router") },
		});
		Object.defineProperty(window, "navigation", { value: undefined, configurable: true });
		let RouterWithoutApi: typeof GuardRouterClass;
		try {
			RouterWithoutApi = await loadModule("ui5/guard/router/withoutNavigationApi/Router");
		} finally {
			Object.defineProperty(window, "navigation", navigation);
		}
		const routerWithoutApi = new RouterWithoutApi(
			[
				{ name: "home", pattern: "" },
				{ name: "protected", pattern: "protected" },
			],
			{ async: true },
		);

		try {
			routerWithoutApi.initialize();
			await waitForRoute(routerWithoutApi, "home");
			routerWithoutApi.navTo("protected");
			await waitForRoute(routerWithoutApi, "protected");
			routerWithoutApi.addLeaveGuard("protected", () => false);
			const settled = new Promise<NavigationResult>((resolve) => {
				routerWithoutApi.attachEventOnce("navigationSettled", (event: Router$NavigationSettledEvent) => {
					resolve(event.getParameters());
				});
			});

			let blocked: NavigationResult | undefined;
			const go = this.spy(window.history, "go");
			const writes = await captureHashWrites(HashChanger.getInstance(), async () => {
				window.history.back();
				blocked = await settled;
			});

			assert.deepEqual(
				blocked,
				{ status: NavigationOutcome.Blocked, route: "protected", hash: "protected" },
				"the navigation is blocked",
			);
			assert.deepEqual(
				writes,
				["replace:protected"],
				"the entry that the browser stepped to shows the previous hash",
			);
			assert.ok(go.notCalled, "the router knows of no step to take back");
			assert.strictEqual(getHash(), "protected", "the URL is back");
		} finally {
			routerWithoutApi.destroy();
		}
	},
);
