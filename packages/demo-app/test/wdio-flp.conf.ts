import type { wdi5Config } from "wdio-ui5-service";
import { config as baseConfig } from "./wdio.conf";

const baseUrl =
	process.env.UI5_TEST_BASE_URL ?? "http://localhost:8080/test/flp.html?sap-ui-xx-viewCache=false#app-preview";

export const config: wdi5Config = {
	...baseConfig,
	specs: ["./flp/**/*.e2e.ts"],
	baseUrl,
};
