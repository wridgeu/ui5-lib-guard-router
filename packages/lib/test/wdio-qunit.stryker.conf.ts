import { config as baseConfig } from "./wdio-qunit.conf";

// Browsers can't read process.env, so hand Stryker's active mutant to the page before UI5 loads.
const activeMutant = process.env.__STRYKER_ACTIVE_MUTANT__;

// Stryker's infinite-loop guard: instrumented code throws once the active mutant runs this often
// on one page. Without it a looping mutant grows the browser's memory until the run timeout.
const HIT_LIMIT = 10_000;

interface StrykerNamespace {
	activeMutant?: string;
	hitCount?: number;
	hitLimit?: number;
}

export const config: WebdriverIO.Config = {
	...baseConfig,
	before: async () => {
		if (activeMutant === undefined) return;
		await browser.addInitScript(
			(id: string, hitLimit: number) => {
				(globalThis as { __stryker__?: StrykerNamespace }).__stryker__ = {
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
			// The guard's error can be caught by library code, so fail the run here as well.
			async afterEach() {
				if (activeMutant === undefined) return;
				const hitLimitReached = await browser.execute(() => {
					const ns = (globalThis as { __stryker__?: StrykerNamespace }).__stryker__;
					return (ns?.hitCount ?? 0) > (ns?.hitLimit ?? Infinity);
				});
				if (hitLimitReached)
					throw new Error(`Stryker hit limit (${HIT_LIMIT}) reached: mutant loops without end`);
			},
		},
	},
};
