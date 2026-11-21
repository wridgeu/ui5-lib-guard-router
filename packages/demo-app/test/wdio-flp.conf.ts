import type { wdi5Config } from "wdio-ui5-service";
import { config as baseConfig } from "./wdio.conf";

const baseUrl =
	process.env.UI5_TEST_BASE_URL ?? "http://localhost:8080/test/flp.html?sap-ui-xx-viewCache=false#app-preview";

export const config: wdi5Config = {
	...baseConfig,
	specs: ["./flp/**/*.e2e.ts"],
	baseUrl,
	// The shadow-root tracking of WebdriverIO subscribes to console entries (no FLP spec pierces shadow
	// DOM). WebDriver BiDi sends events in order, and Chrome reads the arguments of a console entry
	// from the page: when the launchpad logs an error object and opens the confirm dialog of unsaved
	// data right after, the page is blocked, the entry stays pending and the dialog event behind it
	// never reaches the "dialog" listeners of the specs.
	before: async () => {
		await browser.sessionUnsubscribe({ events: ["log.entryAdded"] });
	},
};
