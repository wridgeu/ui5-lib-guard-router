import type { wdi5Config } from "wdio-ui5-service";
import { config as baseConfig } from "./wdio.conf";

export const config: wdi5Config = {
	...baseConfig,
	specs: ["./flp/**/*.e2e.ts"],
	baseUrl: "http://localhost:8080/test/flp.html#app-preview",
};
