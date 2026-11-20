import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { GuardFn, GuardRouter } from "ui5/guard/router/types";
import {
	captureUnhandledRejections,
	captureWarnings,
	captureErrorsAsync,
	captureWarningsAsync,
	flushPromises,
	GuardRouterClass,
	loadModule,
	waitForRoute,
	createdRouterHooks,
	getHash,
} from "../../testHelpers";
import { FIXTURES, createLazyRouter, loadProbe } from "./manifestHelpers";

let router: GuardRouter;

const hooks = createdRouterHooks(() => router);

QUnit.module("Router - Multi-guard module exports (block loading)", hooks);

QUnit.test("object module: bare path registers all guards in key order", async function (assert: Assert) {
	const probe = await loadProbe();
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteRegistration: "ignore",
				guards: {
					protected: [`${FIXTURES}/objectGuard`],
				},
			},
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "the second guard blocks");
	assert.deepEqual(probe.calls, ["checkAuth", "checkRole"], "both guards ran, in key order");
});

QUnit.test("array module: bare path registers all guards in index order", async function (assert: Assert) {
	const probe = await loadProbe();
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteRegistration: "ignore",
				guards: {
					protected: [`${FIXTURES}/arrayGuard`],
				},
			},
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "the second guard blocks");
	assert.deepEqual(probe.calls, ["allowFirst", "blockSecond"], "both guards ran, in index order");
});

QUnit.test("empty object module warns and registers no guards", async function (assert: Assert) {
	const warnings = await captureWarningsAsync(async () => {
		router = new GuardRouterClass(
			[
				{ name: "home", pattern: "" },
				{ name: "protected", pattern: "protected" },
			],
			{
				async: true,
				guardRouter: {
					guardLoading: "block",
					unknownRouteRegistration: "ignore",
					guards: {
						protected: [`${FIXTURES}/emptyObjectGuard`],
					},
				},
			},
		);

		router.initialize();
		await waitForRoute(router, "home");
	});

	assert.ok(
		warnings.some((w) => w.message.includes("empty object")),
		"warning about empty object export",
	);

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "no guards → navigation allowed");
});

QUnit.test("mixed object module: non-function values warned and skipped", async function (assert: Assert) {
	const warnings = await captureWarningsAsync(async () => {
		router = new GuardRouterClass(
			[
				{ name: "home", pattern: "" },
				{ name: "protected", pattern: "protected" },
			],
			{
				async: true,
				guardRouter: {
					guardLoading: "block",
					unknownRouteRegistration: "ignore",
					guards: {
						protected: [`${FIXTURES}/mixedObjectGuard`],
					},
				},
			},
		);

		router.initialize();
		await waitForRoute(router, "home");
	});

	assert.ok(
		warnings.some((w) => w.message.includes("notAFunction")),
		"warning for non-function entry",
	);
	assert.ok(
		warnings.some((w) => w.message.includes("alsoNotAFunction")),
		"warning includes second non-function property name",
	);

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"valid (blocking) guard registered, invalid entries skipped",
	);
});

QUnit.module("Router - Multi-guard module exports (lazy loading)", hooks);

QUnit.test("lazy mode: object module bare path registers all guards", async function (assert: Assert) {
	const probe = await loadProbe();
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "lazy",
				unknownRouteRegistration: "ignore",
				guards: {
					protected: [`${FIXTURES}/objectGuard`],
				},
			},
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "the second guard blocks");
	assert.deepEqual(probe.calls, ["checkAuth", "checkRole"], "both guards ran, in key order");
});

QUnit.test("lazy mode: cherry-pick from object module", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "lazy",
				unknownRouteRegistration: "ignore",
				guards: {
					protected: [`${FIXTURES}/objectGuard#checkAuth`],
				},
			},
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Committed,
		"lazy cherry-pick: only checkAuth registered, navigation allowed",
	);
});

QUnit.test("lazy mode: array module bare path registers all guards", async function (assert: Assert) {
	const probe = await loadProbe();
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "lazy",
				unknownRouteRegistration: "ignore",
				guards: {
					protected: [`${FIXTURES}/arrayGuard`],
				},
			},
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "the second guard blocks");
	assert.deepEqual(probe.calls, ["allowFirst", "blockSecond"], "both guards ran, in index order");
});

