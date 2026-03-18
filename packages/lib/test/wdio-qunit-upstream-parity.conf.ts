import { config as baseConfig } from "./wdio-qunit.conf";

export const config: WebdriverIO.Config = {
	...baseConfig,
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
