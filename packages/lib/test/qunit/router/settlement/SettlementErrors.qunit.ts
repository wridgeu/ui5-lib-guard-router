import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardFn, GuardRouter } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import {
	captureErrors,
	captureErrorsAsync,
	flushPromises,
	getHash,
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
