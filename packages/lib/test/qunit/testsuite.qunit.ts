export default {
	name: "QUnit TestSuite for ui5.guard.router",
	defaults: {
		qunit: {
			version: 2,
			reorder: false,
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
		Router: {
			title: "QUnit Tests for ui5.guard.router.Router",
		},
		NativeRouterCompat: {
			title: "QUnit Tests for Native Router Compatibility",
		},
	},
};
