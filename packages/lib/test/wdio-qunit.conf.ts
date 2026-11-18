import { chromeProfileHooks } from "./wdio-chrome-profile";

const baseUrl = process.env.UI5_TEST_BASE_URL ?? "http://localhost:8080";

export const config: WebdriverIO.Config = {
	...chromeProfileHooks(),
	runner: "local",
	specs: [],
	maxInstances: 1,
	capabilities: [
		{
			browserName: "chrome",
			"goog:chromeOptions": {
				args: ["--headless=new", "--no-sandbox", "--disable-gpu", "--window-size=1920,1080"],
			},
			acceptInsecureCerts: true,
		},
	],
	logLevel: "error",
	bail: 0,
	baseUrl,
	waitforTimeout: 90000,
	connectionRetryTimeout: 120000,
	connectionRetryCount: 3,
	services: [
		[
			"qunit",
			{
				paths: [
					"resources/sap/ui/test/starter/Test.qunit.html?testsuite=test-resources/ui5/guard/router/qunit/testsuite.qunit&test=Router",
					"resources/sap/ui/test/starter/Test.qunit.html?testsuite=test-resources/ui5/guard/router/qunit/testsuite.qunit&test=RouterGuards",
					"resources/sap/ui/test/starter/Test.qunit.html?testsuite=test-resources/ui5/guard/router/qunit/testsuite.qunit&test=RouterAsync",
					"resources/sap/ui/test/starter/Test.qunit.html?testsuite=test-resources/ui5/guard/router/qunit/testsuite.qunit&test=RouterNavigation",
					"resources/sap/ui/test/starter/Test.qunit.html?testsuite=test-resources/ui5/guard/router/qunit/testsuite.qunit&test=RouterSettlement",
					"resources/sap/ui/test/starter/Test.qunit.html?testsuite=test-resources/ui5/guard/router/qunit/testsuite.qunit&test=RouterOptions",
					"resources/sap/ui/test/starter/Test.qunit.html?testsuite=test-resources/ui5/guard/router/qunit/testsuite.qunit&test=RouterManifestGuards",
					"resources/sap/ui/test/starter/Test.qunit.html?testsuite=test-resources/ui5/guard/router/qunit/testsuite.qunit&test=RouterRouteMeta",
					"resources/sap/ui/test/starter/Test.qunit.html?testsuite=test-resources/ui5/guard/router/qunit/testsuite.qunit&test=NativeRouterCompat",
					"resources/sap/ui/test/starter/Test.qunit.html?testsuite=test-resources/ui5/guard/router/qunit/testsuite.qunit&test=NestedRouterParity",
					"resources/sap/ui/test/starter/Test.qunit.html?testsuite=test-resources/ui5/guard/router/qunit/testsuite.qunit&test=UpstreamParity",
					"resources/sap/ui/test/starter/Test.qunit.html?testsuite=test-resources/ui5/guard/router/qunit/testsuite.qunit&test=GuardPipeline",
					"resources/sap/ui/test/starter/Test.qunit.html?testsuite=test-resources/ui5/guard/router/qunit/testsuite.qunit&test=GuardConfig",
					"resources/sap/ui/test/starter/Test.qunit.html?testsuite=test-resources/ui5/guard/router/qunit/testsuite.qunit&test=GuardModules",
					"resources/sap/ui/test/starter/Test.qunit.html?testsuite=test-resources/ui5/guard/router/qunit/testsuite.qunit&test=PatternTree",
					"resources/sap/ui/test/starter/Test.qunit.html?testsuite=test-resources/ui5/guard/router/qunit/testsuite.qunit&test=RouteMeta",
				],
			},
		],
	],
	framework: "mocha",
	reporters: ["spec"],
	mochaOpts: {
		ui: "bdd",
		timeout: 120000,
	},
};
