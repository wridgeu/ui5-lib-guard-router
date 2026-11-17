# Upstream Parity

## Purpose

This repository keeps two complementary compatibility layers for the core router:

- `packages/lib/test/qunit/NativeRouterCompat.qunit.ts` - fast local differential tests authored in this repo
- `packages/lib/test/qunit/upstream-parity/` - a vendored OpenUI5 parity lane with pinned upstream source snapshots and local executable ports

The vendored lane exists to answer a specific question:

> When no guards are registered, does `ui5.guard.router.Router` still behave like the native `sap.m.routing.Router` for inherited routing behavior?

It is a conformance-style test layer, not a replacement for the library's own feature tests.

## Contract

The upstream parity lane verifies only the native inherited contract:

- public router API surface
- route matching and URL generation
- `navTo()` and replace behavior
- public routing events and parameters
- lifecycle behavior such as initialize/stop/reinitialize where publicly observable

It does not verify the library's extended behavior:

- guard APIs
- navigation settlements
- leave guards
- block/redirect semantics with active guards
- FLP integration or dirty-state handling

Those remain covered by the local QUnit, E2E, and FLP suites.

## Layout

```text
packages/lib/test/qunit/upstream-parity/
  README.md
  Current.qunit.ts
  vendor-manifest.json
  adapters/
  ports/
  vendor/
```

- `vendor/openui5/<tag>/raw/` keeps exact upstream snapshots
- `ports/openui5/<tag>/` contains local executable ports/wrappers
- `Current.qunit.ts` imports the ports for the active tag
- `adapters/` contains shared local harness helpers
- `vendor-manifest.json` records provenance and raw-to-port mapping
- `vendor-manifest.json` also pins raw snapshot checksums so CI can detect local drift in vendored files
- the custom verifier validates manifest structure as well as repo-state consistency

## Vendoring Rules

- Raw vendored files stay byte-for-byte identical to upstream.
- Local changes belong in `ports/` and `adapters/`, not in `vendor/`.
- Every executable port references its upstream source path, tag, and commit SHA.
- CI never fetches upstream tests dynamically; vendoring happens through maintainer scripts only.

## Scripts

- `npm run test:qunit` - run all QUnit suites including the vendored parity lane
- `npm run vendor:openui5-router-tests -- --tag <version> --write-manifest` - fetch pinned upstream router test files into the raw vendor tree and refresh manifest provenance
- `npm run verify:openui5-router-vendor` - validate the manifest structure and verify raw/port mapping

## Maintenance

Update the vendored lane when one of these happens:

- the shipped UI5 baseline changes
- a router compatibility regression is found
- a major router refactor changes inherited routing behavior

Recommended process:

1. fetch a new raw snapshot with the vendoring script
2. review the upstream diff
3. update or add local executable ports only where valuable
4. for a version bump, migrate the versioned port paths before writing the new manifest version
5. run `npm run verify:openui5-router-vendor` and `npm run test:qunit` (the parity suite is part of the QUnit lane)

## Private UI5 Coupling

The vendored lane covers public behavior. The router also depends on two things in UI5 that no
public contract protects. Both concern a component displayed as a routing target. The reasons
and the mechanisms are described in
[UI5 Internals the Router Relies On](./architecture.md#ui5-internals-the-router-relies-on).

| Coupling                                                                                                                                                                                                     | Use                                                                                                                                                                                                                                                                   | Verified against                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Private member `sap.ui.core.routing.Router#_bMatchingProcessStarted`                                                                                                                                         | Replaced by an accessor in `Router._mirrorMatchingProcess()`: reads `true` during a native route match and while a navigation waits for async guards                                                                                                                  | OpenUI5 1.144.0, OpenUI5 1.120.0         |
| `Target#waitForComponentTarget` waits for a nested router with `oRouter.attachRouteMatched(resolve)`, the bare resolve function of a Promise, while the router is not initialized or the member reads `true` | `Router.attachRouteMatched()` remembers a listener with the exact shape of a Promise resolve function (`isPromiseResolver()` in `GuardPipeline.ts`) under that condition, and `Router._settleMatchWaiters()` resolves it when a navigation ends without a route match | OpenUI5 1.144.0, OpenUI5 1.120.0, Chrome |

Pinning tests, on both UI5 lanes (`npm run test:qunit` and `npm run test:qunit:compat:120`):

- `packages/lib/test/qunit/RouterAsync.qunit.ts`, module "Router - Native matching flag"
- `packages/lib/test/qunit/GuardPipeline.qunit.ts`, module "GuardPipeline - Promise resolve functions"
- `packages/lib/test/qunit/RouterManifestGuards.qunit.ts`, module "Router - Manifest-driven instantiation",
  the tests on a component loaded as a routing target and on parent routes of a nested component

What fails when UI5 or the browser changes:

| Change                                                                                                                                             | Failing test                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The member is renamed or no longer written                                                                                                         | "UI5 sets the flag for the time of a route match"                                                                                                                                                                                                                                                                                                                                                      |
| `Target#waitForComponentTarget` no longer waits while the member reads `true`                                                                      | "a parent route waits for the route that a nested component's first navigation is redirected to", "a parent route matches although an async guard blocks a nested component's first navigation" (the parent route matches before the child's guard has decided)                                                                                                                                        |
| The component target no longer subscribes the bare resolve function of a Promise with `attachRouteMatched()`, for example a function that wraps it | "a parent route matches although an async guard blocks a nested component's first navigation", "a parent route matches although a guard blocks a nested component that is displayed again" (both time out)                                                                                                                                                                                             |
| The engine prints or shapes a Promise resolve function differently                                                                                 | "the resolve function of a Promise is recognized by its exact shape". The assertion on the text `function () { [native code] }` documents Chrome and fails alone if only the text changes: the router reads the text from a real Promise at load time and keeps working. If the name or the length changes, the function is no longer recognized and the nested component tests above time out as well |

Procedure:

1. Open the routing sources of the new UI5 version: `sap/ui/core/routing/Route.js` (`_routeMatched`),
   `Target.js` (`waitForComponentTarget`, `suspend`) and `Router.js` (the `display` handler in the
   constructor, `fireTitleChanged`). In 1.120.0 the async variants are in `sap/ui/core/routing/async/`.
2. Verify where the member is written: `true` synchronously inside `parse()` when a route matches,
   `false` when its targets are displayed, before `routeMatched`.
3. Verify every reader of the member.
4. Verify how the component target waits for the nested router: under which condition it waits,
   what it subscribes to `routeMatched` and through which method, whether anything else can
   release the wait, and when it starts a stopped router.
5. Adapt `_mirrorMatchingProcess()`, `attachRouteMatched()` and `_settleMatchWaiters()` in
   `packages/lib/src/Router.ts`, and `isPromiseResolver()` in `packages/lib/src/GuardPipeline.ts`,
   to what UI5 does now. If UI5 offers a way to release the wait, use it and remove the
   recognition by shape.
6. Update the versions and line references in the JSDoc of these four functions, in the
   architecture section and in the tables above.
7. Run both QUnit lanes.

## Current Scope

The initial implementation vendors the `Router.qunit.js` entrypoint from the OpenUI5 async `sap.m.routing.Router` QUnit suite and ports a small first batch of parity cases through the local harness.

This is intentionally incremental: start with high-value router cases, keep provenance explicit, and expand only when the maintenance cost is justified.
