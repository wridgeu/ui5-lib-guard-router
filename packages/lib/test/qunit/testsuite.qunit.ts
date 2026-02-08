export default {
	name: "QUnit TestSuite for ui5.ext.routing",
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
			libs: "ui5.ext.routing,sap.m",
			theme: "sap_horizon",
		},
		coverage: {
			only: "ui5/ext/routing/",
			never: "test-resources/ui5/ext/routing/",
		},
		loader: {
			paths: {
				"ui5/ext/routing": "resources/ui5/ext/routing",
			},
		},
		module: "./{name}.qunit",
	},
	tests: {
		Router: {
			title: "QUnit Tests for ui5.ext.routing.Router",
		},
		NativeRouterCompat: {
			title: "QUnit Tests for Native Router Compatibility",
		},
	},
};
