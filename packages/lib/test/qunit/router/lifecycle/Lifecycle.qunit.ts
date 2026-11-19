import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardRouter, NavigationResult } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { Router$RouteMatchedEvent } from "sap/ui/core/routing/Router";
import {
	assertBlocked,
	callUnsafe,
	captureHashWrites,
	captureWarnings,
	changeHashSilently,
	flushPromises,
	getHash,
	createRouterUnsafe,
	recordSettlements,
	type SinonTestContext,
	waitForRoute,
	routerHooks,
	captureErrorsAsync,
	recordHashChanges,
} from "../../testHelpers";

let router: GuardRouter;

const standardHooks = routerHooks(
	(created) => {
		router = created;
	},
	() => router,
);

// ============================================================
// Module: Router lifecycle
// ============================================================
QUnit.module("Router - Lifecycle", standardHooks);

QUnit.test("Guards still work after stop and re-initialize", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	// Guard blocks before stop
	await assertBlocked(assert, router, () => router.navTo("protected"), "Guard blocks before stop");

	// Stop and re-initialize
	router.stop();
	assert.notOk(router.isInitialized(), "Router stopped");
	router.initialize();
	assert.ok(router.isInitialized(), "Router re-initialized");

	// Guard should still block after restart
	await assertBlocked(
		assert,
		router,
		() => router.navTo("protected"),
		"Guard still blocks after stop and re-initialize",
	);
});

QUnit.test("Double initialize is safe and guards still work", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	router.initialize(); // second call should be a no-op
	await waitForRoute(router, "home");

	await assertBlocked(assert, router, () => router.navTo("protected"), "Guard blocks after double initialize");
});

QUnit.test("destroy() twice does nothing the second time, like the base router", function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	router.destroy();
	assert.strictEqual(router.destroy(), router, "the second call returns the router and does not throw");
});

QUnit.test(
	"destroy() destroys the base router and detaches it from hash changes",
	async function (this: SinonTestContext, assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");
		let protectedMatched = false;
		router.getRoute("protected")!.attachPatternMatched(() => {
			protectedMatched = true;
		});

		router.destroy();
		assert.notOk(router.isInitialized(), "the base router is no longer initialized");

		const getHashChanger = this.spy(router, "getHashChanger");
		HashChanger.getInstance().setHash("protected");
		await flushPromises();
		assert.notOk(protectedMatched, "a hash change no longer reaches the router");
		assert.ok(getHashChanger.notCalled, "and the router does not look at its hash changer for it");
	},
);

QUnit.test(
	"a hash change delivered to a destroyed router only warns, like the base router",
	async function (assert: Assert) {
		let guardCalls = 0;
		router.addGuard(() => {
			guardCalls++;
			return true;
		});
		router.initialize();
		await waitForRoute(router, "home");
		let settlements = 0;
		router.attachNavigationSettled(() => {
			settlements++;
		});
		guardCalls = 0;
		router.destroy();

		// UI5 can deliver a hash change to a router destroyed earlier in the same event.
		const warnings = captureWarnings(() => callUnsafe(router, "parse", "protected"));

		assert.strictEqual(warnings.length, 1, "one warning");
		assert.ok(/destroyed while the hash changed/.test(warnings[0].message), "the base router's warning");
		assert.strictEqual(guardCalls, 0, "no guard ran");
		assert.strictEqual(settlements, 0, "nothing settled");
	},
);

QUnit.test("destroy() clears route metadata", function (assert: Assert) {
	router.setRouteMeta("", { root: true });
	router.destroy();
	assert.deepEqual(router.getRouteMeta(""), {}, "metadata set before destroy() is gone");
});

QUnit.test("Re-initialize after stop fires routeMatched like native router", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");

	router.stop();
	assert.notOk(router.isInitialized(), "Router stopped");
	const matched: (string | undefined)[] = [];
	router.attachRouteMatched((event: Router$RouteMatchedEvent) => {
		matched.push(event.getParameter("name"));
	});

	router.initialize();
	assert.ok(router.isInitialized(), "Router re-initialized");

	// Native router fires routeMatched on re-init; guard router must match.
	await waitForRoute(router, "home");
	assert.deepEqual(matched, ["home"], "Re-initialize fires routeMatched once for the current hash");
});