QUnit.test("lazy mode: uncached module runs all of its guards in order", async function (assert: Assert) {
	const path = `${FIXTURES}/lazyUncachedGuard`;
	const probe = await loadProbe();
	router = createLazyRouter({ protected: [path] });
	router.initialize();
	assert.strictEqual(sap.ui.require(path), undefined, "module was not cached when the guards were registered");
	await waitForRoute(router, "home");

	const visit = async (behaviors: GuardFn[]): Promise<{ status: string; calls: string[] }> => {
		probe.calls.length = 0;
		probe.behaviors = behaviors;
		router.navTo("protected");
		const { status } = await router.navigationSettled();
		if (status === NavigationOutcome.Committed) {
			router.navTo("home");
			await router.navigationSettled();
		}
		return { status, calls: [...probe.calls] };
	};
	const both = ["uncachedFirst", "uncachedSecond"];

	router.navTo("protected");
	router.navTo("home");
	await router.navigationSettled();
	await loadModule(path);
	await flushPromises();
	assert.deepEqual(probe.calls, [], "a navigation superseded while the module loads runs no guards");

	assert.deepEqual(await visit([]), { status: NavigationOutcome.Committed, calls: both }, "first navigation");
	probe.calls.length = 0;
	router.navTo("protected");
	assert.strictEqual(getHash(), "protected", "later navigation commits within navTo");
	assert.deepEqual(probe.calls, both, "later navigation runs all guards");
	router.navTo("home");
	await router.navigationSettled();
	assert.deepEqual(
		await visit([() => Promise.resolve(true), () => false]),
		{ status: NavigationOutcome.Blocked, calls: both },
		"a guard after an async one still runs and can block",
	);
	assert.deepEqual(
		await visit([() => true, () => Promise.resolve(true)]),
		{ status: NavigationOutcome.Committed, calls: both },
		"an async last guard runs once and no guard runs twice",
	);
	assert.deepEqual(
		await visit([() => Promise.resolve(false)]),
		{ status: NavigationOutcome.Blocked, calls: ["uncachedFirst"] },
		"an async block stops the remaining guards",
	);
	assert.deepEqual(
		await visit([() => false]),
		{ status: NavigationOutcome.Blocked, calls: ["uncachedFirst"] },
		"a sync block stops the remaining guards",
	);

	const firstCalled = Promise.withResolvers<void>();
	const gate = Promise.withResolvers<boolean>();
	probe.calls.length = 0;
	probe.behaviors = [
		() => {
			firstCalled.resolve();
			return gate.promise;
		},
	];
	router.navTo("protected");
	await firstCalled.promise;
	router.navTo("home");
	await router.navigationSettled();
	gate.resolve(true);
	await flushPromises();
	assert.deepEqual(probe.calls, ["uncachedFirst"], "a superseded navigation stops the remaining guards");
});

QUnit.test("lazy mode: uncached cherry-pick loads the picked export", async function (assert: Assert) {
	const path = `${FIXTURES}/lazyUncachedPickGuard`;
	router = createLazyRouter({ protected: [`${path}#block`] });
	router.initialize();
	assert.strictEqual(sap.ui.require(path), undefined, "module was not cached when the guard was registered");
	await waitForRoute(router, "home");

	router.navTo("protected");
	assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Blocked, "picked export ran");
});

// Separate router per module: the constructor preloads every configured module, which would
// otherwise cache this one while the other navigation is pending.
QUnit.test("lazy mode: uncached cherry-pick of a missing export allows", async function (assert: Assert) {
	const path = `${FIXTURES}/lazyUncachedMissingPickGuard`;
	router = createLazyRouter({ protected: [`${path}#missing`] });
	router.initialize();
	assert.strictEqual(sap.ui.require(path), undefined, "module was not cached when the guard was registered");
	await waitForRoute(router, "home");

	router.navTo("protected");
	assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Committed, "no guard ran");
});

QUnit.test("lazy mode: a guard that throws on first load fails the navigation", async function (assert: Assert) {
	const path = `${FIXTURES}/lazyUncachedThrowingGuard`;
	router = createLazyRouter({ protected: [path] });
	router.initialize();
	assert.strictEqual(sap.ui.require(path), undefined, "module was not cached when the guard was registered");
	await waitForRoute(router, "home");

	const errors = await captureErrorsAsync(async () => {
		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Error, "navigation fails");
		assert.strictEqual(String(result.error), "Error: guard failed", "with the thrown error");
	});
	assert.deepEqual(
		errors.map((entry) => entry.message),
		['Enter guard [0] "fail" on route "protected" threw, navigation failed'],
		"the log names the guard the module resolved to",
	);
});

