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
	// Each worker runs its own wdio + headless Chrome; a core-based share starts too many on large machines.
	concurrency: 2,
};
