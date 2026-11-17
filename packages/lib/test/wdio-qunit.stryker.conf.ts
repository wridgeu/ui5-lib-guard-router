import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// A mutant that allocates without end crashes its page at this heap size instead of at V8's
// default of about 4 GB; the wdio run then fails and the mutant counts as killed.
const PAGE_HEAP_LIMIT_MB = 1024;

let profileDir: string | undefined;

export const config: WebdriverIO.Config = {
	...baseConfig,
	// On Windows wdio gives Chrome a profile folder in %TEMP% that it never deletes (about 30 MB per
	// run) and names by the millisecond, so two workers can share one. A mutation run starts
	// hundreds of browsers, so each gets its own folder here and onComplete removes it.
	onPrepare: (_config, capabilities) => {
		profileDir = mkdtempSync(join(process.env.MUTATION_CHROME_PROFILES ?? tmpdir(), "chrome-"));
		for (const capability of capabilities as WebdriverIO.Capabilities[]) {
			capability["goog:chromeOptions"]?.args?.push(
				`--user-data-dir=${profileDir}`,
				`--js-flags=--max-old-space-size=${PAGE_HEAP_LIMIT_MB}`,
			);
		}
	},
	onComplete: () => {
		if (profileDir) rmSync(profileDir, { recursive: true, force: true, maxRetries: 5 });
	},
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
