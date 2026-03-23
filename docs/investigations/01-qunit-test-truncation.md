# Investigation: QUnit tests silently stop registering after ~4363 lines

**Date:** 2026-03-21
**Affected file:** `packages/lib/test/qunit/Router.qunit.ts` (4943 lines, ~174KB)
**Symptom:** Only 243 of 258 Router QUnit tests run. Tests after "async redirect failure drains settlement resolvers" (TS line 4342) are never registered with QUnit. No errors reported.

## How we found it

The WDIO QUnit test runner consistently reported 265 passing tests (243 Router + 22 other suites). Adding new tests to the end of the file did not increase the count. Grepping the WDIO output confirmed the manifest guard test modules never appeared.

## Root cause

The `ui5-tooling-transpile` middleware (v3.11.0) transpiles the TypeScript file via Babel and serves the result with an inline base64 source map. The total response is ~972KB:

- Transpiled JS code: ~359KB
- Inline source map (base64-encoded `sourcesContent`): ~604KB

The server delivers the full response correctly. The truncation happens **client-side**: a runtime error inside the `sap.ui.define()` AMD callback silently prevents test registration for all code after the error point. The AMD loader catches the error, so QUnit never sees the remaining `QUnit.module()` / `QUnit.test()` calls.

## What we verified is NOT the cause

| Candidate                                   | Result                                                        |
| ------------------------------------------- | ------------------------------------------------------------- |
| `normalizeLineFeeds` in middleware          | Regex `\r\n\|\r\|\n` works correctly on base64                |
| Babel `compact: "auto"` 500KB limit         | Not triggered; 174KB input < 500,000 chars                    |
| `try/catch` swallowing partial Babel output | Babel returns complete Promise; rejection sends HTTP 500      |
| V8 string length limit                      | Max ~1GB; 972KB is trivial                                    |
| `@babel/generator` buffer flush bug         | Accumulation logic is correct                                 |
| `@babel/preset-typescript` parse failure    | Content after line 4363 transpiles without error in isolation |
| `@ui5/fs` caching                           | No relevant caching layer                                     |

## Key source locations

### ui5-tooling-transpile middleware

`node_modules/ui5-tooling-transpile/lib/middleware.js` lines 81-86:

```javascript
const result = await transformAsync(
	source,
	Object.assign({}, babelConfig, {
		filename: determineResourceFSPath(resource),
	}),
);
```

No size limit. `transformAsync` wraps `@babel/core.transformAsync`.

### Babel compact mode threshold

`node_modules/@babel/generator/lib/printer.js`:

```javascript
format.compact = "auto"; // triggers when input.length > 500_000
```

Our 173,452-char input does not trigger this.

### WDIO QUnit collection

`node_modules/wdio-qunit-service/dist/index.js` lines 43-47:

```javascript
await browserInstance.waitUntil(() => {
	return browserInstance.execute(
		() => window?._wdioQunitService?.results?.filter?.((result) => !result.completed).length === 0,
	);
});
```

Waits for `QUnit.done()` with `waitforTimeout: 90000` (from `wdio-qunit.conf.ts:19`).

### QUnit done signal

`node_modules/wdio-qunit-service/dist/qunit-browser.js`:

```javascript
QUnit.done(function () {
	buildModules();
	setSuiteReport();
	// sets suiteReport.completed = true → waitUntil resolves
});
```

QUnit fires `done()` after all **registered** tests complete. Tests that were never registered (due to the AMD error) are not counted.

### sap.ui.require error swallowing

`sap.ui.define()` / `sap.ui.require()` wraps module factory callbacks in try/catch internally. A synchronous throw during module evaluation (e.g., from `sap.ui.loader.config()` or an import resolution failure) is caught by the loader and logged as a module loading error — but does not propagate to QUnit's error handler.

## Fix

Split `Router.qunit.ts` into multiple files so each stays well under the size threshold. The logical split: move all PR #49 feature tests (router options, manifest guards, navToPreflight, skipGuards) into a separate test file registered independently in `testsuite.qunit.ts`.

## Lessons learned

1. **Large QUnit test files + AMD loading = silent truncation.** Errors during module evaluation prevent all subsequent test registrations without any visible failure.
2. **The WDIO QUnit reporter only sees tests that QUnit registers.** If registration fails partway through, the count is lower but all reported tests pass — making it look like everything is fine.
3. **Inline source maps amplify the problem.** A 174KB TypeScript file becomes a 972KB response due to base64-encoded `sourcesContent`. Consider `omitSourceMaps: true` for large test files or switching to external source maps.
4. **Always verify new tests appear in the runner output.** A test that isn't in the output isn't running, regardless of what the count says.
