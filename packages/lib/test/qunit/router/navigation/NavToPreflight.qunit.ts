import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardRouter } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import {
	captureErrorsAsync,
	captureHashWrites,
	captureWarnings,
	getHash,
	flushPromises,
	recordHashChanges,
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

QUnit.module("Router - navTo preflight", standardHooks);

QUnit.test("blocked programmatic navTo does not change the hash", function (assert) {
	router.addGuard(() => false);
	router.initialize();

	const recorder = recordHashChanges();
	router.navTo("protected");
	recorder.stop();

	assert.deepEqual(recorder.hashes, [], "Hash was never set by the blocked navTo");
});

QUnit.test("a blocked navTo() leaves a hash alone that the router did not parse", async function (assert) {
	HashChanger.getInstance().setHash("forbidden");
	router.addRouteGuard("protected", () => false);
	router.initialize(true);
	const recorder = recordHashChanges();

	router.navTo("protected");
	const result = await router.navigationSettled();
	await flushPromises();
	recorder.stop();

	assert.strictEqual(result.status, NavigationOutcome.Blocked);
	assert.deepEqual(recorder.hashes, [], "the navigation never moved the hash, so there is nothing to restore");
	assert.strictEqual(getHash(), "forbidden");
});

QUnit.test("parse() of the committed hash does not cancel a pending navTo()", async function (assert) {
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

	router.navTo("protected");
	router.parse("");
	allow(true);
	await flushPromises();

	assert.deepEqual(statuses, [NavigationOutcome.Committed], "the navigation that had not moved the hash goes on");
	assert.strictEqual(getHash(), "protected");
});

QUnit.test("blocked programmatic navTo settles as Blocked", async function (assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Settlement is Blocked");
	assert.strictEqual(result.route, "home", "Route stays on home");
});

QUnit.test("redirected programmatic navTo does not create intermediate hash", function (assert) {
	router.addRouteGuard("protected", () => "home");
	router.initialize();

	const recorder = recordHashChanges();
	router.navTo("protected");
	recorder.stop();

	assert.deepEqual(recorder.hashes, [], "Hash did not visit intermediate protected route");
});

QUnit.test("redirected programmatic navTo settles as Redirected", async function (assert) {
	router.addRouteGuard("protected", () => "home");
	router.initialize();

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Redirected, "Settlement is Redirected");
	assert.strictEqual(result.route, "home", "Route is home after redirect");
});

QUnit.test("allowed programmatic navTo is not double-guarded in parse", async function (assert) {
	let guardCallCount = 0;
	router.addGuard(() => {
		guardCallCount++;
		return true;
	});
	router.initialize();
	guardCallCount = 0; // reset after initialize fires parse

	router.navTo("protected");
	await router.navigationSettled();

	assert.strictEqual(guardCallCount, 1, "Guard ran exactly once, not in both navTo and parse");
});

QUnit.test("async blocked programmatic navTo does not change the hash", async function (assert) {
	router.addGuard(() => Promise.resolve(false));
	router.initialize();

	const recorder = recordHashChanges();
	router.navTo("protected");
	await router.navigationSettled();
	recorder.stop();

	assert.deepEqual(recorder.hashes, [], "Hash was never set by the async blocked navTo");
});

QUnit.test("async redirected programmatic navTo settles as Redirected", async function (assert) {
	router.addRouteGuard("protected", () => Promise.resolve("home"));
	router.initialize();

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Redirected, "Settlement is Redirected");
	assert.strictEqual(result.route, "home", "Route is home after async redirect");
});

QUnit.test("navTo with replace=true works through preflight with guards", async function (assert) {
	let guardCallCount = 0;
	router.addGuard(() => {
		guardCallCount++;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");
	guardCallCount = 0;

	router.navTo("protected");
	await router.navigationSettled();
	assert.strictEqual(getHash(), "protected", "Navigated to protected");
	assert.strictEqual(guardCallCount, 1, "Guard ran for first navigation");

	router.navTo("forbidden", {}, true);
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "Navigation committed");
	assert.strictEqual(getHash(), "forbidden", "Hash updated to forbidden");
	assert.strictEqual(guardCallCount, 2, "Guard ran for replace navigation");
});

QUnit.test("navTo with replace=true works through preflight (4-arg overload)", async function (assert) {
	router.addGuard(() => true);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await router.navigationSettled();

	router.navTo("forbidden", {}, {}, true);
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "Navigation committed");
	assert.strictEqual(getHash(), "forbidden", "Hash updated to forbidden");
});

