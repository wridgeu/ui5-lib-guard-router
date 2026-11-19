import suite from "./qunit/testsuite.qunit";
import { chromeProfileHooks } from "../../../tools/wdio-chrome-profile";

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
				paths: Object.keys(suite.tests).map(
					(page) =>
						`resources/sap/ui/test/starter/Test.qunit.html?testsuite=test-resources/ui5/guard/router/qunit/testsuite.qunit&test=${page}`,
				),
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
