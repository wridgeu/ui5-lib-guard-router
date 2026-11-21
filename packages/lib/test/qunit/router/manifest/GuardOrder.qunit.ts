import HashChanger from "sap/ui/core/routing/HashChanger";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { GuardRouter, GuardRouterOptions, Router$NavigationSettledEvent } from "ui5/guard/router/types";
import {
	captureErrors,
	captureWarnings,
	captureErrorsAsync,
	captureWarningsAsync,
	createRouterUnsafe,
	flushPromises,
	GuardRouterClass,
	getHash,
	loadModule,
	recordSettlements,
	waitForRoute,
	createdRouterHooks,
} from "../../testHelpers";
import { FIXTURES, type LazyProbe, ROUTES, createLazyRouter, loadProbe } from "./manifestHelpers";

let router: GuardRouter;

const hooks = createdRouterHooks(() => router);

QUnit.module("Router - Manifest guard order, shapes and lifecycle", hooks);

function createBlockRouter(
	guards: Record<string, string[]>,
	unknownRouteRegistration: GuardRouterOptions["unknownRouteRegistration"] = "ignore",
): GuardRouter {
	return new GuardRouterClass(ROUTES, {
		async: true,
		guardRouter: { guardLoading: "block", unknownRouteRegistration, guards },
	});
}

/** Resolve with the status of the first settlement, including one that happens while the router starts. */
function firstSettlement(target: GuardRouter): Promise<NavigationOutcome> {
	return new Promise((resolve) => {
		target.attachEventOnce("navigationSettled", (event: Router$NavigationSettledEvent) => {
			resolve(event.getParameter("status"));
		});
	});
}

function pushCall(probe: LazyProbe, name: string): () => true {
	return () => {
		probe.calls.push(name);
		return true;
	};
}

QUnit.test(
	"guards added before initialize() run before manifest guards, guards added after run after",
	async function (assert: Assert) {
		const path = `${FIXTURES}/lazyCachedGuard`;
		await loadModule(path);
		const probe = await loadProbe();
		router = createLazyRouter({ protected: [path] });
		router.addRouteGuard("protected", pushCall(probe, "before"));
		router.initialize();
		router.addRouteGuard("protected", pushCall(probe, "after"));
		await waitForRoute(router, "home");

		router.navTo("protected");
		await router.navigationSettled();
		assert.deepEqual(probe.calls, ["before", "cachedFirst", "cachedSecond", "after"]);
	},
);

QUnit.test("block mode: guards added while modules load run before manifest guards", async function (assert: Assert) {
	const probe = await loadProbe();
	router = createBlockRouter({ protected: [`${FIXTURES}/lazyCachedGuard`] });
	router.initialize();
	router.addRouteGuard("protected", pushCall(probe, "while loading"));
	await waitForRoute(router, "home");

	router.navTo("protected");
	await router.navigationSettled();
	assert.deepEqual(probe.calls, ["while loading", "cachedFirst", "cachedSecond"]);
});

QUnit.test("entries keep their declared positions, and a duplicate entry runs twice", async function (assert: Assert) {
	const cached = `${FIXTURES}/lazyCachedGuard`;
	const uncached = `${FIXTURES}/lazyUncachedPositionGuard`;
	await loadModule(cached);
	const probe = await loadProbe();
	router = createLazyRouter({ protected: [`${cached}#1`, uncached, cached, `${cached}#1`] });
	router.initialize();
	assert.strictEqual(sap.ui.require(uncached), undefined, "one entry's module was not cached yet");
	await waitForRoute(router, "home");

	const expected = ["cachedSecond", "uncachedPosition", "cachedFirst", "cachedSecond", "cachedSecond"];
	router.navTo("protected");
	assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Committed);
	assert.deepEqual(probe.calls, expected, "first navigation, which loads a module");

	router.navTo("home");
	await router.navigationSettled();
	probe.calls.length = 0;
	router.navTo("protected");
	assert.deepEqual(probe.calls, expected, "later navigation, within navTo");
});

