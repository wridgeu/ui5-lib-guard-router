import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { GuardRouter } from "ui5/guard/router/types";
import { captureWarningsAsync, GuardRouterClass, waitForRoute, createdRouterHooks } from "../../testHelpers";
import { FIXTURES } from "./manifestHelpers";

let router: GuardRouter;

const hooks = createdRouterHooks(() => router);

QUnit.module("Router - Cherry-pick syntax", hooks);

QUnit.test("cherry-pick by name from object module registers only that guard", async function (assert: Assert) {
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
		"cherry-picked checkAuth (returns true) allows navigation",
	);
});

QUnit.test("cherry-pick by name selects blocking guard", async function (assert: Assert) {
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
					protected: [`${FIXTURES}/objectGuard#checkRole`],
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
		NavigationOutcome.Blocked,
		"cherry-picked checkRole (returns false) blocks navigation",
	);
});

QUnit.test("cherry-pick by index from array module", async function (assert: Assert) {
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
					protected: [`${FIXTURES}/arrayGuard#1`],
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
		NavigationOutcome.Blocked,
		"cherry-picked index 1 (blockSecond) blocks navigation",
	);
});

QUnit.test(
	"cherry-pick by numeric index from object module resolves by insertion order",
	async function (assert: Assert) {
		// objectGuard exports { checkAuth (returns true), checkRole (returns false) }
		// #1 by insertion order = checkRole (blocks)
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
						protected: [`${FIXTURES}/objectGuard#1`],
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
			NavigationOutcome.Blocked,
			"numeric index #1 resolves to checkRole (second entry) which blocks",
		);
	},
);

QUnit.test("cherry-pick by numeric index 0 from object module resolves first entry", async function (assert: Assert) {
	// objectGuard exports { checkAuth (returns true), checkRole (returns false) }
	// #0 by insertion order = checkAuth (allows)
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
						protected: [`${FIXTURES}/objectGuard#0`],
					},
				},
			},
		);

		router.initialize();
		await waitForRoute(router, "home");
	});
	assert.deepEqual(warnings, [], "export resolved without a load or lookup warning");

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Committed,
		"numeric index #0 resolves to checkAuth (first entry) which allows",
	);
});

QUnit.test("cherry-pick from single-function module ignores # and still works", async function (assert: Assert) {
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
					protected: [`${FIXTURES}/blockGuard#nonexistent`],
				},
			},
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "function module still blocks despite #");
});

QUnit.test("invalid cherry-pick key warns and skips", async function (assert: Assert) {
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
						protected: [`${FIXTURES}/objectGuard#doesNotExist`],
					},
				},
			},
		);

		router.initialize();
		await waitForRoute(router, "home");
	});

	assert.ok(
		warnings.some((w) => w.message.includes("doesNotExist")),
		"warning logged for nonexistent export key",
	);
});

QUnit.test("global '*' with cherry-pick works", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "other", pattern: "other" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "lazy",
				unknownRouteRegistration: "ignore",
				guards: {
					"*": [`${FIXTURES}/objectGuard#checkRole`],
				},
			},
		},
	);

	router.initialize();
	const initial = await router.navigationSettled();
	router.navTo("other");
	const other = await router.navigationSettled();

	assert.deepEqual(
		[initial.status, other.status],
		[NavigationOutcome.Blocked, NavigationOutcome.Blocked],
		"the picked guard (checkRole) blocks the initial route and the next one",
	);
});

QUnit.test("module: prefix with cherry-pick composes correctly", async function (assert: Assert) {
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
						protected: ["module:ui5.guard.router.qunit.fixtures.guards.objectGuard#checkAuth"],
					},
				},
			},
		);

		router.initialize();
		await waitForRoute(router, "home");
	});
	assert.deepEqual(warnings, [], "export resolved without a load or lookup warning");

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Committed, "module: prefix + #checkAuth works together");
});