QUnit.test("the hash changer UI5 passes to the router of a nested component is used", async function (assert: Assert) {
	// createSubHashChanger() is protected in UI5: a component target calls it for its component.
	const subHashChanger = callUnsafe(router.getHashChanger(), "createSubHashChanger", "child") as object;
	router.destroy();
	try {
		// UIComponent passes it as fifth argument when the component is loaded as a routing target.
		router = createRouterUnsafe(
			[
				{ name: "home", pattern: "" },
				{ name: "protected", pattern: "protected" },
			],
			{ async: true },
			undefined,
			undefined,
			subHashChanger,
		);
		assert.ok(router.getHashChanger() === subHashChanger, "the router uses the hash changer it was given");

		router.initialize();
		await waitForRoute(router, "home");
		router.navTo("protected");
		await waitForRoute(router, "protected");

		assert.strictEqual(callUnsafe(subHashChanger, "getHash"), "protected", "the route's hash is the nested one");
		assert.ok(
			getHash().endsWith("&/child/protected"),
			`the browser hash carries it under the prefix: "${getHash()}"`,
		);
	} finally {
		router.destroy();
		callUnsafe(subHashChanger, "destroy");
	}
});

QUnit.test("initialize(true) does not parse the current hash", async function (assert: Assert) {
	let guardCalls = 0;
	router.addGuard(() => {
		guardCalls++;
		return true;
	});
	HashChanger.getInstance().setHash("protected");
	const statuses = recordSettlements(router);

	router.initialize(true);
	await flushPromises();

	assert.ok(router.isInitialized(), "the router is initialized");
	assert.strictEqual(guardCalls, 0, "no guard ran for the initial hash");
	assert.deepEqual(statuses, [], "nothing settled");

	router.navTo("forbidden");
	await waitForRoute(router, "forbidden");
	assert.strictEqual(guardCalls, 1, "the router handles navigation from then on");
});

QUnit.test(
	"navTo() before initialize() only sets the hash, and its guards run when the router starts",
	async function (assert: Assert) {
		let matched = false;
		router.getRoute("protected")!.attachMatched(() => {
			matched = true;
		});
		const statuses = recordSettlements(router);

		router.navTo("protected");
		assert.strictEqual(getHash(), "protected", "the hash is set, as the native router does");
		assert.deepEqual(statuses, [], "nothing settled: the router does not handle navigation yet");

		// Registered after the navTo(), like a manifest guard that initialize() registers.
		router.addRouteGuard("protected", () => false);
		router.initialize();
		await waitForRoute(router, "home");

		assert.deepEqual(
			statuses,
			[NavigationOutcome.Blocked, NavigationOutcome.Committed],
			"the guard blocked the hash, then the router fell back to the empty hash",
		);
		assert.notOk(matched, "the guarded route was never displayed");
		assert.strictEqual(getHash(), "");
	},
);

QUnit.test(
	"a stopped router does not listen to hash changes, also after initialize() was called twice",
	async function (this: SinonTestContext, assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");
		// UI5 warns about the second call, which must not make the router listen twice.
		captureWarnings(() => router.initialize());
		router.stop();
		const statuses = recordSettlements(router);
		const getHashChanger = this.spy(router, "getHashChanger");

		HashChanger.getInstance().setHash("protected");
		await flushPromises();

		assert.deepEqual(statuses, [], "nothing settled");
		assert.ok(getHashChanger.notCalled, "the router does not look at its hash changer for the hash change");
	},
);

QUnit.test("navTo() on a stopped router does nothing, like the native router", async function (assert: Assert) {
	router.initialize();
	await waitForRoute(router, "home");
	router.stop();

	let matched = false;
	router.getRoute("protected")!.attachMatched(() => {
		matched = true;
	});
	const statuses = recordSettlements(router);

	router.navTo("protected");
	await flushPromises();

	assert.deepEqual(statuses, [], "nothing settled");
	assert.notOk(matched, "the route was not displayed");
	assert.strictEqual(getHash(), "", "the hash is unchanged");
});

QUnit.test(
	"stop() and initialize(true) keep the route the user is on, as the native router does",
	async function (assert: Assert) {
		const leaveContexts: string[] = [];
		let allowLeave = false;
		router.addLeaveGuard("protected", (context) => {
			leaveContexts.push(`${context.fromRoute}|${context.fromHash}|${context.toRoute}`);
			return allowLeave;
		});
		router.addRouteGuard("detail", () => false);
		router.initialize();
		await waitForRoute(router, "home");
		router.navTo("protected");
		await waitForRoute(router, "protected");
		let homeMatched = false;
		router.getRoute("home")!.attachMatched(() => {
			homeMatched = true;
		});

		// What the Fiori launchpad does around a cross-app navigation that the user cancels.
		router.stop();
		// UI5 warns about a second stop(), which must not forget the route.
		captureWarnings(() => router.stop());
		router.initialize(true);
		assert.deepEqual(
			await router.navigationSettled(),
			{ status: NavigationOutcome.Committed, route: "protected", hash: "protected" },
			"the router is on the route it resumed",
		);
		const statuses = recordSettlements(router);

		router.navTo("forbidden");
		assert.deepEqual(leaveContexts, ["protected|protected|forbidden"], "the leave guard of that route runs");
		assert.deepEqual(statuses, [NavigationOutcome.Blocked], "and blocks");

		allowLeave = true;
		HashChanger.getInstance().setHash("detail/1");
		await flushPromises();
		assert.deepEqual(statuses, [NavigationOutcome.Blocked, NavigationOutcome.Blocked], "the enter guard blocks");
		assert.strictEqual(getHash(), "protected", "a blocked hash change goes back to the hash of that route");
		assert.notOk(homeMatched, "and not to the default route");
	},
);