QUnit.test("lazy mode: a module that fails to load fails the navigation", async function (assert: Assert) {
	const path = `${FIXTURES}/doesNotExist`;
	router = createLazyRouter({ protected: [path], forbidden: [`${path}#guard`] });
	router.initialize();
	await waitForRoute(router, "home");

	const statuses: string[] = [];
	let errors: { message: string }[] = [];
	const warnings = await captureWarningsAsync(async () => {
		errors = await captureErrorsAsync(async () => {
			router.navTo("protected");
			statuses.push((await router.navigationSettled()).status);
			router.navTo("forbidden");
			statuses.push((await router.navigationSettled()).status);
		});
	});

	assert.deepEqual(statuses, [NavigationOutcome.Error, NavigationOutcome.Error], "bare path and cherry-pick fail");
	assert.deepEqual(
		warnings.map((w) => w.message).filter((message) => message.startsWith("guardRouter.")),
		[`guardRouter.guards: lazy load of "${path}" failed`, `guardRouter.guards: lazy load of "${path}" failed`],
		"each failed load warns",
	);
	assert.deepEqual(
		errors.map((entry) => entry.message).filter((message) => message.startsWith("Enter guard")),
		[
			'Enter guard [0] "doesNotExist" on route "protected" threw, navigation failed',
			'Enter guard [0] "doesNotExist#guard" on route "forbidden" threw, navigation failed',
		],
		"a guard that never loaded is logged as the manifest names it",
	);
});

QUnit.test("lazy mode: a failed preload is not an uncaught error", async function (assert: Assert) {
	const path = `${FIXTURES}/preloadDoesNotExist`;
	let unhandled: string[] = [];
	const preloadWarnings = await captureWarningsAsync(async () => {
		unhandled = await captureUnhandledRejections(async () => {
			router = createLazyRouter({ protected: [path] });
			await loadModule(path).catch(() => undefined);
		});
	});
	assert.deepEqual(unhandled, [], "the failed preload rejects no promise without a handler");
	assert.deepEqual(
		preloadWarnings.map((w) => w.message).filter((message) => message.startsWith("guardRouter.")),
		[],
		"the preload itself reports nothing",
	);

	router.initialize();
	await waitForRoute(router, "home");
	const warnings = await captureWarningsAsync(async () => {
		await captureErrorsAsync(async () => {
			router.navTo("protected");
			assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Error, "navigation fails");
		});
	});
	assert.deepEqual(
		warnings.map((w) => w.message).filter((message) => message.startsWith("guardRouter.")),
		[`guardRouter.guards: lazy load of "${path}" failed`],
		"the failure is reported once, when the guard runs",
	);
});

QUnit.test("lazy mode: cached module registers its guards at initialize", async function (assert: Assert) {
	const path = `${FIXTURES}/lazyCachedGuard`;
	await loadModule(path);
	const probe = await loadProbe();
	router = createLazyRouter({ protected: [path] });
	router.initialize();
	router.addRouteGuard("protected", () => {
		probe.calls.push("imperative");
		return true;
	});
	await waitForRoute(router, "home");

	router.navTo("protected");
	assert.strictEqual(getHash(), "protected", "committed within navTo");
	assert.deepEqual(
		probe.calls,
		["cachedFirst", "cachedSecond", "imperative"],
		"module guards run before guards added after initialize",
	);
});

QUnit.test("lazy mode: cached cherry-pick runs synchronously", async function (assert: Assert) {
	const path = `${FIXTURES}/objectGuard`;
	await loadModule(path);
	router = createLazyRouter({ protected: [`${path}#checkRole`], forbidden: [`${path}#missing`] });
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	assert.strictEqual(getHash(), "", "picked export blocked within navTo");
	const warnings = captureWarnings(() => {
		router.navTo("forbidden");
		assert.strictEqual(getHash(), "forbidden", "missing export: committed within navTo");
		router.navTo("home");
		router.navTo("forbidden");
	});
	assert.strictEqual(
		warnings.filter((w) => w.message.includes("#missing")).length,
		1,
		"missing export warns once, not per navigation",
	);
});

QUnit.module("Router - Multi-guard edge cases", hooks);

QUnit.test("empty array module warns and registers no guards", async function (assert: Assert) {
	const warnings = await captureWarningsAsync(async () => {
		router = new GuardRouterClass(
			[
				{ name: "home", pattern: "" },
				{ name: "protected", pattern: "protected" },
			],
			{
				async: true,
				guardRouter: {
					guardLoading: "block",
					unknownRouteRegistration: "ignore",
					guards: {
						protected: [`${FIXTURES}/emptyArrayGuard`],
					},
				},
			},
		);

		router.initialize();
		await waitForRoute(router, "home");
	});

	assert.deepEqual(
		warnings.map((w) => w.message).filter((message) => message.startsWith("guardRouter.")),
		[`guardRouter.guards: "${FIXTURES}/emptyArrayGuard" exported an empty array, skipping`],
		"one warning about the empty array export",
	);
	router.navTo("protected");
	assert.strictEqual(
		(await router.navigationSettled()).status,
		NavigationOutcome.Committed,
		"no guard was registered for the route",
	);
});

QUnit.test("leave guard from multi-guard object module", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteRegistration: "ignore",
				guards: {
					home: {
						leave: [`${FIXTURES}/objectGuard#checkRole`],
					},
				},
			},
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "cherry-picked leave guard from object module blocks");
});
