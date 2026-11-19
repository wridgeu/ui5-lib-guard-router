import HashChanger from "sap/ui/core/routing/HashChanger";
import type { HashChangerBase$HashChangedEvent } from "sap/ui/core/routing/HashChangerBase";
import type { GuardFn, GuardRouter } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import {
	assertBlocked,
	callUnsafe,
	captureErrorsAsync,
	captureHashWrites,
	captureWarningsAsync,
	getHash,
	GuardRouterClass,
	flushPromises,
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
	assert.strictEqual(getHash(), "", "Unguarded route matched via hash change");
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

	assert.strictEqual(getHash(), "", "Hash was restored to home route");
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

QUnit.test(
	"a hash change back to the committed hash matches no route again while an allowed navTo() waits for its hash",
	async function (assert: Assert) {
		const matched: string[] = [];
		const statuses = await supersedePendingHashChange(() => {
			router.attachRouteMatched((event) => matched.push(String(event.getParameter("name"))));
			// With component targets UI5 writes the hash in a later task.
			router.navTo("protected", {}, { nested: { route: "list" } });
			HashChanger.getInstance().setHash("");
		});
		await flushPromises();

		assert.deepEqual(matched, ["protected"], "the route that was never left does not match again");
		assert.deepEqual(statuses, [NavigationOutcome.Cancelled, NavigationOutcome.Committed]);
		assert.strictEqual(getHash(), "protected");
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
	assert.strictEqual(getHash(), "protected", "Second attempt allowed after state change");
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
	assert.strictEqual(getHash(), "protected", "Navigation allowed after guard removed");
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
	assert.strictEqual(getHash(), "", "Cross-redirect chain followed to home");
});

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
// Module: Deferred hash change of component targets
// ============================================================
QUnit.module("Router - Deferred hash change of component targets", standardHooks);

QUnit.test(
	"a navTo() with component targets that is superseded is cancelled, and its deferred hash change is a navigation of its own",
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
		assert.deepEqual(
			statuses,
			[NavigationOutcome.Cancelled],
			"the navigation that waited for its hash is cancelled",
		);
		await flushPromises();
		await flushPromises();
		assert.strictEqual(getHash(), "detail/1", "the deferred hash change arrived");

		allow(true);
		await flushPromises();

		// As with the native router, the hash that is written last decides.
		assert.deepEqual(
			statuses,
			[NavigationOutcome.Cancelled, NavigationOutcome.Cancelled, NavigationOutcome.Committed],
			"the hash change supersedes the navigation that was pending, like any other hash change",
		);
		assert.deepEqual(await router.navigationSettled(), {
			status: NavigationOutcome.Committed,
			route: "detail",
			hash: "detail/1",
		});
		assert.strictEqual(getHash(), "detail/1");
	},
);

QUnit.test("a navTo() with component targets commits when UI5 writes the hash", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");
	const statuses = recordSettlements(router);

	router.navTo("protected", {}, { nested: { route: "list" } });
	assert.deepEqual(statuses, [], "nothing settles while the hash change is on its way");

	assert.deepEqual(await router.navigationSettled(), {
		status: NavigationOutcome.Committed,
		route: "protected",
		hash: "protected",
	});
	assert.strictEqual(getHash(), "protected", "the hash is written by then");
});

/**
 * Start a navTo() with component targets whose hash UI5 never writes, as when a nested component
 * fails to load or the hash changer refuses the hash. Resolves with the status of every settlement since.
 */
async function navToWithoutHashWrite(test: SinonTestContext): Promise<string[]> {
	router.initialize();
	await waitForRoute(router, "home");
	const statuses = recordSettlements(router);
	const setHash = test.stub(router.getHashChanger(), "setHash");
	router.navTo("protected", {}, { nested: { route: "list" } });
	await flushPromises();
	setHash.restore();
	return statuses;
}

