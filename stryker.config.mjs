// @ts-check
// Run via `npm run test:mutation`: per source file, one UI5 server (port 8084) serves the
// in-place instrumented sources to a wdio QUnit run per mutant.
/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
	mutate: ["packages/lib/src/**/*.ts", "!packages/lib/src/types.ts", "!packages/lib/src/library.ts"],
	testRunner: "command",
	commandRunner: { command: "wdio run packages/lib/test/wdio-qunit.stryker.conf.ts" },
	coverageAnalysis: "off",
	inPlace: true,
	// Babel transpiles without type checks, so no @ts-nocheck headers (which inPlace would write repo-wide).
	disableTypeChecks: false,
	checkers: ["typescript"],
	tsconfigFile: "packages/lib/tsconfig.json",
	reporters: ["clear-text", "progress", "html", "json"],
	// Each worker runs its own wdio + headless Chrome (about 0.9 GB, peaks near 1.7 GB); a core-based
	// share starts too many on large machines.
	concurrency: 3,
	// A suite run varies by up to 15 s between runs, and a hung QUnit test fails after its own 10 s
	// testTimeout. The allowance must cover both, so a run is only marked Timeout when it truly
	// never finishes, not when the machine was slow or a few tests timed out and failed.
	timeoutMS: 60000,
};
