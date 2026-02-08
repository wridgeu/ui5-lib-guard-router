import type { wdi5Config } from "wdio-ui5-service";

export const config: wdi5Config = {
	wdi5: {
		logLevel: "verbose",
		waitForUI5Timeout: 30000,
	},
	runner: "local",
	specs: ["./e2e/**/*.e2e.ts"],
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
	baseUrl: "http://localhost:8080/index.html",
	waitforTimeout: 31000,
	connectionRetryTimeout: 120000,
	connectionRetryCount: 3,
	services: ["ui5"],
	framework: "mocha",
	reporters: ["spec"],
	mochaOpts: {
		ui: "bdd",
		timeout: 60000,
	},
};