QUnit.test("initialize(true) on a router that is running changes nothing", async function (assert: Assert) {
	let leaveCalls = 0;
	router.addLeaveGuard("protected", () => {
		leaveCalls++;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");
	router.navTo("protected");
	await waitForRoute(router, "protected");

	// UI5 warns and does nothing.
	captureWarnings(() => router.initialize(true));
	router.navTo("forbidden");
	await waitForRoute(router, "forbidden");

	assert.strictEqual(leaveCalls, 1, "the router is still on the route it was on");
});

QUnit.test(
	"a hash change blocked after a first initialize(true) restores the ignored hash",
	async function (assert: Assert) {
		router.addRouteGuard("forbidden", () => false);
		HashChanger.getInstance().setHash("protected");
		router.initialize(true);
		const statuses = recordSettlements(router);

		HashChanger.getInstance().setHash("forbidden");
		await flushPromises();

		assert.deepEqual(statuses, [NavigationOutcome.Blocked], "nothing but the block settles");
		assert.strictEqual(getHash(), "protected", "the URL is back on the hash the router started on");
	},
);

/**
 * What the Fiori launchpad does around a cross-app navigation that the user cancels in its
 * unsaved-data prompt: it stops the router, initializes it again while the URL still shows the
 * target, and then puts the URL back without a hash change event.
 */
async function cancelCrossAppNavigation(): Promise<void> {
	router.stop();
	await changeHashSilently((hasher) => hasher.setHash("forbidden"));
	router.initialize(true);
	await changeHashSilently((hasher) => hasher.replaceHash("protected"));
}

for (const { guard, register } of [
	{ guard: "leave guard", register: (): unknown => router.addLeaveGuard("protected", () => false) },
	{ guard: "enter guard", register: (): unknown => router.addRouteGuard("detail", () => false) },
]) {
	QUnit.test(
		`a hash change that a ${guard} blocks after a cancelled cross-app navigation returns to the URL as it was`,
		async function (assert: Assert) {
			router.initialize();
			await waitForRoute(router, "home");
			router.navTo("protected");
			await waitForRoute(router, "protected");
			await cancelCrossAppNavigation();
			register();
			const settlements: NavigationResult[] = [];
			router.attachNavigationSettled((event) => settlements.push(event.getParameters()));

			const hashChanger = HashChanger.getInstance();
			const writes = await captureHashWrites(hashChanger, () => hashChanger.setHash("detail/1"));

			assert.deepEqual(
				writes,
				["set:detail/1", "replace:protected"],
				"the entry is replaced with the hash that the URL showed before the change",
			);
			assert.deepEqual(
				settlements,
				[{ status: NavigationOutcome.Blocked, route: "protected", hash: "protected" }],
				"the navigation is blocked, and nothing else is navigated to",
			);
			assert.strictEqual(getHash(), "protected", "the URL is back");
		},
	);
}

QUnit.test(
	"a blocked hash change returns to a URL that had changed without a hash change event",
	async function (assert: Assert) {
		router.addRouteGuard("detail", () => false);
		router.initialize();
		await waitForRoute(router, "home");
		router.navTo("protected");
		await waitForRoute(router, "protected");
		router.stop();
		HashChanger.getInstance().setHash("forbidden");
		// The router resumes "protected" on the hash "forbidden", which the URL does not show for long.
		router.initialize(true);
		await changeHashSilently((hasher) => hasher.replaceHash("protected"));
		const settlements: NavigationResult[] = [];
		router.attachNavigationSettled((event) => settlements.push(event.getParameters()));

		HashChanger.getInstance().setHash("detail/1");
		await flushPromises();

		assert.strictEqual(getHash(), "protected", "the URL is back on what it showed before the change");
		assert.deepEqual(
			settlements,
			[{ status: NavigationOutcome.Blocked, route: "protected", hash: "protected" }],
			"the router is on the hash that its hash changer reports then",
		);
		assert.deepEqual(await router.navigationSettled(), settlements[0], "and stays on it");

		let leftHash: string | undefined;
		router.addLeaveGuard("protected", (context) => {
			leftHash = context.fromHash;
			return true;
		});
		router.navTo("home");
		await waitForRoute(router, "home");
		assert.strictEqual(leftHash, "protected", "the next navigation leaves that hash");
	},
);

QUnit.test(
	"a hash that arrives while the router puts the URL back is not undone as a whole",
	async function (this: SinonTestContext, assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");
		router.navTo("protected");
		await waitForRoute(router, "protected");
		router.addLeaveGuard("protected", () => false);
		const statuses = recordSettlements(router);
		const hashChanger = HashChanger.getInstance();
		// A hash changer that writes another hash than the one the router puts the URL back to, once.
		const replaceHash = this.stub(hashChanger, "replaceHash").callsFake(() => {
			replaceHash.restore();
			hashChanger.replaceHash("forbidden", "Unknown");
		});

		hashChanger.setHash("detail/1");
		await flushPromises();

		assert.deepEqual(
			statuses,
			[NavigationOutcome.Blocked, NavigationOutcome.Blocked],
			"both hashes are blocked, and the second one causes no further undo",
		);
		assert.strictEqual(getHash(), "protected", "the URL is on the hash of the route that is shown");
		assert.deepEqual(
			await router.navigationSettled(),
			{ status: NavigationOutcome.Blocked, route: "protected", hash: "protected" },
			"which is the hash of the router",
		);
	},
);

QUnit.test(
	"a hash change that is blocked while no navigation has committed ends on the empty hash",
	async function (assert: Assert) {
		router.addGuard(() => false);
		router.initialize();
		const statuses = recordSettlements(router);

		HashChanger.getInstance().setHash("protected");
		await flushPromises();

		assert.deepEqual(
			statuses,
			[NavigationOutcome.Blocked, NavigationOutcome.Blocked],
			"the hash is blocked, and so is the empty hash that the router falls back to",
		);
		assert.strictEqual(getHash(), "", "the URL does not go back to the hash that was blocked");
		assert.deepEqual(
			await router.navigationSettled(),
			{ status: NavigationOutcome.Blocked, route: "", hash: "" },
			"the router is on no route",
		);
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

QUnit.test(
	"navigationSettled() after destroy() reports the route and hash the router was on",
	async function (assert: Assert) {
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
	},
);

// ============================================================
// Module: The global hash changer is replaced while the router runs
// ============================================================
QUnit.module("Router - Replaced hash changer", standardHooks);

/**
 * Replace the global hash changer, as the Fiori launchpad does when its shell starts. The new one
 * is initialized first, so that it reports no hash change of its own to the listeners it takes
 * over: the first one they get is a real one.
 */
function replaceHashChanger(): HashChanger {
	const replacement = new HashChanger();
	replacement.init();
	HashChanger.replaceHashChanger(replacement);
	return replacement;
}

const hashChangedListeners = (hashChanger: HashChanger): number =>
	(Reflect.get(hashChanger, "mEventRegistry") as { hashChanged?: unknown[] }).hashChanged?.length ?? 0;

QUnit.test(
	"a hash change is blocked and undone after HashChanger.replaceHashChanger() has replaced the hash changer the router started with",
	async function (assert: Assert) {
		router.addRouteGuard("detail", () => false);
		router.initialize();
		await waitForRoute(router, "home");
		router.navTo("protected");
		await waitForRoute(router, "protected");

		const replacement = replaceHashChanger();
		assert.strictEqual(
			Reflect.get(router.getHashChanger(), "parent"),
			replacement,
			"UI5 has moved the hash changer of the router to the replacement",
		);
		replacement.setHash("detail/1");

		assert.deepEqual(
			await router.navigationSettled(),
			{ status: NavigationOutcome.Blocked, route: "protected", hash: "protected" },
			"the navigation settles as blocked",
		);
		assert.strictEqual(getHash(), "protected", "and the URL is back");

		const statuses = recordSettlements(router);
		replacement.setHash("detail/2");
		await router.navigationSettled();
		assert.deepEqual(statuses, [NavigationOutcome.Blocked], "the next hash change is blocked");
		assert.strictEqual(getHash(), "protected", "and undone as well");
	},
);

QUnit.test(
	"stop() and destroy() detach the router from the hash changer that has replaced the one it started with",
	async function (assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");
		const replacement = replaceHashChanger();
		const listeners = hashChangedListeners(replacement);

		router.stop();
		assert.strictEqual(hashChangedListeners(replacement), listeners - 1, "stop() has detached the router");
		router.initialize();
		assert.strictEqual(hashChangedListeners(replacement), listeners, "initialize() attaches it again");
		router.destroy();
		assert.strictEqual(hashChangedListeners(replacement), listeners - 1, "destroy() has detached it");
	},
);
