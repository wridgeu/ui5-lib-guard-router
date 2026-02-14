# ui5.guard.router (Library)

The core library providing `ui5.guard.router.Router` -- an extension of `sap.m.routing.Router` with async navigation guards.

## Structure

```
src/
  Router.ts       Router implementation (overrides parse())
  types.ts        TypeScript types (GuardFn, LeaveGuardFn, GuardContext, GuardResult, GuardRedirect, RouteGuardConfig, GuardRouter)
  library.ts      UI5 library registration
  manifest.json   Library manifest
  .library        XML library descriptor
  themes/         Theme placeholder (noLibraryCSS)
test/
  qunit/          QUnit unit tests (Router.qunit.ts, NativeRouterCompat.qunit.ts)
  wdio-qunit.conf.ts   wdio config for running QUnit tests via wdio-qunit-service
```

## Scripts

```bash
# Serve the library (for running QUnit tests in browser)
npm start
# => http://localhost:8080/test-resources/ui5/guard/router/qunit/testsuite.qunit.html

# Build
npm run build

# Type check
npm run typecheck
```

## Running QUnit tests

From the monorepo root:

```bash
npm run test:qunit
```

This uses `wdio-qunit-service` to launch the QUnit test suite in a headless Chrome browser and report results.

To run tests interactively in a browser, start the library server (`npm start` in this directory) and open the testsuite URL above.

## Framework

- OpenUI5 1.144.0
- TypeScript via `ui5-tooling-transpile`
- UI5 Tooling specVersion 4.0
