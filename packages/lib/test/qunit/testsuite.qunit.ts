/**
 * A test page: its files are loaded one after the other, in the listed order (see loadPage.ts).
 * A file is named by its path below this folder, without ".qunit.ts".
 */
interface TestPage {
	title: string;
	files: string[];
	qunit?: { testTimeout: number };
}

const tests: Record<string, TestPage> = {
	GuardPipeline: {
		title: "QUnit Tests for ui5.guard.router.GuardPipeline",
		files: ["unit/GuardPipeline", "unit/GuardPipelineAsync"],
	},
	GuardConfig: {
		title: "QUnit Tests for ui5.guard.router.GuardConfig",
		files: ["unit/GuardConfig"],
	},
	GuardModules: {
		title: "QUnit Tests for ui5.guard.router.GuardModules",
		files: ["unit/GuardModules"],
	},
	PatternTree: {
		title: "QUnit Tests for ui5.guard.router.PatternTree",
		files: ["unit/PatternTree"],
	},
	RouteMeta: {
		title: "QUnit Tests for ui5.guard.router.RouteMeta",
		files: ["unit/RouteMeta"],
	},
	Router: {
		title: "QUnit Tests for ui5.guard.router.Router",
		files: ["router/guards/GuardApi", "router/lifecycle/Lifecycle"],
	},
	RouterGuards: {
		title: "QUnit Tests for Router Guard Behavior",
		files: [
			"router/guards/EnterGuards",
			"router/guards/LeaveGuards",
			"router/guards/GreedyRoutes",
			"router/navigation/RedirectToShownRoute",
		],
	},
	RouterAsync: {
		title: "QUnit Tests for Router Async and Concurrency",
		files: ["router/async/AsyncGuards", "router/async/Concurrency", "router/async/Abort"],
	},
	RouterNavigation: {
		title: "QUnit Tests for Router Navigation Paths",
		files: [
			"router/navigation/HashChange",
			"router/navigation/NavToPreflight",
			"router/navigation/Redirects",
			"router/navigation/RedirectTargetGuards",
		],
	},
	RouterHistory: {
		title: "QUnit Tests for Router and Browser History",
		files: ["router/history/History"],
	},
	RouterSettlement: {
		title: "QUnit Tests for Router Settlement and Lifecycle",
		files: [
			"router/settlement/NavigationSettled",
			"router/settlement/SettlementErrors",
			"router/settlement/SettlementReentrancy",
			"router/lifecycle/DestroySettlement",
			"router/guards/LeaveGuardSettlement",
		],
	},
	RouterOptions: {
		title: "QUnit Tests for Router Options",
		files: ["router/lifecycle/Options"],
	},
	RouterManifestGuards: {
		title: "QUnit Tests for Router Manifest Guards",
		files: ["RouterManifestGuards"],
	},
	RouterRouteMeta: {
		title: "QUnit Tests for Router Route Metadata and Inheritance",
		files: ["router/meta/RouteMetadata", "router/meta/Inheritance", "router/meta/PatternAncestry"],
	},
	NativeRouterCompat: {
		title: "QUnit Tests for Native Router Compatibility",
		files: ["parity/native/NativeCompat", "parity/native/NativeCompatTraces"],
	},
	NestedRouterParity: {
		title: "QUnit Tests for Native Router Parity in Nested Components",
		files: ["parity/nested/NestedRouterParity"],
		// Each test starts the fixture app four times.
		qunit: {
			testTimeout: 30000,
		},
	},
	GuardedNavigationParity: {
		title: "QUnit Tests for Guard Decisions and their Native Equivalents",
		files: ["parity/guarded/GuardedNavigationParity"],
		// Each test starts the fixture app three times.
		qunit: {
			testTimeout: 30000,
		},
	},
	UpstreamParity: {
		title: "QUnit Tests for Vendored OpenUI5 Router Parity",
		files: ["upstream-parity/Current"],
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