for (const type of ["enter", "leave"] as const) {
	for (const [added, initial] of [
		["a descendant", { name: "employees", pattern: "employees" }],
		["an ancestor", { name: "employee", pattern: "employees/{id}" }],
	] as const) {
		QUnit.test(
			`pattern-tree: after addRoute() of ${added}, ancestor ${type} guards still run before descendant guards`,
			async function (assert: Assert) {
				const cached = `${FIXTURES}/lazyCachedGuard`;
				await loadModule(cached);
				const probe = await loadProbe();
				router = new GuardRouterClass([{ name: "home", pattern: "" }, initial], {
					async: true,
					guardRouter: {
						inheritance: "pattern-tree",
						unknownRouteRegistration: "ignore",
						guards: { employee: { [type]: [`${cached}#1`] }, employees: { [type]: [`${cached}#0`] } },
					},
				});
				router.initialize();
				await waitForRoute(router, "home");
				if (type === "enter") router.addRouteGuard("employee", pushCall(probe, "programmatic"));
				else router.addLeaveGuard("employee", pushCall(probe, "programmatic"));

				if (initial.name === "employees") router.addRoute({ name: "employee", pattern: "employees/{id}" });
				else router.addRoute({ name: "employees", pattern: "employees" });
				router.navTo("employee", { id: "1" });
				assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Committed);
				if (type === "leave") {
					assert.deepEqual(probe.calls, [], "no leave guard runs on entering");
					router.navTo("home");
					await router.navigationSettled();
				}

				assert.deepEqual(probe.calls, ["cachedFirst", "cachedSecond", "programmatic"]);
			},
		);
	}
}

const CACHED = `${FIXTURES}/lazyCachedGuard`;
const NAMED = `${FIXTURES}/namedExportGuard`;
const DEFAULT_WITH_NAMED = `${FIXTURES}/defaultWithNamedExportGuard`;

/** A pattern-tree router on `routes` with the cached fixture guards declared in `guards`. */
async function createPatternTreeRouter(
	routes: { name: string; pattern: string }[],
	guards: GuardRouterOptions["guards"],
): Promise<LazyProbe> {
	await Promise.all([CACHED, NAMED, DEFAULT_WITH_NAMED].map((path) => loadModule(path)));
	const probe = await loadProbe();
	router = new GuardRouterClass(routes, {
		async: true,
		guardRouter: { inheritance: "pattern-tree", unknownRouteRegistration: "ignore", guards },
	});
	router.initialize();
	await waitForRoute(router, "home");
	probe.calls.length = 0;
	return probe;
}

QUnit.test(
	"pattern-tree: addRoute() places an inherited guard among the guards of its own route and type",
	async function (assert: Assert) {
		// By pattern depth the entries rank home, top, mid, other, deep. The guard that deep
		// inherits from top goes in front of the enter guard of deep, not of the leave guard that
		// deep inherits from mid or of the enter guard of other, which rank in between.
		const probe = await createPatternTreeRouter(
			[
				{ name: "home", pattern: "" },
				{ name: "mid", pattern: "x/m" },
				{ name: "other", pattern: "o/{p}" },
				{ name: "deep", pattern: "x/m/d" },
			],
			{
				home: [`${CACHED}#0`],
				top: [`${NAMED}#namedFirst`],
				mid: { leave: [`${NAMED}#namedSecond`] },
				other: [DEFAULT_WITH_NAMED],
				deep: [`${CACHED}#1`],
			},
		);
		router.addRoute({ name: "top", pattern: "x" });

		router.navTo("deep");
		assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Committed);
		assert.deepEqual(probe.calls, ["cachedFirst", "namedFirst", "cachedSecond"]);
	},
);

QUnit.test(
	"pattern-tree: addRoute() places an inherited guard by rank, not by when the guards after it were added",
	async function (assert: Assert) {
		const probe = await createPatternTreeRouter(
			[
				{ name: "home", pattern: "" },
				{ name: "top", pattern: "x" },
				{ name: "deep", pattern: "x/a/b/d" },
			],
			{ top: [`${CACHED}#0`], a: [`${NAMED}#namedFirst`], b: [`${NAMED}#namedSecond`], deep: [`${CACHED}#1`] },
		);
		// Deep inherits the guard of b after its own, and then the one of a, which ranks before both.
		router.addRoute({ name: "b", pattern: "x/a/b" });
		router.addRoute({ name: "a", pattern: "x/a" });

		router.navTo("deep");
		assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Committed);
		assert.deepEqual(probe.calls, ["cachedFirst", "namedFirst", "namedSecond", "cachedSecond"]);
	},
);

QUnit.test("block mode guards the first navigation", async function (assert: Assert) {
	HashChanger.getInstance().setHash("protected");
	router = createBlockRouter({ protected: [`${FIXTURES}/blockGuard`] });
	const first = firstSettlement(router);
	router.initialize();

	assert.strictEqual(await first, NavigationOutcome.Blocked, "the start hash was guarded");
	assert.strictEqual(getHash(), "", "the router fell back to the root route");
});

