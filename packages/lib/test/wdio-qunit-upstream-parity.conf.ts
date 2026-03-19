import { config as baseConfig } from "./wdio-qunit.conf";

const baseUrl = process.env.UI5_TEST_BASE_URL ?? "http://localhost:8084";

export const config: WebdriverIO.Config = {
	...baseConfig,
	baseUrl,
	services: [
		[
			"qunit",
			{
				paths: [
					"resources/sap/ui/test/starter/Test.qunit.html?testsuite=test-resources/ui5/guard/router/qunit/testsuite.qunit&test=UpstreamParity",
				],
			},
		],
	],
};
