import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { GuardContext, GuardRouter } from "ui5/guard/router/types";
import {
	captureWarnings,
	captureWarningsAsync,
	createRouterUnsafe,
	GuardRouterClass,
	waitForRoute,
	createdRouterHooks,
} from "../../testHelpers";
import { FIXTURES } from "./manifestHelpers";

let router: GuardRouter;

const hooks = createdRouterHooks(() => router);

// ============================================================
// Module: Invalid manifest guard config
// ============================================================
QUnit.module("Router - Invalid manifest guard config", hooks);

QUnit.test("guards value is not a plain object (array) warns and registers no guards", async function (assert: Assert) {
	const warnings = captureWarnings(() => {
		router = createRouterUnsafe(
			[
				{ name: "home", pattern: "" },
				{ name: "protected", pattern: "protected" },
			],
			{
				async: true,
				guardRouter: {
					guardLoading: "block",
					guards: [1, 2, 3],
				},
			},
		);
	});

	assert.ok(
		warnings.some((w) => w.message.includes("not a plain object")),
		"warning logged for non-object guards value",
	);

	router.initialize();
	await waitForRoute(router, "home");

	// No manifest guards registered, so navigation should be allowed
	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "no guards block navigation");
});

QUnit.test("invalid entries in shorthand array warn and are skipped", function (assert: Assert) {
	const warnings = captureWarnings(() => {
		router = createRouterUnsafe([{ name: "home", pattern: "" }], {
			async: true,
			guardRouter: {
				guardLoading: "block",
				guards: { home: [42, null, ""] },
			},
		});
	});

	const invalidEntryWarnings = warnings.filter((w) => w.message.includes("invalid entry"));
	assert.strictEqual(invalidEntryWarnings.length, 3, "one warning per invalid entry (42, null, empty string)");
});

QUnit.test("'*' with object form warns about leave and still registers enter guard", async function (assert: Assert) {
	const warnings = captureWarnings(() => {
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
						"*": {
							enter: [`${FIXTURES}/bagWriterGuard`],
							leave: [`${FIXTURES}/blockGuard`],
						},
					},
				},
			},
		);
	});

	assert.ok(
		warnings.some((w) => w.message.includes("global leave guards are not supported")),
		"warning logged about global leave guards",
	);

	router.initialize();
	await waitForRoute(router, "home");

	let writerValue: unknown;
	router.addRouteGuard("protected", (context: GuardContext) => {
		writerValue = context.bag.get("writer");
		return true;
	});

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "skipped '*' leave guard did not block");
	assert.strictEqual(writerValue, "was-here", "enter guard from '*' still registered and ran");
});

// ============================================================
// Module: Invalid guard module exports
// ============================================================
QUnit.module("Router - Invalid guard module exports", hooks);

QUnit.test("module exporting a primitive warns and is skipped", async function (assert: Assert) {
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
						protected: [`${FIXTURES}/primitiveExportGuard`],
					},
				},
			},
		);

		router.initialize();
		await waitForRoute(router, "home");
	});

	assert.ok(
		warnings.some((w) => w.message.includes("did not export a function, array, or plain object")),
		"warning logged for primitive module export",
	);

	// No valid guard registered, so navigation should succeed
	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "primitive export skipped, navigation allowed");
});

QUnit.test(
	"array module with non-function entries warns and registers only functions",
	async function (assert: Assert) {
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
							protected: [`${FIXTURES}/mixedArrayGuard`],
						},
					},
				},
			);

			router.initialize();
			await waitForRoute(router, "home");
		});

		assert.deepEqual(
			warnings.filter((w) => w.message.includes("mixedArrayGuard")).map((w) => w.message),
			[`guardRouter.guards: "${FIXTURES}/mixedArrayGuard" [1] is not a function, skipping`],
			"only the non-function entry at index 1 warns",
		);

		// Index 0 allows, index 2 blocks: Blocked proves the entry after the skipped one was registered
		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(
			result.status,
			NavigationOutcome.Blocked,
			"valid function guards registered, including the one after the skipped entry",
		);
	},
);

QUnit.test("cherry-pick with out-of-range index warns and skips", async function (assert: Assert) {
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
						protected: [`${FIXTURES}/arrayGuard#99`],
					},
				},
			},
		);

		router.initialize();
		await waitForRoute(router, "home");
	});

	assert.ok(
		warnings.some((w) => w.message.includes("#99") && w.message.includes("out of range")),
		"warning logged for out-of-range index",
	);

	// No guard registered, navigation should succeed
	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "out-of-range index skipped, navigation allowed");
});
