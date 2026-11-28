import type { GuardRouter } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import { GuardRouterClass, waitForRoute, createdRouterHooks } from "../../testHelpers";

let router: GuardRouter;

QUnit.module(
	"Router - Pattern ancestry edge cases",
	createdRouterHooks(() => router),
);

QUnit.test("metadata inherits when parent and child use different parameter names", function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "employees", pattern: "employees/{empId}" },
			{ name: "employeeResume", pattern: "employees/{id}/resume" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				routeMeta: { employees: { section: "hr" } },
			},
		},
	);

	const meta = router.getRouteMeta("employeeResume");
	assert.strictEqual(meta.section, "hr", "child inherits despite different parameter name");
});

QUnit.test("optional parameter segments do not break ancestry detection", function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "products", pattern: "products/:sort:" },
			{ name: "product", pattern: "products/{id}" },
			{ name: "productDetail", pattern: "products/{id}/detail" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				routeMeta: { products: { category: "catalog" } },
			},
		},
	);

	const detailMeta = router.getRouteMeta("productDetail");
	assert.strictEqual(detailMeta.category, "catalog", "grandchild inherits through optional-param parent");
});

QUnit.test("inline query parameter suffix does not affect ancestry", function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "search", pattern: "search{?query}" },
			{ name: "searchResult", pattern: "search/{id}" },
			{ name: "searchResultDetail", pattern: "search/{id}/detail" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				routeMeta: { search: { filterable: true } },
			},
		},
	);

	const detailMeta = router.getRouteMeta("searchResultDetail");
	assert.strictEqual(detailMeta.filterable, true, "inline query suffix on ancestor does not block inheritance");
});

QUnit.test("inline optional query suffix does not affect ancestry", function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "catalog", pattern: "catalog:?query:" },
			{ name: "catalogItem", pattern: "catalog/{id}" },
			{ name: "catalogItemDetail", pattern: "catalog/{id}/detail" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				routeMeta: { catalog: { browsable: true } },
			},
		},
	);

	const detailMeta = router.getRouteMeta("catalogItemDetail");
	assert.strictEqual(
		detailMeta.browsable,
		true,
		"inline optional query suffix on ancestor does not block inheritance",
	);
});

QUnit.test("rest parameter segments do not affect ancestry", function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "docs", pattern: "docs/:path*:" },
			{ name: "docsSection", pattern: "docs/{section}" },
			{ name: "docsPage", pattern: "docs/{section}/{page}" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				routeMeta: { docs: { layout: "reader" } },
			},
		},
	);

	const pageMeta = router.getRouteMeta("docsPage");
	assert.strictEqual(pageMeta.layout, "reader", "rest segment on ancestor does not block inheritance");
});

QUnit.test("sibling routes do not inherit from each other", function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "employees", pattern: "employees" },
			{ name: "employeeList", pattern: "employees/list" },
			{ name: "employeeNew", pattern: "employees/new" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				routeMeta: { employeeList: { view: "list" } },
			},
		},
	);

	const newMeta = router.getRouteMeta("employeeNew");
	assert.deepEqual(newMeta, {}, "sibling route does not inherit from another sibling");
});

QUnit.test("guard inheritance works with mixed parameter names", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "order", pattern: "orders/{orderId}" },
			{ name: "orderItems", pattern: "orders/{id}/items" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				inheritance: "pattern-tree",
				guards: {
					order: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
				},
			},
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("orderItems", { id: "99" });
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"ancestor guard propagated despite different param name",
	);
});

QUnit.test("mandatory param combined with inline query does not break ancestry", function (assert: Assert) {
	// UI5 allows {id}{?query}. The query portion is stripped, leaving just {id}
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "product", pattern: "products/{id}{?query}" },
			{ name: "productReviews", pattern: "products/{id}/reviews" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				routeMeta: { product: { tracked: true } },
			},
		},
	);

	const reviewMeta = router.getRouteMeta("productReviews");
	assert.strictEqual(reviewMeta.tracked, true, "child inherits from parent with {param}{?query} combo");
});