QUnit.test("A redirected navTo() writes its target the way the call asked for", async function (assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("detail", (context) =>
		context.toArguments.id === "1" ? { route: "detail", parameters: { id: "7" } } : true,
	);
	router.initialize();
	await waitForRoute(router, "home");

	const writes = await captureHashWrites(HashChanger.getInstance(), async () => {
		router.navTo("protected");
		await router.navigationSettled();
		router.navTo("detail", { id: "1" });
		await router.navigationSettled();
		router.navTo("home");
		await router.navigationSettled();
		router.navTo("protected", {}, true);
		await router.navigationSettled();
		router.navTo("detail", { id: "1" }, undefined, true);
		await router.navigationSettled();
	});

	assert.deepEqual(
		writes,
		["set:forbidden", "set:detail/7", "set:", "replace:forbidden", "replace:detail/7"],
		"string and object redirect targets add a history entry, so that Back returns to the origin, unless the call replaces",
	);
});

QUnit.test(
	"A redirect chain after navTo() writes only its final target, as one history entry",
	async function (assert) {
		router.addRouteGuard("protected", () => "forbidden");
		router.addRouteGuard("forbidden", async () => ({ route: "detail", parameters: { id: "7" } }));
		router.initialize();
		await waitForRoute(router, "home");

		const writes = await captureHashWrites(HashChanger.getInstance(), async () => {
			router.navTo("protected");
			await router.navigationSettled();
		});

		assert.deepEqual(writes, ["set:detail/7"], "the hops in between never reach the URL");
	},
);

QUnit.test("navTo returns this for chaining", function (assert) {
	router.initialize();
	const result = router.navTo("home");
	assert.strictEqual(result, router, "navTo returns this");
});

QUnit.test("navTo to unknown route cancels pending async guard pipeline", async function (assert) {
	let resolveGuard!: (value: boolean) => void;
	router.addGuard(
		() =>
			new Promise<boolean>((r) => {
				resolveGuard = r;
			}),
	);
	router.initialize();

	router.navTo("protected");
	const settled = router.navigationSettled();

	// While the async guard is pending, navTo to an unknown route.
	// This must cancel the pending navigation so settlement resolvers drain.
	router.navTo("nonexistent");

	resolveGuard(true);

	const result = await settled;
	assert.strictEqual(
		result.status,
		NavigationOutcome.Cancelled,
		"Pending navigation cancelled when unknown-route navTo supersedes it",
	);
});

QUnit.test("navTo to unknown route then real route works after cancellation", async function (assert) {
	let resolveGuard!: (value: boolean) => void;
	router.addGuard((context) => {
		if (context.toRoute === "forbidden") {
			return true;
		}
		return new Promise<boolean>((r) => {
			resolveGuard = r;
		});
	});
	router.initialize();

	router.navTo("protected");
	const firstSettled = router.navigationSettled();

	router.navTo("nonexistent");
	resolveGuard(true);

	const cancelResult = await firstSettled;
	assert.strictEqual(cancelResult.status, NavigationOutcome.Cancelled, "First navigation cancelled");

	router.navTo("forbidden");
	const secondResult = await router.navigationSettled();
	assert.strictEqual(secondResult.status, NavigationOutcome.Committed, "Subsequent navigation commits");
	assert.strictEqual(secondResult.route, "forbidden", "Landed on forbidden");
});

