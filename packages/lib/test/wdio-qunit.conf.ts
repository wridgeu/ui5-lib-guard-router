export const config: WebdriverIO.Config = {
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
	baseUrl: "http://localhost:8080",
	waitforTimeout: 90000,
	connectionRetryTimeout: 120000,
	connectionRetryCount: 3,
	services: [
		[
			"qunit",
			{
				paths: [
					"resources/sap/ui/test/starter/Test.qunit.html?testsuite=test-resources/ui5/guard/router/qunit/testsuite.qunit&test=Router",
					"resources/sap/ui/test/starter/Test.qunit.html?testsuite=test-resources/ui5/guard/router/qunit/testsuite.qunit&test=NativeRouterCompat",
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
