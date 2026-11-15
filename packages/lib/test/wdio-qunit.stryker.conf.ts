import { config as baseConfig } from "./wdio-qunit.conf";

// Browsers can't read process.env, so hand Stryker's active mutant to the page before UI5 loads.
const activeMutant = process.env.__STRYKER_ACTIVE_MUTANT__;

export const config: WebdriverIO.Config = {
	...baseConfig,
	before: async () => {
		if (activeMutant === undefined) return;
		await browser.addInitScript((id: string) => {
			(globalThis as { __stryker__?: { activeMutant?: string } }).__stryker__ = { activeMutant: id };
		}, activeMutant);
	},
};