QUnit.test(
	"a navTo() with component targets whose hash UI5 never writes does not commit",
	async function (this: SinonTestContext, assert: Assert) {
		let leftRoute: string | undefined;
		router.addRouteGuard("forbidden", (context) => {
			leftRoute = context.fromRoute;
			return true;
		});
		const statuses = await navToWithoutHashWrite(this);
		assert.deepEqual(statuses, [], "the navigation is still pending");

		router.navTo("forbidden");
		await waitForRoute(router, "forbidden");
		assert.deepEqual(statuses, [NavigationOutcome.Cancelled, NavigationOutcome.Committed]);
		assert.strictEqual(leftRoute, "home", "the next navigation leaves the route that is shown");
	},
);

for (const end of ["stop", "destroy"] as const) {
	QUnit.test(
		`${end}() cancels a navTo() with component targets whose hash UI5 never writes`,
		async function (this: SinonTestContext, assert: Assert) {
			const statuses = await navToWithoutHashWrite(this);
			const settled = router.navigationSettled();
			router[end]();
			assert.deepEqual(statuses, [NavigationOutcome.Cancelled]);
			assert.deepEqual(await settled, { status: NavigationOutcome.Cancelled, route: "home", hash: "" });
		},
	);
}

QUnit.test("a navTo() with component targets on a router that is not async does not commit", function (assert: Assert) {
	router.destroy();
	// UI5 rejects component targets on such a router: it logs an error and writes no hash.
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
			{ name: "forbidden", pattern: "forbidden" },
		],
		{ async: false },
	);
	let leftRoute: string | undefined;
	router.addRouteGuard("forbidden", (context) => {
		leftRoute = context.fromRoute;
		return true;
	});
	router.initialize();
	const statuses = recordSettlements(router);

	router.navTo("protected", {}, { nested: { route: "list" } });
	assert.deepEqual(statuses, [], "the navigation is pending");

	router.navTo("forbidden");
	assert.deepEqual(statuses, [NavigationOutcome.Cancelled, NavigationOutcome.Committed]);
	assert.strictEqual(leftRoute, "home", "the next navigation leaves the route that is shown");
});

// ============================================================
// Module: Hash replaced by another listener of the hash change
// ============================================================
QUnit.module("Router - Hash replaced by another listener of the hash change", standardHooks);

for (const [decision, allowed, expected] of [
	["allow", true, { status: NavigationOutcome.Committed, route: "detail", hash: "detail/1" }],
	["block", false, { status: NavigationOutcome.Blocked, route: "home", hash: "" }],
] as const) {
	// A router that shares the hash changer and is informed first can redirect the hash like that.
	QUnit.test(
		`the hash that replaces the one navTo() wrote is guarded as a navigation of its own (guards ${decision})`,
		async function (assert: Assert) {
			let detailGuardCalls = 0;
			router.addRouteGuard("detail", () => {
				detailGuardCalls++;
				return allowed;
			});
			const hashChanger = router.getHashChanger();
			const replaceProtected = (event: HashChangerBase$HashChangedEvent): void => {
				// The UI5 types declare the hash as an object.
				const newHash: unknown = event.getParameter("newHash");
				if (newHash === "protected") void hashChanger.replaceHash("detail/1", "Unknown");
			};
			// Before the router starts to listen.
			hashChanger.attachEvent("hashChanged", replaceProtected);
			router.initialize();
			await waitForRoute(router, "home");
			const statuses = recordSettlements(router);

			router.navTo("protected");
			const result = await router.navigationSettled();
			hashChanger.detachEvent("hashChanged", replaceProtected);

			assert.deepEqual(result, expected, "the router is on the route that UI5 displays");
			assert.deepEqual(statuses, [expected.status], "the navigation settles once");
			assert.strictEqual(detailGuardCalls, 1, "the guard of the route that matches the hash ran");
			assert.strictEqual(getHash(), expected.hash);
		},
	);
}

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
