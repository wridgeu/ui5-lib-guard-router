# Upstream Parity

## Purpose

This repository keeps four complementary compatibility layers for the core router:

- `packages/lib/test/qunit/NativeRouterCompat.qunit.ts` - fast local differential tests authored in this repo
- `packages/lib/test/qunit/NestedRouterParity.qunit.ts` - local differential tests for a component displayed as a routing target (see [Nested component targets](#nested-component-targets))
- `packages/lib/test/qunit/GuardedNavigationParity.qunit.ts` - local differential tests that compare what guards decide with the native navigation the decision stands for (see [Guard decisions and their native equivalents](#guard-decisions-and-their-native-equivalents))
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

## Nested component targets

`NestedRouterParity.qunit.ts` runs one fixture app (`packages/lib/test/qunit/fixtures/parity/`)
once per flavor and compares what each run did. The parent's `shell` route displays a child
component through `componentUsages` and a target of type `Component` with the prefix `child`.
Parent and child each have a `bypassed` target, as the demo app has.

| Flavor   | Parent router                                      | Child component | Child router                                                      |
| -------- | -------------------------------------------------- | --------------- | ----------------------------------------------------------------- |
| `native` | `sap.m.routing.Router`                             | `childNative`   | `sap.m.routing.Router`                                            |
| `guard`  | `ui5.guard.router.Router`, no guards               | `childNoGuards` | `ui5.guard.router.Router`, no guards                              |
| `allow`  | `ui5.guard.router.Router`, guard `"*"` that allows | `childAllow`    | `ui5.guard.router.Router`, manifest guard `"*"` that allows, lazy |

The test replaces the router class, the child and the guards in the parent's manifest and passes
the manifest to `Component.create()`. The three child components differ only in their manifest.

### What is compared

Every run records one trace, in the order things happen (`parityRecorder.ts`):

- the browser hash: `hashChanged`, and `hashSet` (adds a history entry) or `hashReplaced` (adds
  none) of the `HashChanger`. These two stand for the history length, which the browser caps
  and which therefore differs between two runs for reasons unrelated to the router
- `beforeRouteMatched`, `routeMatched`, `routePatternMatched`, `bypassed` and `titleChanged` of
  the parent router and the child router, with all parameters (controls as their ID)
- every target the two `Targets` instances display
- every warning and error logged through `sap/base/Log`, except two that a `NavContainer`
  logs depending on how fast views load ("page stack is empty", "Cannot navigate to page ...
  because this is the current page"). A router's own class name in a line is replaced by the
  native one
- after each step: the browser hash, the pages of both `NavContainer`s (pages, current page,
  previous page), whether each router is initialized or stopped, and each title history

The traces of `guard` and `allow` must equal the trace of `native`. A second `native` run is the
control: if it differs from the first, the scenario depends on what ran before it, and the
comparison with the guard router proves nothing.

Scenarios: first display of the child, `navTo` in the child with and without a history entry,
the address bar into the child and inside of it, a start on a hash the child does not know, a
start on a hash the parent does not know, a start on a deep link to a child route, leaving the
parent route and displaying the child again, browser back and forward, the parent's `navTo` with
`componentTargetInfo`, `navTo` to the route already shown, and a target displayed without a
route. Titles propagate from the child to the parent (`propagateTitle`) in every scenario.

The scenarios that change the URL as the browser does (address bar, back and forward) come
first in the file, because Chrome ignores hash changes once a page has made about 200 of them
within ten seconds. The start on a hash the child does not know is compared without regard to
order (`anyOrder`): the parent does not wait for the child's `bypassed` target, so the native
router itself displays the two in either order. The `NavContainer` warning "Cannot navigate to
page ... because this is the current page" has a test of its own, which pins only the warning
for the child's first page; the one for the parent's first page depends on timing.

### What differs on purpose

These behaviors exist only with guards that block, redirect or decide asynchronously. They are
not compared with the native router. The tests that pin them are in
`packages/lib/test/qunit/RouterManifestGuards.qunit.ts`, module "Router - Manifest-driven
instantiation".

| Behavior of the guard router                                                                                                                                                                    | Native router                                                        | Reason                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A blocked navigation of the child fires no routing event. A blocked `navTo` never writes the hash, a blocked browser hash change is undone as a whole (see below)                               | Every hash that matches a route is displayed                         | Blocking is the purpose of a guard                                                                                                                 |
| A redirected navigation of the child fires the routing events of the redirect target only and writes that target under the child's prefix. A redirect to the route that is shown writes no hash | No redirects                                                         | Redirecting is the purpose of a guard                                                                                                              |
| While the child's first navigation waits for an async guard (in lazy mode: for the guard module), the parent's route does not match. `_bMatchingProcessStarted` reads `true` for that time      | The member is `true` only between the route match and `routeMatched` | Without it the parent would count the child as displayed before the child's first route matched, see [Private UI5 Coupling](#private-ui5-coupling) |
| The parent's route matches although the child's navigation was blocked: the router resolves the wait of the component target                                                                    | The child always fires `routeMatched`, which resolves the wait       | A blocked navigation fires no `routeMatched`, so the parent's route would never match                                                              |
| While a navigation waits for async guards, a `titleChanged` event is deferred to the next `routeMatched` and `resetHash` is skipped                                                             | The same, for the time of a route match                              | The two other readers of `_bMatchingProcessStarted` see the value the component target sees                                                        |
| The routers fire `navigationSettled`                                                                                                                                                            | No such event                                                        | Additional API. The trace does not record it                                                                                                       |

A guard that allows changes when the events fire (after the guard has decided), never which
events fire or in which order. The `allow` flavor asserts that.

A browser hash change that the parent blocks, or redirects to the route it shows, is undone
with the whole previous hash, the child's part included (tests "a hash change that the parent
blocks ... is undone with the hash of the nested component" in `RouterManifestGuards.qunit.ts`).
The child ends on its previous route. UI5 reports every hash change to the child router
whatever the parent decides, so the child first receives its part of the refused hash and
matches a route for it, then its previous hash. A native app has no such round trip, because
nothing is refused.

When a UI5 upgrade breaks a scenario, read the first differing trace line. A difference between
the two `native` runs is a change in the test setup, not in the router.

### Native behaviors the comparison pins

Each row is a native behavior that the router has to reproduce explicitly. The named tests fail
without it.

| Native behavior                                                                                                                                                                       | How the router reproduces it                                                                                           | Test                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| The router config holds `targetParent`, the ID of the component's root view, which `UIComponent` adds to the config object after it has constructed the router                        | UI5 gets a view of the caller's config object that hides `guardRouter` (`withoutGuardRouter()`), not a copy            | every scenario of `NestedRouterParity.qunit.ts`                                                |
| `navTo()` to the route that is shown sets the hashes of nested components (`componentTargetInfo`), or resets them: `navTo("shell")` on `shell&/child/detail/1` leads to `shell`       | `navTo()` to the committed hash calls `super.navTo()` without running guards                                           | "navTo to the route that is already shown", "the parent navigates to a route of the child ..." |
| After `Targets#display()` without a route, `navTo()` to the route shown before displays that route again: UI5 resets the hash of the router's hash changer and reports the hash again | `parse()` lets the route match again when it receives the committed hash                                               | "a target displayed without a route"                                                           |
| With `componentTargetInfo`, the parent's route matches only once UI5 has loaded the nested components and written the combined hash                                                   | The navigation commits and settles at once; the route matches when `parse()` receives the hash (`_commitAfterNavTo()`) | "the parent navigates to a route of the child with componentTargetInfo"                        |

### Guard decisions and their native equivalents

`GuardedNavigationParity.qunit.ts` runs the same fixture app with the `native` and the `guard`
flavor. A guarded scenario and a native scenario that stands for its outcome must leave the
same trace from a given step on, browser history steps, titles and the pages of both
`NavContainer`s included. A second `native` run is the control. The suite has a page of its
own, because Chrome ignores history steps once a page has changed the hash about 200 times
within ten seconds.

| Guarded navigation                                    | Native equivalent                                     |
| ----------------------------------------------------- | ----------------------------------------------------- |
| A `navTo()` in the child that a guard redirects       | A `navTo()` to the redirect target                    |
| A browser back in the child that a leave guard blocks | No step: later steps go back and forward as before    |
| A history step that the parent and the child block    | No step                                               |
| A history step that only the parent blocks            | No step, after the child's round trip described above |

`NativeRouterCompat.qunit.ts` compares a router without nested components the same way: a
redirected `navTo()` with a native `navTo()` to the target, a `navTo()` redirected to the
route that is shown with no navigation at all, and greedy routes, which match and fire their
events as with the native router. A `parse()` of the current hash matches the route again, as
it does natively; only a redirect to the route that is shown skips the match.

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

### UI5 source locations

Where UI5 writes and reads `_bMatchingProcessStarted` and where the component target waits,
verified against the sources of each version. OpenUI5 1.120.0 keeps the async variants in
`sap/ui/core/routing/async/` and `sap/m/routing/async/`.

| Location                                                       | OpenUI5 1.144.0                                   | OpenUI5 1.120.0                                     |
| -------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------- |
| `Route#_routeMatched` sets the member to `true`                | `sap/ui/core/routing/Route.js` line 745           | `sap/ui/core/routing/async/Route.js` line 49        |
| `Route#_routeMatched` sets the member to `false`               | `sap/ui/core/routing/Route.js` line 831           | `sap/ui/core/routing/async/Route.js` line 135       |
| Sync routers (`async: false`) set and clear it                 | `sap/ui/core/routing/sync/Route.js` lines 44, 128 | `sap/ui/core/routing/sync/Route.js` lines 44, 128   |
| `Target#waitForComponentTarget` creates the Promise            | `sap/ui/core/routing/Target.js` line 786          | `sap/ui/core/routing/async/Target.js` line 245      |
| Condition for waiting (reads the member)                       | `sap/ui/core/routing/Target.js` line 819          | `sap/ui/core/routing/async/Target.js` line 275      |
| `oRouter.attachRouteMatched(resolve)`                          | `sap/ui/core/routing/Target.js` line 821          | `sap/ui/core/routing/async/Target.js` line 277      |
| A stopped nested router is initialized                         | `sap/ui/core/routing/Target.js` lines 823-826     | `sap/ui/core/routing/async/Target.js` lines 279-282 |
| `Target#suspend` stops the nested router                       | `sap/ui/core/routing/Target.js` line 619          | `sap/ui/core/routing/async/Target.js` line 81       |
| `display` handler of the `Router` constructor reads the member | `sap/ui/core/routing/Router.js` line 289          | `sap/ui/core/routing/Router.js` line 264            |
| `Router#fireTitleChanged` reads the member                     | `sap/ui/core/routing/Router.js` line 1527         | `sap/ui/core/routing/Router.js` line 1495           |
| `TargetHandler#_chainNavigation` is called                     | `sap/m/routing/Target.js` line 61                 | `sap/m/routing/async/Target.js` line 25             |

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
6. Update the versions and line references in the evidence table below and the versions in the
   architecture section.
7. Run both QUnit lanes.

### Fiori launchpad (sap.ushell)

Where the launchpad stops and restarts app routers and holds back hash changes, as described in
[FLP Integration](./architecture.md#flp-integration). Paths are relative to `sap/ushell/` in the
SAPUI5 sources; the `sap/ui/core` rows are from OpenUI5.

| Location                                                                              | SAPUI5 1.144.0                                                  | SAPUI5 1.149.0                                                  |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| `ShellNavigationInternal` replaces the global hash changer                            | `services/ShellNavigationInternal.js` line 373                  | `services/ShellNavigationInternal.js` line 373                  |
| `HashChanger#createRouterHashChanger` creates and caches one `RouterHashChanger`      | `sap/ui/core/routing/HashChanger.js` lines 90-108 (OpenUI5)     | same file and lines in OpenUI5 1.149.0                          |
| `treatHashChanged` runs the navigation filters; `Custom` ends the flow without events | `services/ShellNavigationHashChanger.js` lines 805, 815-825     | `services/ShellNavigationHashChanger.js` lines 809, 819-829     |
| In-app change fires `hashChanged`                                                     | `services/ShellNavigationHashChanger.js` line 891               | `services/ShellNavigationHashChanger.js` line 895               |
| Cross-app change fires `shellHashChanged` (`updateHashOnly: true`)                    | `services/ShellNavigationHashChanger.js` lines 70, 928          | `services/ShellNavigationHashChanger.js` lines 72, 932          |
| Filter order: `_disableSourceAppRouter` before `_handleDataLoss`                      | `renderer/Shell.controller.js` lines 419, 421                   | `renderer/Shell.controller.js` lines 434, 436                   |
| `_disableSourceAppRouter` calls `stop()` on a cross-app change                        | `renderer/Shell.controller.js` line 895                         | `renderer/Shell.controller.js` line 926                         |
| `_resumeAppRouterIgnoringCurrentHash` calls `initialize(true)`                        | `renderer/Shell.controller.js` line 911                         | `renderer/Shell.controller.js` line 942                         |
| `_handleDataLoss` reads the dirty state, for in-app changes too                       | `renderer/Shell.controller.js` line 987                         | `renderer/Shell.controller.js` line 1015                        |
| `_handleDataLoss` swallows the change that puts the hash back                         | `renderer/Shell.controller.js` line 953                         | `renderer/Shell.controller.js` line 984                         |
| `_handleDataLoss` puts the hash back and returns `Custom`                             | `renderer/Shell.controller.js` line 1057                        | `renderer/Shell.controller.js` line 1074                        |
| `_restoreHashUsingAction` restarts the router                                         | `renderer/Shell.controller.js` line 1124                        | `renderer/Shell.controller.js` line 1141                        |
| `window.confirm()` of the data-loss prompt                                            | `renderer/Shell.controller.js` line 1097                        | `renderer/Shell.controller.js` line 1114                        |
| Restart after opening the app in a new window, after a failed navigation              | `renderer/Shell.controller.js` lines 1934, 2031                 | `renderer/Shell.controller.js` lines 1855, 1938                 |
| Keep-alive: routers of cached apps stopped before a new app is created                | `appIntegration/contracts/EmbeddedUI5Handler.js` line 33        | `appIntegration/contracts/EmbeddedUI5Handler.js` line 58        |
| Keep-alive: hide calls `stop()`, unless `isKeepAliveSupported()`                      | `appIntegration/contracts/EmbeddedUI5Handler.js` lines 88, 100  | `appIntegration/contracts/EmbeddedUI5Handler.js` lines 138, 150 |
| Keep-alive: show calls `initialize(true)`, unless `isKeepAliveSupported()`            | `appIntegration/contracts/EmbeddedUI5Handler.js` lines 112, 128 | `appIntegration/contracts/EmbeddedUI5Handler.js` lines 170, 186 |

## Current Scope

The initial implementation vendors the `Router.qunit.js` entrypoint from the OpenUI5 async `sap.m.routing.Router` QUnit suite and ports a small first batch of parity cases through the local harness.

This is intentionally incremental: start with high-value router cases, keep provenance explicit, and expand only when the maintenance cost is justified.