QUnit.test(
	"lazy mode guards the first navigation with a module that is not cached yet",
	async function (assert: Assert) {
		const path = `${FIXTURES}/lazyUncachedFirstNavigationGuard`;
		HashChanger.getInstance().setHash("protected");
		router = createLazyRouter({ protected: [path] });
		const first = firstSettlement(router);
		router.initialize();
		assert.strictEqual(sap.ui.require(path), undefined, "module was not cached when the router started");

		assert.strictEqual(await first, NavigationOutcome.Blocked, "the start hash was guarded");
		assert.strictEqual(getHash(), "", "the router fell back to the root route");
	},
);

QUnit.test("lazy mode: uncached function module, named after the module in logs", async function (assert: Assert) {
	const path = `${FIXTURES}/lazyUncachedFunctionGuard`;
	const probe = await loadProbe();
	router = createLazyRouter({ protected: [path] });
	router.initialize();
	assert.strictEqual(sap.ui.require(path), undefined, "module was not cached when the guard was registered");
	await waitForRoute(router, "home");

	probe.behaviors = [
		() => {
			throw new Error("function guard failed");
		},
	];
	const errors = await captureErrorsAsync(async () => {
		router.navTo("protected");
		assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Error);
	});
	assert.deepEqual(
		errors.map((entry) => entry.message),
		['Enter guard [0] "lazyUncachedFunctionGuard" on route "protected" threw, navigation failed'],
	);

	probe.calls.length = 0;
	probe.behaviors = [];
	router.navTo("protected");
	assert.strictEqual(getHash(), "protected", "later navigation commits within navTo");
	assert.deepEqual(probe.calls, ["function"]);
});

QUnit.test(
	"lazy mode: uncached object module runs every key in order, logged under the module name",
	async function (assert: Assert) {
		const path = `${FIXTURES}/lazyUncachedObjectGuard`;
		const probe = await loadProbe();
		router = createLazyRouter({ protected: [path] });
		router.initialize();
		assert.strictEqual(sap.ui.require(path), undefined, "module was not cached when the guard was registered");
		await waitForRoute(router, "home");

		probe.behaviors = [
			() => true,
			() => {
				throw new Error("second key failed");
			},
		];
		const errors = await captureErrorsAsync(async () => {
			router.navTo("protected");
			assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Error);
		});
		assert.deepEqual(probe.calls, ["objectFirst", "objectSecond"]);
		assert.deepEqual(
			errors.map((entry) => entry.message),
			['Enter guard [0] "lazyUncachedObjectGuard" on route "protected" threw, navigation failed'],
			"one wrapper runs both guards, so the log names the module",
		);

		probe.calls.length = 0;
		probe.behaviors = [() => true, () => false];
		router.navTo("protected");
		assert.deepEqual(probe.calls, ["objectFirst", "objectSecond"], "later navigation runs both, within navTo");
		assert.strictEqual(getHash(), "", "and the second key blocks");
	},
);

QUnit.test("lazy mode: uncached array index and function #key picks", async function (assert: Assert) {
	const arrayPath = `${FIXTURES}/lazyUncachedArrayPickGuard`;
	const functionPath = `${FIXTURES}/lazyUncachedKeyedFunctionGuard`;
	const probe = await loadProbe();
	router = createLazyRouter({ protected: [`${arrayPath}#1`], forbidden: [`${functionPath}#anything`] });
	router.initialize();
	assert.strictEqual(sap.ui.require(arrayPath), undefined, "array module was not cached");
	assert.strictEqual(sap.ui.require(functionPath), undefined, "function module was not cached");
	await waitForRoute(router, "home");

	router.navTo("protected");
	assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Committed);
	router.navTo("forbidden");
	assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Committed);
	assert.deepEqual(
		probe.calls,
		["arraySecond", "keyedFunction"],
		"only the picked index; the key on a function is ignored",
	);

	probe.calls.length = 0;
	router.navTo("protected");
	assert.strictEqual(getHash(), "protected", "later navigation commits within navTo");
	router.navTo("forbidden");
	assert.strictEqual(getHash(), "forbidden", "later navigation commits within navTo");
	assert.deepEqual(probe.calls, ["arraySecond", "keyedFunction"]);
});

