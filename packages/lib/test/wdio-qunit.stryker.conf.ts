/// <reference types="wdio-qunit-service" />
import { chromeProfileHooks } from "../../../tools/wdio-chrome-profile";
import { config as baseConfig } from "./wdio-qunit.conf";

interface StrykerNamespace {
	activeMutant?: string;
	hitCount?: number;
	hitLimit?: number;
}

declare global {
	var __stryker__: StrykerNamespace | undefined;
}

// Browsers can't read process.env, so hand Stryker's active mutant to the page before UI5 loads.
const activeMutant = process.env.__STRYKER_ACTIVE_MUTANT__;

// Stryker's infinite-loop guard: instrumented code throws once the active mutant runs this often
// on one page. Without it a looping mutant grows the browser's memory until the run timeout.
// A real loop reaches it in milliseconds; a lower limit also stops code that only runs often.
const HIT_LIMIT = 1_000_000;

// A mutant that allocates without end crashes its page at this heap size instead of at V8's
// default of about 4 GB; the wdio run then fails and the mutant counts as killed.
const PAGE_HEAP_LIMIT_MB = 1024;

export const config: WebdriverIO.Config = {
	...baseConfig,
	// A mutation run starts hundreds of browsers. Their profile folders go into the folder of the
	// mutation run, which also removes the profiles of runs that Stryker kills on timeout.
	...chromeProfileHooks(process.env.MUTATION_CHROME_PROFILES, [
		`--js-flags=--max-old-space-size=${PAGE_HEAP_LIMIT_MB}`,
	]),
	before: async () => {
		if (activeMutant === undefined) return;
		await browser.addInitScript(
			(id: string, hitLimit: number) => {
				globalThis.__stryker__ = {
					activeMutant: id,
					hitCount: 0,
					hitLimit,
				};
			},
			activeMutant,
			HIT_LIMIT,
		);
	},
	mochaOpts: {
		...baseConfig.mochaOpts,
		rootHooks: {
			// A failing root hook ends the run, so a mutant is killed by the first page that fails
			// instead of after all pages. The hit limit's error can be caught by library code, so
			// it fails the run here as well.
			async afterEach() {
				if (activeMutant === undefined) return;
				const { hitLimitReached, failedTests } = await browser.execute(() => {
					const ns = globalThis.__stryker__;
					const report = window._wdioQunitService?.suiteReport;
					return {
						hitLimitReached: (ns?.hitCount ?? 0) > (ns?.hitLimit ?? Infinity),
						failedTests:
							report?.completed && !report.success
								? [...report.tests, ...report.childSuites.flatMap((suite) => suite.tests)]
										.filter((test) => !test.success)
										.map((test) => `${test.suiteName}: ${test.name}`)
								: [],
					};
				});
				if (hitLimitReached)
					throw new Error(`Stryker hit limit (${HIT_LIMIT}) reached: mutant loops without end`);
				if (failedTests.length > 0) throw new Error(`QUnit failed: ${failedTests.join("; ")}`);
			},
		},
	},
};