QUnit.test("async preflight superseded by second navTo cancels first", async function (assert) {
	let resolveLatestGuard!: (value: boolean) => void;
	router.addGuard(
		() =>
			new Promise<boolean>((r) => {
				resolveLatestGuard = r;
			}),
	);
	router.initialize();

	router.navTo("protected"); // starts async preflight
	const settled = router.navigationSettled();
	router.navTo("forbidden"); // supersedes first

	resolveLatestGuard(true);

	const result = await settled;
	assert.strictEqual(result.status, NavigationOutcome.Cancelled, "First navigation cancelled");
});

QUnit.test("duplicate navTo to same pending hash is a no-op", async function (assert) {
	let guardCallCount = 0;
	router.addGuard(async () => {
		guardCallCount++;
		return true;
	});
	router.initialize();
	guardCallCount = 0;

	router.navTo("protected");
	router.navTo("protected"); // same hash, should be deduped
	await router.navigationSettled();

	assert.strictEqual(guardCallCount, 1, "Guard ran only once despite duplicate navTo");
});

// Preflight: the hash never changed, so nothing is restored. For the parse path, where the hash
// has changed and is restored, see "Router - Hash change (direct URL entry)".

QUnit.test("blocked via navTo leaves hash unchanged", async function (this: SinonTestContext, assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	const recorder = recordHashChanges();
	const replaceHash = this.spy(HashChanger.getInstance(), "replaceHash");
	router.navTo("protected");
	await router.navigationSettled();
	recorder.stop();

	assert.strictEqual(replaceHash.callCount, 0, "a blocked navTo does not rewrite the history entry");
	assert.deepEqual(recorder.hashes, [], "Hash unchanged - preflight never changed it");
});

QUnit.test("rejected async guard via navTo leaves hash unchanged", async function (assert) {
	router.addRouteGuard("protected", () => Promise.reject(new Error("guard error")));
	router.initialize();
	await waitForRoute(router, "home");

	const recorder = recordHashChanges();
	router.navTo("protected");
	const result = await router.navigationSettled();
	recorder.stop();
	assert.strictEqual(result.status, NavigationOutcome.Error, "Rejected guard settles as Error");
	assert.deepEqual(recorder.hashes, [], "Hash unchanged after rejected async preflight guard");
});

QUnit.test(
	"external hash change to same pending hash during async preflight restores hash on block",
	async function (assert) {
		let resolveGuard!: (value: boolean) => void;
		router.addRouteGuard(
			"protected",
			() =>
				new Promise<boolean>((r) => {
					resolveGuard = r;
				}),
		);
		router.initialize();
		await waitForRoute(router, "home");

		const hashBefore = getHash();
		router.navTo("protected"); // async preflight, hash unchanged

		// Simulate external navigation to the same hash (URL bar, bookmark, etc.)
		// while the async preflight is still pending. parse() must not silently
		// drop this; it should cancel the preflight and take over.
		HashChanger.getInstance().setHash("protected");

		resolveGuard(false);
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Blocked, "Navigation blocked");
		assert.strictEqual(getHash(), hashBefore, "Hash restored after block - browser URL matches router state");
	},
);

QUnit.test("setHash during async preflight supersedes the preflight", async function (assert) {
	router.addRouteGuard("protected", async () => true);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const settledPromise = router.navigationSettled();

	// Browser back / direct hash change while async preflight is pending.
	// parse() bumps the generation counter, cancelling the preflight.
	HashChanger.getInstance().setHash("forbidden");

	const result = await settledPromise;
	assert.strictEqual(result.status, NavigationOutcome.Cancelled, "Preflight cancelled by parse");

	await waitForRoute(router, "forbidden");
	assert.strictEqual(getHash(), "forbidden", "parse-driven navigation committed");
});

QUnit.test("redirect to nonexistent via setHash restores the hash", async function (assert) {
	router.addRouteGuard("protected", () => "nonExistentRoute");
	router.initialize();
	await waitForRoute(router, "home");

	HashChanger.getInstance().setHash("protected");
	await router.navigationSettled();
	assert.strictEqual(getHash(), "", "Hash was restored after block");
});