QUnit.test("lazy mode: cached array index and function #key picks run within navTo", async function (assert: Assert) {
	await loadModule(`${FIXTURES}/arrayGuard`);
	await loadModule(`${FIXTURES}/blockGuard`);
	router = createLazyRouter({
		protected: [`${FIXTURES}/arrayGuard#1`],
		forbidden: [`${FIXTURES}/blockGuard#anything`],
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	assert.strictEqual(getHash(), "", "array #1 (blockSecond) blocked within navTo");
	router.navTo("forbidden");
	assert.strictEqual(getHash(), "", "function module with a key blocked within navTo");
});

QUnit.test("lazy mode: modules with no usable guards warn and allow", async function (assert: Assert) {
	const uncached = `${FIXTURES}/lazyUncachedPrimitiveGuard`;
	await loadModule(`${FIXTURES}/emptyArrayGuard`);
	router = createLazyRouter({ protected: [`${FIXTURES}/emptyArrayGuard`], forbidden: [uncached] });
	const initWarnings = captureWarnings(() => router.initialize());
	assert.strictEqual(sap.ui.require(uncached), undefined, "primitive-export module was not cached");
	assert.ok(
		initWarnings.some((w) => w.message.includes("emptyArrayGuard") && w.message.includes("empty array")),
		"cached module warns at initialize",
	);
	await waitForRoute(router, "home");

	router.navTo("protected");
	assert.strictEqual(getHash(), "protected", "cached module without guards allows within navTo");

	const warnings = await captureWarningsAsync(async () => {
		router.navTo("forbidden");
		assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Committed);
		router.navTo("home");
		await router.navigationSettled();
		router.navTo("forbidden");
		await router.navigationSettled();
	});
	assert.deepEqual(
		warnings.filter((w) => w.message.includes("lazyUncachedPrimitiveGuard")).map((w) => w.message),
		[`guardRouter.guards: "${uncached}" did not export a function, array, or plain object, skipping`],
		"uncached module warns once, on first use",
	);
});

QUnit.test("lazy mode: destroy() while a module loads runs none of its guards", async function (assert: Assert) {
	const path = `${FIXTURES}/lazyUncachedDestroyGuard`;
	const probe = await loadProbe();
	router = createLazyRouter({ protected: [path] });
	router.initialize();
	assert.strictEqual(sap.ui.require(path), undefined, "module was not cached when the guard was registered");
	await waitForRoute(router, "home");

	router.navTo("protected");
	router.destroy();
	await loadModule(path);
	await flushPromises();
	assert.deepEqual(probe.calls, [], "the guard did not run after destroy()");
});

QUnit.test(
	'unknownRouteRegistration "throw" on a manifest guard logs and skips it (lazy mode)',
	async function (assert: Assert) {
		const block = `${FIXTURES}/blockGuard`;
		router = createRouterUnsafe(ROUTES, {
			async: true,
			guardRouter: {
				guardLoading: "lazy",
				unknownRouteRegistration: "throw",
				guards: { nope: [block], protected: [block] },
			},
		});
		const errors = captureErrors(() => router.initialize());
		assert.deepEqual(
			errors.map((entry) => entry.message),
			[`guardRouter.guards: failed to register "${block}"`],
			"initialize() does not throw; the error is logged",
		);
		await waitForRoute(router, "home");

		router.navTo("protected");
		assert.strictEqual(
			(await router.navigationSettled()).status,
			NavigationOutcome.Blocked,
			"other manifest guards still apply",
		);
	},
);

QUnit.test(
	'unknownRouteRegistration "throw" on a manifest guard logs and skips it (block mode)',
	async function (assert: Assert) {
		const block = `${FIXTURES}/blockGuard`;
		router = createBlockRouter({ nope: [block], protected: [block] }, "throw");
		const errors = await captureErrorsAsync(async () => {
			router.initialize();
			await waitForRoute(router, "home");
		});
		assert.deepEqual(
			errors.map((entry) => entry.message),
			[`guardRouter.guards: failed to register "${block}"`],
		);

		router.navTo("protected");
		assert.strictEqual(
			(await router.navigationSettled()).status,
			NavigationOutcome.Blocked,
			"other manifest guards still apply",
		);
	},
);

QUnit.test("block mode: stop() while modules load keeps the router stopped", async function (assert: Assert) {
	const block = `${FIXTURES}/blockGuard`;
	router = createBlockRouter({ protected: [block] });
	router.initialize();
	captureWarnings(() => router.stop());
	await loadModule(block);
	await flushPromises();
	assert.notOk(router.isInitialized(), "loading finished, but the router did not start");

	router.initialize();
	await waitForRoute(router, "home");
	router.navTo("protected");
	assert.strictEqual(
		(await router.navigationSettled()).status,
		NavigationOutcome.Blocked,
		"after initialize(), the manifest guards apply",
	);
});

QUnit.test(
	"block mode: initialize() again while modules load does not start the router early",
	async function (assert: Assert) {
		const block = `${FIXTURES}/blockGuard`;
		HashChanger.getInstance().setHash("protected");
		router = createBlockRouter({ protected: [block] });
		const first = firstSettlement(router);
		router.initialize();
		const warnings = captureWarnings(() => router.initialize());
		assert.notOk(router.isInitialized(), "not started before the guards are registered");
		assert.deepEqual(warnings, [], "the second call is not reported as a double initialize");

		assert.strictEqual(await first, NavigationOutcome.Blocked, "the start hash was guarded");
		assert.ok(router.isInitialized());
	},
);

QUnit.test(
	"block mode: initialize() again while modules load keeps the argument of the first call",
	async function (assert: Assert) {
		const block = `${FIXTURES}/blockGuard`;
		HashChanger.getInstance().setHash("protected");
		router = createBlockRouter({ protected: [block] });
		const statuses = recordSettlements(router);

		router.initialize();
		router.initialize(true);
		await loadModule(block);
		await flushPromises();

		assert.ok(router.isInitialized(), "the router started");
		assert.strictEqual(statuses[0], NavigationOutcome.Blocked, "the start hash was parsed and guarded");
	},
);

QUnit.test(
	"block mode: initialize() after stop() while modules load starts the router with its own argument",
	async function (assert: Assert) {
		const block = `${FIXTURES}/blockGuard`;
		HashChanger.getInstance().setHash("protected");
		router = createBlockRouter({ protected: [block] });
		const statuses = recordSettlements(router);

		router.initialize(true);
		captureWarnings(() => router.stop());
		router.initialize();
		await loadModule(block);
		await flushPromises();

		assert.ok(router.isInitialized(), "the router started once the modules were loaded");
		assert.strictEqual(statuses[0], NavigationOutcome.Blocked, "the start hash was parsed and guarded");
	},
);

QUnit.test("block mode: modules that load after destroy() register no guards", async function (assert: Assert) {
	const block = `${FIXTURES}/blockGuard`;
	router = createBlockRouter({ nope: [block] }, "throw");
	const errors = await captureErrorsAsync(async () => {
		router.initialize();
		router.destroy();
		await loadModule(block);
		await flushPromises();
	});
	assert.deepEqual(errors, [], "no guard was registered, so none failed to register");
	assert.notOk(router.isInitialized(), "the router was not initialized");
});

QUnit.test(
	'unknownRouteRegistration "warn" registers a manifest guard for an unknown route with one warning',
	async function (assert: Assert) {
		const block = `${FIXTURES}/blockGuard`;
		await loadModule(block);
		router = createRouterUnsafe(ROUTES, {
			async: true,
			guardRouter: { guardLoading: "lazy", unknownRouteRegistration: "warn", guards: { nope: [block] } },
		});
		const warnings = captureWarnings(() => router.initialize());
		assert.deepEqual(
			warnings.map((w) => [w.message, w.details]),
			[["addRouteGuard: unknown route, guard registered anyway", "nope"]],
		);
	},
);

QUnit.test(
	'unknownRouteRegistration "warn" reports a manifest leave guard for an unknown route as addLeaveGuard',
	async function (assert: Assert) {
		const leave = `${FIXTURES}/leaveGuard`;
		await loadModule(leave);
		router = createRouterUnsafe(ROUTES, {
			async: true,
			guardRouter: {
				guardLoading: "lazy",
				unknownRouteRegistration: "warn",
				guards: { nope: { leave: [leave] } },
			},
		});
		const warnings = captureWarnings(() => router.initialize());
		assert.deepEqual(
			warnings.map((w) => [w.message, w.details]),
			[["addLeaveGuard: unknown route, guard registered anyway", "nope"]],
		);
	},
);

QUnit.test(
	"addRoute() registers an inherited guard whose module is not cached yet (lazy mode)",
	async function (assert: Assert) {
		const path = `${FIXTURES}/lazyUncachedInheritedGuard`;
		router = createRouterUnsafe(
			[
				{ name: "home", pattern: "" },
				{ name: "employees", pattern: "employees" },
			],
			{
				async: true,
				guardRouter: { guardLoading: "lazy", inheritance: "pattern-tree", guards: { employees: [path] } },
			},
		);
		router.initialize();
		router.addRoute({ name: "employee", pattern: "employees/{id}" });
		assert.strictEqual(sap.ui.require(path), undefined, "module was not cached when the route was added");
		await waitForRoute(router, "home");

		router.navTo("employee", { id: "1" });
		assert.strictEqual(
			(await router.navigationSettled()).status,
			NavigationOutcome.Blocked,
			"the new route inherited the guard",
		);
	},
);

/** Resolve with the resource timing entry once the browser has fetched a file whose URL ends with `fileName`. */
function whenFetched(fileName: string): Promise<PerformanceEntry> {
	return new Promise((resolve) => {
		const observer = new PerformanceObserver((list) => {
			const entry = list.getEntries().find((e) => e.name.endsWith(`/${fileName}`));
			if (entry) {
				observer.disconnect();
				resolve(entry);
			}
		});
		observer.observe({ type: "resource", buffered: true });
	});
}

QUnit.test("lazy mode starts loading guard modules in the constructor", async function (assert: Assert) {
	const path = `${FIXTURES}/lazyPreloadGuard`;
	assert.strictEqual(sap.ui.require(path), undefined, "module was not cached before the router existed");
	const fetched = whenFetched("lazyPreloadGuard.js");

	// initialize() is never called: the constructor alone starts the fetch.
	router = createLazyRouter({ protected: [path] });

	assert.ok((await fetched).name.endsWith("lazyPreloadGuard.js"), "the module was fetched");
});

QUnit.test("block mode starts loading guard modules in initialize()", async function (assert: Assert) {
	const path = `${FIXTURES}/blockDeferredGuard`;
	const fetched = whenFetched("blockDeferredGuard.js");

	router = createBlockRouter({ protected: [path] });
	await flushPromises();
	const initialized = performance.now();
	router.initialize();

	assert.ok((await fetched).startTime >= initialized, "the constructor did not fetch the module");
});

QUnit.test("block mode without manifest guards starts the router within initialize()", function (assert: Assert) {
	router = createBlockRouter({});
	router.initialize();
	assert.ok(router.isInitialized(), "nothing to load, so the start is not deferred");
});

QUnit.test("block mode: navTo() while modules load is guarded once the router starts", async function (assert: Assert) {
	router = createBlockRouter({ protected: [`${FIXTURES}/blockGuard`] });
	let matched = false;
	router.getRoute("protected")!.attachMatched(() => {
		matched = true;
	});
	const statuses = recordSettlements(router);

	router.initialize();
	assert.notOk(router.isInitialized(), "the modules are still loading");
	router.navTo("protected");
	assert.deepEqual(statuses, [], "nothing settled: the router does not handle navigation yet");

	await waitForRoute(router, "home");
	assert.deepEqual(
		statuses,
		[NavigationOutcome.Blocked, NavigationOutcome.Committed],
		"the manifest guard blocked the hash, then the router fell back to the empty hash",
	);
	assert.notOk(matched, "the guarded route was never displayed");
	assert.strictEqual(getHash(), "");
});

QUnit.test(
	"block mode: initialize(true) leaves the current hash unparsed once the modules are loaded",
	async function (assert: Assert) {
		HashChanger.getInstance().setHash("protected");
		router = createBlockRouter({ protected: [`${FIXTURES}/blockGuard`] });
		const statuses = recordSettlements(router);

		router.initialize(true);
		while (!router.isInitialized()) await flushPromises();
		await flushPromises();

		assert.deepEqual(statuses, [], "the initial hash was not parsed, so nothing settled");
		assert.strictEqual(getHash(), "protected", "the hash is untouched");
	},
);

QUnit.test(
	"pattern-tree: an ancestor's guard runs first even when the descendant is declared first",
	async function (assert: Assert) {
		const path = `${FIXTURES}/lazyCachedGuard`;
		const probe = await loadProbe();
		router = createRouterUnsafe(
			[
				{ name: "home", pattern: "" },
				{ name: "employees", pattern: "employees" },
				{ name: "employee", pattern: "employees/{id}" },
			],
			{
				async: true,
				guardRouter: {
					inheritance: "pattern-tree",
					guards: { employee: [`${path}#1`], employees: [`${path}#0`] },
				},
			},
		);
		router.initialize();
		await waitForRoute(router, "home");

		router.navTo("employee", { id: "1" });
		await router.navigationSettled();
		assert.deepEqual(probe.calls, ["cachedFirst", "cachedSecond"], "inherited guard first, own guard second");
	},
);
