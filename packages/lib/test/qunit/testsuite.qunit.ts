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
			},
		},
		module: "./{name}.qunit",
	},
	tests: {
		GuardPipeline: {
			title: "QUnit Tests for ui5.guard.router.GuardPipeline",
		},
		GuardConfig: {
			title: "QUnit Tests for ui5.guard.router.GuardConfig",
		},
		GuardModules: {
			title: "QUnit Tests for ui5.guard.router.GuardModules",
		},
		PatternTree: {
			title: "QUnit Tests for ui5.guard.router.PatternTree",
		},
		Router: {
			title: "QUnit Tests for ui5.guard.router.Router",
		},
		RouterGuards: {
			title: "QUnit Tests for Router Guard Behavior",
		},
		RouterAsync: {
			title: "QUnit Tests for Router Async and Concurrency",
		},
		RouterNavigation: {
			title: "QUnit Tests for Router Navigation Paths",
		},
		RouterSettlement: {
			title: "QUnit Tests for Router Settlement and Lifecycle",
		},
		RouterOptions: {
			title: "QUnit Tests for Router Options and Manifest Guards",
		},
		NativeRouterCompat: {
			title: "QUnit Tests for Native Router Compatibility",
		},
		UpstreamParity: {
			title: "QUnit Tests for Vendored OpenUI5 Router Parity",
		},
	},
};