QUnit.test("optional parameter in mid-path position does not block inheritance", function (assert: Assert) {
	// :mode: between two mandatory segments is left out: the mandatory path is "app/settings".
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "app", pattern: "app" },
			{ name: "appSettings", pattern: "app/:mode:/settings" },
			{ name: "appSetting", pattern: "app/:mode:/settings/{id}" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				routeMeta: { app: { layout: "shell" }, appSettings: { area: "settings" } },
			},
		},
	);

	assert.deepEqual(
		router.getRouteMeta("appSettings"),
		{ layout: "shell", area: "settings" },
		"a route with a mid-path optional param inherits from its ancestor",
	);
	assert.deepEqual(
		router.getRouteMeta("appSetting"),
		{ layout: "shell", area: "settings" },
		"and is the ancestor of the route below it",
	);
});

QUnit.test("all-optional pattern is not treated as ancestor of other routes", function (assert: Assert) {
	// Pattern ":mode:" consists entirely of optional segments. Should NOT be ancestor of anything
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "catchMode", pattern: ":mode:" },
			{ name: "employees", pattern: "employees" },
			{ name: "employee", pattern: "employees/{id}" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				routeMeta: { catchMode: { fromCatchall: true } },
			},
		},
	);

	const employeesMeta = router.getRouteMeta("employees");
	assert.strictEqual(
		employeesMeta.fromCatchall,
		undefined,
		"all-optional pattern does not propagate metadata to other routes",
	);
	const employeeMeta = router.getRouteMeta("employee");
	assert.strictEqual(
		employeeMeta.fromCatchall,
		undefined,
		"all-optional pattern does not propagate metadata to deeper routes",
	);
});

QUnit.test("multiple consecutive optional params are ignored for ancestry", function (assert: Assert) {
	// Pattern "reports/:year:/:month:". Only "reports" is mandatory
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "reports", pattern: "reports/:year:/:month:" },
			{ name: "report", pattern: "reports/{id}" },
			{ name: "reportDetail", pattern: "reports/{id}/detail" },
		],
		{
			async: true,
			guardRouter: {
				inheritance: "pattern-tree",
				routeMeta: { reports: { section: "analytics" } },
			},
		},
	);

	const detailMeta = router.getRouteMeta("reportDetail");
	assert.strictEqual(
		detailMeta.section,
		"analytics",
		"grandchild inherits through ancestor with multiple optional params",
	);
});

QUnit.test(
	"distinct empty-pattern routes do not inherit metadata or guards from each other",
	async function (assert: Assert) {
		router = new GuardRouterClass(
			[
				{ name: "home", pattern: "" },
				{ name: "shell", pattern: "" },
				{ name: "employees", pattern: "employees" },
			],
			{
				async: true,
				guardRouter: {
					guardLoading: "block",
					inheritance: "pattern-tree",
					routeMeta: {
						home: { area: "home" },
						shell: { chrome: "shell" },
					},
					guards: {
						home: ["ui5/guard/router/qunit/fixtures/guards/allowGuard"],
						shell: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
					},
				},
			},
		);

		assert.deepEqual(router.getRouteMeta("home"), { area: "home" }, "home does not inherit shell metadata");
		assert.deepEqual(router.getRouteMeta("shell"), { chrome: "shell" }, "shell does not inherit home metadata");
		assert.deepEqual(
			router.getRouteMeta("employees"),
			{ area: "home", chrome: "shell" },
			"non-empty descendant inherits from both empty-pattern routes",
		);

		router.initialize();
		await waitForRoute(router, "home");

		router.navTo("employees");
		const result = await router.navigationSettled();
		assert.strictEqual(
			result.status,
			NavigationOutcome.Blocked,
			"non-empty descendant inherits guard from empty-pattern route",
		);
	},
);