QUnit.test("redirect to nonexistent via navTo leaves hash unchanged", async function (assert) {
	router.addRouteGuard("protected", () => "nonExistentRoute");
	router.initialize();
	await waitForRoute(router, "home");

	const recorder = recordHashChanges();
	router.navTo("protected");
	await router.navigationSettled();
	recorder.stop();
	assert.deepEqual(recorder.hashes, [], "Hash unchanged - preflight never changed it");
});

QUnit.test("async redirect to nonexistent via navTo leaves hash unchanged", async function (assert) {
	router.addRouteGuard("protected", () => Promise.resolve("nonExistentRoute"));
	router.initialize();
	await waitForRoute(router, "home");

	const recorder = recordHashChanges();
	router.navTo("protected");
	await router.navigationSettled();
	recorder.stop();
	assert.deepEqual(recorder.hashes, [], "Hash unchanged - preflight never changed it");
});

QUnit.test("navTo to unknown route logs the base router's warning", function (assert: Assert) {
	router.initialize();

	const warnings = captureWarnings(() => router.navTo("nonexistent"));

	assert.ok(
		warnings.some((w) => /Route with name "?nonexistent"? does not exist/.test(w.message)),
		"unknown route is reported like sap.m.routing.Router does",
	);
});

QUnit.test(
	"preflight that blocks or fails never writes to the HashChanger",
	async function (this: SinonTestContext, assert: Assert) {
		router.addRouteGuard("protected", () => false);
		router.addRouteGuard("forbidden", () => {
			throw new Error("sync guard error");
		});
		router.addRouteGuard("detail", (context) => {
			if (context.toArguments.id === "reject") return Promise.reject(new Error("async guard error"));
			// "detail" needs an id, so this redirect itself throws.
			if (context.toArguments.id === "bad-redirect") return Promise.resolve("detail");
			return "protected"; // redirect into a blocking guard
		});
		router.initialize();
		await waitForRoute(router, "home");

		const hashChanger = HashChanger.getInstance();
		const setHash = this.spy(hashChanger, "setHash");
		const replaceHash = this.spy(hashChanger, "replaceHash");
		const statuses: string[] = [];
		const restores: number[] = [];
		const errors = await captureErrorsAsync(async () => {
			for (const navigate of [
				() => router.navTo("protected"),
				() => router.navTo("forbidden"),
				() => router.navTo("detail", { id: "reject" }),
				() => router.navTo("detail", { id: "bad-redirect" }),
				() => router.navTo("detail", { id: "blocked-redirect" }),
			]) {
				navigate();
				statuses.push((await router.navigationSettled()).status);
				restores.push(replaceHash.callCount);
			}
		});

		assert.deepEqual(statuses, [
			NavigationOutcome.Blocked,
			NavigationOutcome.Error,
			NavigationOutcome.Error,
			NavigationOutcome.Error,
			NavigationOutcome.Blocked,
		]);
		assert.ok(
			errors.some((e) => e.message === 'Guard redirect target "detail" has no valid hash, navigation failed'),
			"failed redirect is logged with the redirect target",
		);
		assert.strictEqual(setHash.callCount, 0, "no history entry added");
		assert.deepEqual(restores, [0, 0, 0, 0, 0], "no hash restore after any of them: the hash never changed");
	},
);

QUnit.test(
	"navTo() called while an allowed navigation writes its hash is guarded, and the allowed navigation still commits",
	async function (assert: Assert) {
		let guardCalls = 0;
		router.addRouteGuard("detail", () => {
			guardCalls++;
			return false;
		});
		let navigating = false;
		// Attached before initialize(), so it runs before the router receives the hash change.
		router.getHashChanger().attachEvent("hashChanged", () => {
			if (!navigating) return;
			navigating = false;
			router.navTo("detail", { id: "1" });
		});
		router.initialize();
		await waitForRoute(router, "home");
		const statuses = recordSettlements(router);

		navigating = true;
		router.navTo("protected");
		await flushPromises();
		assert.strictEqual(guardCalls, 1, "the guard of the target ran");
		assert.deepEqual(statuses, [NavigationOutcome.Blocked, NavigationOutcome.Committed], "blocked, then committed");
		assert.strictEqual(getHash(), "protected", "the allowed navigation has its hash");
	},
);
