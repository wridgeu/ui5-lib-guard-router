/**
 * A test page is a folder: the key is its path below this folder, `files` are its test files
 * without ".qunit.ts". loadPage.ts loads them one after the other, in the listed order.
 */
interface TestPage {
	title: string;
	files: string[];
	qunit?: { testTimeout: number };
}

const tests: Record<string, TestPage> = {
	unit: {
		title: "Modules of the library without a router",
		files: ["GuardPipeline", "GuardPipelineAsync", "GuardConfig", "GuardModules", "PatternTree", "RouteMeta"],
	},
	"router/guards": {
		title: "Router: guard API, enter guards, leave guards, greedy routes",
		files: ["GuardApi", "EnterGuards", "LeaveGuards", "GreedyRoutes"],
	},
	"router/lifecycle": {
		title: "Router: lifecycle and options",
		files: ["Lifecycle", "Options"],
	},
	"router/navigation": {
		title: "Router: hash changes, navTo preflight, redirects",
		files: ["HashChange", "NavToPreflight", "Redirects", "RedirectTargetGuards"],
	},
	"router/async": {
		title: "Router: async guards, concurrency, abort",
		files: ["AsyncGuards", "Concurrency", "Abort"],
	},
	"router/settlement": {
		title: "Router: navigationSettled",
		files: ["NavigationSettled", "SettlementErrors", "SettlementReentrancy"],
	},
	"router/meta": {
		title: "Router: route metadata and inheritance",
		files: ["RouteMetadata", "Inheritance", "PatternAncestry"],
	},
	"router/manifest": {
		title: "Router: guards declared in the manifest",
		files: ["DeclarativeGuards", "Instantiation", "CherryPick", "MultiGuardModules", "InvalidConfig", "GuardOrder"],
	},
	"parity/native": {
		title: "Parity with the native router",
		files: ["NativeCompat", "NativeCompatTraces"],
	},
	"upstream-parity": {
		title: "Vendored OpenUI5 router tests",
		files: ["Current"],
	},
	// The pages below step through the browser history. Chrome ignores such a step on a page that
	// changed the hash about 200 times within ten seconds, so no other test joins these pages.
	"router/history": {
		title: "Router: browser history",
		files: ["History"],
	},
	"parity/nested": {
		title: "Parity with the native router in nested components",
		files: ["NestedRouterParity"],
		// Each test starts the fixture app four times.
		qunit: {
			testTimeout: 30000,
		},
	},
	"parity/guarded": {
		title: "Guard decisions and their native equivalents",
		files: ["GuardedNavigationParity"],
		// Each test starts the fixture app three times.
		qunit: {
			testTimeout: 30000,
		},
	},
};

export default {
	name: "QUnit TestSuite for ui5.guard.router",
	defaults: {
		qunit: {
			version: 2,
			reorder: false,
			// Fails a test whose awaited router event never comes; no test waits on time.
			testTimeout: 10000,
		},
		sinon: {
			version: 4,
			qunitBridge: true,
			useFakeTimers: false,
		},
		ui5: {
			libs: "ui5.guard.router,sap.m",
			theme: "sap_horizon",
		},
		coverage: {
			only: "ui5/guard/router/",
			never: "test-resources/ui5/guard/router/",
		},
		loader: {
			paths: {
				"ui5/guard/router": "resources/ui5/guard/router",
				// Guard fixtures that manifest guard tests load by module name.
				"ui5/guard/router/qunit/fixtures": "test-resources/ui5/guard/router/qunit/fixtures",
			},
		},
		module: "./loadPage",
	},
	tests,
};
