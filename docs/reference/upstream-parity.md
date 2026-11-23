# Upstream Parity

## Purpose

Compatibility layers for the core router:

- `packages/lib/test/qunit/parity/native/` (`NativeCompat.qunit.ts`, `NativeCompatTraces.qunit.ts`) - fast local differential tests authored in this repo
- `packages/lib/test/qunit/parity/nested/NestedRouterParity.qunit.ts` - local differential tests for a component displayed as a routing target (see [Nested component targets](#nested-component-targets))
- `packages/lib/test/qunit/parity/guarded/GuardedNavigationParity.qunit.ts` - local differential tests that compare what guards decide with the native navigation the decision stands for (see [Guard decisions and their native equivalents](#guard-decisions-and-their-native-equivalents))
- `packages/lib/test/qunit/parity/entries/GuardedEntryParity.qunit.ts` - more tests of that kind, on a page of their own
- `packages/lib/test/qunit/parity/steps/RedirectedStepParity.qunit.ts` - redirected steps through the browser history, on a page of their own
- `packages/demo-app/test/flp/flp-native-parity.e2e.ts` - one app with the native and with the guard router in the Fiori launchpad sandbox (see [Fiori launchpad](#fiori-launchpad))
- `packages/lib/test/qunit/upstream-parity/` - a vendored OpenUI5 parity lane with pinned upstream source snapshots and local executable ports

The vendored lane exists to answer a specific question:

> When no guards are registered, does `ui5.guard.router.Router` still behave like the native `sap.m.routing.Router` for inherited routing behavior?

The library README sums up the result per behavior,
[Compatibility with sap.m.routing.Router](../../packages/lib/README.md#compatibility-with-sapmroutingrouter),
and [Native router compatibility](../guides/native-router-compatibility.md) cites the test for each row.
This page describes how the comparison works. The QUnit layers run on both QUnit lanes, OpenUI5
1.144.0 (`npm run test:qunit`) and 1.120.0 (`npm run test:qunit:compat:120`).

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

## Vendored lane

The vendored lane runs the `Router.qunit.js` entry point of OpenUI5's async `sap.m.routing.Router` QUnit suite, pinned to one upstream tag, and ports two of its cases through a local harness: forward navigation on a `NavContainer` and back navigation by view level. Further cases are ported when they are worth the maintenance. Its layout, the vendoring rules, the scripts and the version bump procedure are in the [folder README](../../packages/lib/test/qunit/upstream-parity/README.md). Update the lane when the development UI5 version changes, when a router compatibility regression is found, or when a refactor changes inherited routing behavior.

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

These behaviors exist only with guards that block, redirect or decide asynchronously. A native
router has none of them, so the comparison is with the native navigation that a decision stands
for (see [Guard decisions and their native equivalents](#guard-decisions-and-their-native-equivalents)).
The tests that pin the behaviors themselves are in
`packages/lib/test/qunit/router/manifest/Instantiation.qunit.ts`, module "Router - Manifest-driven
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
blocks ... is undone with the hash of the nested component" in `Instantiation.qunit.ts`).
The child ends on its previous route. UI5 reports every hash change to the child router
whatever the parent decides, so the child first receives its part of the refused hash and
matches a route for it, then its previous hash. A native app has no such round trip, because
nothing is refused.

When a UI5 upgrade breaks a scenario, read the first differing trace line. A difference between
the two `native` runs is a change in the test setup, not in the router.

### Native behaviors the comparison pins

Each row is a native behavior that the router has to reproduce explicitly. The named tests fail
without it.

| Native behavior                                                                                                                                                                       | How the router reproduces it                                                                                            | Test                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| The router config holds `targetParent`, the ID of the component's root view, which `UIComponent` adds to the config object after it has constructed the router                        | UI5 gets a view of the caller's config object that hides `guardRouter` (`withoutGuardRouter()`), not a copy             | every scenario of `NestedRouterParity.qunit.ts`                                                |
| `navTo()` to the route that is shown sets the hashes of nested components (`componentTargetInfo`), or resets them: `navTo("shell")` on `shell&/child/detail/1` leads to `shell`       | `navTo()` to the committed hash calls `super.navTo()` without running guards                                            | "navTo to the route that is already shown", "the parent navigates to a route of the child ..." |
| After `Targets#display()` without a route, `navTo()` to the route shown before displays that route again: UI5 resets the hash of the router's hash changer and reports the hash again | `parse()` lets the route match again when it receives the committed hash                                                | "a target displayed without a route"                                                           |
| With `componentTargetInfo`, the parent's route matches only once UI5 has loaded the nested components and written the combined hash                                                   | The navigation commits and settles when `parse()` receives the hash, and the route matches then (`_commitAfterNavTo()`) | "the parent navigates to a route of the child with componentTargetInfo"                        |

### Guard decisions and their native equivalents

`GuardedNavigationParity.qunit.ts`, `GuardedEntryParity.qunit.ts` and `RedirectedStepParity.qunit.ts` run the same fixture app
with the `native` and the `guard` flavor. A guarded scenario and a native scenario that stands
for its outcome must leave the same trace from a given step on, browser history steps, titles
and the pages of both `NavContainer`s included. A second `native` run is the control.

These suites also record what the browser does with its history entries, as the
Navigation API reports it (`recordHistory()` in `parityRecorder.ts`): `history push` for a new
entry, `history replace` for the current entry replaced (UI5's `History` also replaces the state
of an entry after each hash change), `history traverse <n>` for a step of n entries.
`history.length` and the index of the current entry are not compared: the browser keeps 50
entries, and both stop growing there.

Each suite has a page of its own, and the tests are split over three pages, because Chrome
ignores history steps and hash changes once a page has changed its history entries about 200
times within ten seconds. UI5 does not notice an ignored hash change, the record of the browser
does. The pages of the first two suites make about 140 and 90 changes, the third has five tests.

| Guarded navigation                                                                                      | Native equivalent                                             |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| A `navTo()` in the child that a guard redirects                                                         | A `navTo()` to the redirect target                            |
| A browser back in the child that a leave guard blocks                                                   | No step: later steps go back and forward as before            |
| A history step that the parent and the child block                                                      | No step                                                       |
| A history step that only the parent blocks                                                              | No step, after the child's round trip described above         |
| A `navTo()` in the child that a guard blocks                                                            | No navigation                                                 |
| An address bar entry in the child that a guard redirects                                                | An address bar entry of the redirect target                   |
| A `navTo()` of the parent that a guard redirects to the route that is shown, with `componentTargetInfo` | A `navTo()` to that route with the same `componentTargetInfo` |
| `Targets#display()` while every guard of the parent and of the child blocks                             | `Targets#display()`                                           |
| A browser back or forward in the child that a guard redirects                                           | The same step, then a `navTo()` to the target with `bReplace` |

For a redirected step through the browser history (`RedirectedStepParity.qunit.ts`) the native
router displays the page of the step before the target replaces it, and the guard router does
not: its guards decide before any target is displayed, so the page that a guard turned away
is never shown. The comparison therefore starts with the first step after the redirect: steps back and
forward over the replaced entry and its neighbors, with the hash, the routing events, the
history entries, the pages and the title history after each. Two things stay different on
purpose and are not compared: right after the redirect, the `NavContainer` of the native run
has the page of the step as its previous page, and after a redirected step forward it keeps
that page on its page stack (`sap/m/routing/TargetHandler.js`, `_applyNavigationResult()`).

In the first two tests of the third suite the page that is left, the route of the step and the
target each have a title of their own; the third test pins a target whose title repeats the one
of the page it leaves. UI5 reports a title only when the title or its target differs from the one
reported last (`Targets#fireTitleChanged`), so with titles that repeat, the native title history
depends on a title that the guard router never gets: the one of the route it keeps from
matching. How the router aligns the title history is described in
[the title history after a redirected hash change](./architecture.md#_blasthashreplaced-and-gettitlehistory-the-title-history-after-a-redirected-hash-change).
`History.qunit.ts` pins that the step has its entry replaced with the target.

`NativeCompatTraces.qunit.ts` compares a router without nested components the same way: a
redirected `navTo()` with a native `navTo()` to the target, a `navTo()` redirected to the
route that is shown with no navigation at all, and greedy routes, which match and fire their
events as with the native router. A `parse()` of the current hash matches the route again, as
it does natively; only a redirect to the route that is shown skips the match. Two more
equivalents are compared there: leave guards run for the routes that the native router matched
for the hash before a navigation, and enter guards for the routes that it matches after it,
greedy routes included; and after `stop()` and `initialize(true)`, the leave guard runs for the
route that the native router fires `switched` for on the next navigation.

### Fiori launchpad

`flp-native-parity.e2e.ts` runs one app twice in the launchpad sandbox of the demo
(`packages/demo-app/test/flp/parity/native/` and `.../guard/`, which differ in the router class
of the manifest). Each run starts on a deep link, navigates in the app and back, cancels a
cross-app navigation at the launchpad's question about unsaved data, hides the app behind
another one (`sap-keep-alive=true`), shows it again and navigates. After each step the test
records the URL, the routing events of the router so far, and whether the router is initialized
and stopped. The guard router has no guards, except for one step: after the cancelled cross-app
navigation it blocks a hash change, where the native app does nothing. The records of the two
runs must be equal.

What a guard decides in the launchpad beyond that (leave guards and the launchpad's own
question, redirects, nested components) has no native counterpart in the sandbox and is pinned
by the other specs in `packages/demo-app/test/flp/`.

## Routers that share a hash changer

Module "NativeCompat - Two routers on one hash changer" of `NativeCompatTraces.qunit.ts`
creates two components with routing, neither a routing target of the other, so UI5 gives both
routers the hash changer of the root (described in
[Routers that share a hash changer](./architecture.md#routers-that-share-a-hash-changer)).

- "two guard routers without guards behave like two native routers": hash changes, `navTo()`
  of either router, `stop()` and `initialize(true)` of the first leave the trace of two native
  routers.
- "a hash change that the first router redirects is not parsed by the second router after the
  target": differs on purpose. UI5 reports the redirected hash to the second router after the
  target. A native second router parses that stale hash and displays its route although the URL
  shows the target; a guard router drops the report.
- "a hash change that the first router blocks is parsed by the second router, which follows the
  URL back": the second router displays each hash while the URL shows it, as a native router
  next to a guard router does.

## Private UI5 Coupling

The vendored lane covers public behavior. The router also depends on four things in UI5 that no
public contract protects. Two concern a component displayed as a routing target, two the title
history. The reasons
and the mechanisms are described in
[UI5 Internals the Router Relies On](./architecture.md#ui5-internals-the-router-relies-on).

| Coupling                                                                                                                                                                                                     | Use                                                                                                                                                                                                                                                                      | Verified against                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Private member `sap.ui.core.routing.Router#_bMatchingProcessStarted`                                                                                                                                         | Replaced by an accessor in `Router._mirrorMatchingProcess()`: reads `true` during a native route match and while a navigation waits for async guards                                                                                                                     | OpenUI5 1.154.0, OpenUI5 1.144.0, OpenUI5 1.120.0         |
| `Target#waitForComponentTarget` waits for a nested router with `oRouter.attachRouteMatched(resolve)`, the bare resolve function of a Promise, while the router is not initialized or the member reads `true` | `Router.attachRouteMatched()` remembers a listener with the exact shape of a Promise resolve function (`isPromiseResolver()` in `GuardPipeline.ts`) under that condition, and `Router._settleMatchWaiters()` resolves it when a navigation ends without a route match    | OpenUI5 1.154.0, OpenUI5 1.144.0, OpenUI5 1.120.0, Chrome |
| Private member `sap.ui.core.routing.Router#_bLastHashReplaced`                                                                                                                                               | Set to `false` in `Router._commitNavigation()` for the target of a redirected hash change that added a history entry or stepped forward (`Router._alignTitleHistory()`), so that UI5 adds the title of the target to the title history instead of replacing the last one | OpenUI5 1.154.0, OpenUI5 1.144.0, OpenUI5 1.120.0         |
| `Router#getTitleHistory()` returns the array of the title history itself, not a copy                                                                                                                         | After a redirected step back to a titled route, `Router._alignTitleHistory()` removes the title of the left route from that array, under the condition by which `Router#fireTitleChanged` removes a title on a step back                                                 | OpenUI5 1.154.0, OpenUI5 1.144.0, OpenUI5 1.120.0         |

Why there is no public alternative:

- **UI5's routing classes share the same internals among themselves.** `Route` writes the
  router's `_bMatchingProcessStarted`. `Target#waitForComponentTarget` reads it on the router of
  another component and subscribes the bare resolve function. `navTo()` and `fireTitleChanged()`
  hand `_bLastHashReplaced` and the title array to each other (source locations below). The
  router depends on these members because it changes when a route matches, and these members are
  how UI5's own classes learn about that.
- **Nothing public or protected can do the same.** `fireTitleChanged()` is private, and overriding
  it would couple to more of UI5 than the two members do. `navTo()` with or without `bReplace`
  cannot express "replace an entry that never got a title" (a new entry or a step forward). Nor
  can it express "drop the title of the entry that a step back arrived at": that title was never
  added, because the guard turned the route away before it matched. The title history and the
  wait for a nested router can only be reached through what UI5's own classes use.
- **Why the title history matters:** the Fiori launchpad builds the shell's navigation hierarchy
  from it (`sap/ushell/ui5service/ShellUIService.js`, `attachTitleChanged`, which reads the
  `history` parameter; also `getTitleHistory()[0]` for the initial title). Without the two title
  couplings, after a redirect that hierarchy would lose the page before it (new entry, step
  forward). After a redirected step back it would keep an entry for the page the guard turned
  away.

Pinning tests, on both UI5 lanes (`npm run test:qunit` and `npm run test:qunit:compat:120`):

- `packages/lib/test/qunit/router/async/AsyncGuards.qunit.ts`, module "Router - Native matching flag"
- `packages/lib/test/qunit/unit/GuardPipelineAsync.qunit.ts`, module "GuardPipeline - Promise resolve functions"
- `packages/lib/test/qunit/router/manifest/Instantiation.qunit.ts`, module "Router - Manifest-driven instantiation",
  the tests on a component loaded as a routing target and on parent routes of a nested component
- `GuardedEntryParity.qunit.ts: a redirected address bar entry leaves the history, the titles and the pages of a native address bar entry of the target`
- `RedirectedStepParity.qunit.ts: a redirected browser back leaves the history, the titles and the pages of a native browser back followed by a native navTo() to the target that replaces the entry`
- `RedirectedStepParity.qunit.ts: a redirected browser forward leaves the history, the titles and the pages of a native browser forward followed by a native navTo() to the target that replaces the entry`
- `RedirectedStepParity.qunit.ts`, the test of a redirect back to a page with the title of the page it leaves, and the tests of a redirect back to an untitled target or from an untitled route

What fails when UI5 or the browser changes:

| Change                                                                                                                                             | Failing test                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The member is renamed or no longer written                                                                                                         | "UI5 sets the flag for the time of a route match"                                                                                                                                                                                                                                                                                                                                                      |
| `Target#waitForComponentTarget` no longer waits while the member reads `true`                                                                      | "a parent route waits for the route that a nested component's first navigation is redirected to", "a parent route matches although an async guard blocks a nested component's first navigation" (the parent route matches before the child's guard has decided)                                                                                                                                        |
| The component target no longer subscribes the bare resolve function of a Promise with `attachRouteMatched()`, for example a function that wraps it | "a parent route matches although an async guard blocks a nested component's first navigation", "a parent route matches although a guard blocks a nested component that is displayed again" (both time out)                                                                                                                                                                                             |
| The engine prints or shapes a Promise resolve function differently                                                                                 | "the resolve function of a Promise is recognized by its exact shape". The assertion on the text `function () { [native code] }` documents Chrome and fails alone if only the text changes: the router reads the text from a real Promise at load time and keeps working. If the name or the length changes, the function is no longer recognized and the nested component tests above time out as well |
| `_bLastHashReplaced` is renamed, or `fireTitleChanged` no longer reads it                                                                          | "a redirected address bar entry leaves the history, the titles and the pages of a native address bar entry of the target" (the title history lacks the title of the route before the redirect), "a redirected browser forward leaves ..." (the same)                                                                                                                                                   |
| `getTitleHistory()` returns a copy, or `fireTitleChanged` handles a step back differently                                                          | "a redirected browser back leaves the history, the titles and the pages of a native browser back followed by a native navTo() to the target that replaces the entry" (the title history keeps the title of the replaced entry)                                                                                                                                                                         |

### UI5 source locations

Where UI5 writes and reads `_bMatchingProcessStarted` and where the component target waits,
verified against the sources of each version. OpenUI5 1.120.0 keeps the async variants in
`sap/ui/core/routing/async/` and `sap/m/routing/async/`.

| Location                                                        | OpenUI5 1.144.0                                   | OpenUI5 1.120.0                                     |
| --------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------- |
| `Route#_routeMatched` sets the member to `true`                 | `sap/ui/core/routing/Route.js` line 745           | `sap/ui/core/routing/async/Route.js` line 49        |
| `Route#_routeMatched` sets the member to `false`                | `sap/ui/core/routing/Route.js` line 831           | `sap/ui/core/routing/async/Route.js` line 135       |
| Sync routers (`async: false`) set and clear it                  | `sap/ui/core/routing/sync/Route.js` lines 44, 128 | `sap/ui/core/routing/sync/Route.js` lines 44, 128   |
| `Target#waitForComponentTarget` creates the Promise             | `sap/ui/core/routing/Target.js` line 786          | `sap/ui/core/routing/async/Target.js` line 245      |
| Condition for waiting (reads the member)                        | `sap/ui/core/routing/Target.js` line 819          | `sap/ui/core/routing/async/Target.js` line 275      |
| `oRouter.attachRouteMatched(resolve)`                           | `sap/ui/core/routing/Target.js` line 821          | `sap/ui/core/routing/async/Target.js` line 277      |
| A stopped nested router is initialized                          | `sap/ui/core/routing/Target.js` lines 823-826     | `sap/ui/core/routing/async/Target.js` lines 279-282 |
| `Target#suspend` stops the nested router                        | `sap/ui/core/routing/Target.js` line 619          | `sap/ui/core/routing/async/Target.js` line 81       |
| `display` handler of the `Router` constructor reads the member  | `sap/ui/core/routing/Router.js` line 289          | `sap/ui/core/routing/Router.js` line 264            |
| `Router#fireTitleChanged` reads the member                      | `sap/ui/core/routing/Router.js` line 1527         | `sap/ui/core/routing/Router.js` line 1495           |
| `Router#navTo` sets `_bLastHashReplaced`                        | `sap/ui/core/routing/Router.js` line 915          | `sap/ui/core/routing/Router.js` line 885            |
| `Router#fireTitleChanged` reads and clears `_bLastHashReplaced` | `sap/ui/core/routing/Router.js` lines 1475, 1502  | `sap/ui/core/routing/Router.js` lines 1445, 1472    |
| `Router#fireTitleChanged` removes the last title on a step back | `sap/ui/core/routing/Router.js` lines 1457-1461   | `sap/ui/core/routing/Router.js` lines 1427-1431     |
| `Router#getTitleHistory` returns the array itself               | `sap/ui/core/routing/Router.js` line 1555         | `sap/ui/core/routing/Router.js` line 1523           |
| `TargetHandler#_chainNavigation` is called                      | `sap/m/routing/Target.js` line 61                 | `sap/m/routing/async/Target.js` line 25             |

Procedure:

1. Open the routing sources of the new UI5 version: `sap/ui/core/routing/Route.js` (`_routeMatched`),
   `Target.js` (`waitForComponentTarget`, `suspend`) and `Router.js` (the `display` handler in the
   constructor, `fireTitleChanged`, `navTo`). In 1.120.0 the async variants are in `sap/ui/core/routing/async/`.
2. Verify where the member is written: `true` synchronously inside `parse()` when a route matches,
   `false` when its targets are displayed, before `routeMatched`.
3. Verify every reader of the member, and that `navTo()` with `bReplace` still sets
   `_bLastHashReplaced` and `fireTitleChanged` still reads and clears it, under which condition
   `fireTitleChanged` removes a title on a step back, and that `getTitleHistory()` returns the
   array itself and not a copy.
4. Verify how the component target waits for the nested router: under which condition it waits,
   what it subscribes to `routeMatched` and through which method, whether anything else can
   release the wait, and when it starts a stopped router.
5. Adapt `_mirrorMatchingProcess()`, `attachRouteMatched()` and `_settleMatchWaiters()` in
   `packages/lib/src/Router.ts`, and `isPromiseResolver()` in `packages/lib/src/GuardPipeline.ts`,
   to what UI5 does now. If UI5 offers a way to release the wait, use it and remove the
   recognition by shape.
6. Update the versions and line references in the [UI5 source locations](#ui5-source-locations) table above.
7. Run both QUnit lanes.

### Fiori launchpad (sap.ushell)

Where the launchpad stops and restarts app routers and holds back hash changes, as described in
[FLP Integration](./architecture.md#flp-integration). The shell replaces the global hash
changer before it creates an app component, so the router of an app starts on the launchpad's
hash changer; only the shell's own router starts before. A guard router that does start before
a replacement keeps working (test "a hash change is blocked and undone after
HashChanger.replaceHashChanger() has replaced the hash changer the router started with" in
`Lifecycle.qunit.ts`). Paths are relative to `sap/ushell/` in the
SAPUI5 sources; the `sap/ui/core` rows are from OpenUI5.

| Location                                                                                       | SAPUI5 1.144.0                                                          | SAPUI5 1.149.0                                                                               |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ShellNavigationInternal` replaces the global hash changer                                     | `services/ShellNavigationInternal.js` line 373                          | `services/ShellNavigationInternal.js` line 373                                               |
| The replacement takes over the listeners of the old hash changer, in front of its own          | `sap/ui/core/routing/HashChanger.js` lines 397-418, 452 (OpenUI5)       | same file and lines in OpenUI5 1.149.0                                                       |
| The shell initializes its own router before `ShellNavigationInternal.init()`                   | `renderer/Shell.controller.js` lines 276, 413                           | `renderer/Shell.controller.js` lines 291, 428                                                |
| `HashChanger#createRouterHashChanger` creates and caches one `RouterHashChanger`               | `sap/ui/core/routing/HashChanger.js` lines 90-108 (OpenUI5)             | same file and lines in OpenUI5 1.149.0                                                       |
| `treatHashChanged` runs the navigation filters; `Custom` ends the flow without events          | `services/ShellNavigationHashChanger.js` lines 805, 815-825             | `services/ShellNavigationHashChanger.js` lines 809, 819-829                                  |
| In-app change fires `hashChanged`                                                              | `services/ShellNavigationHashChanger.js` line 891                       | `services/ShellNavigationHashChanger.js` line 895                                            |
| Cross-app change fires `shellHashChanged` (`updateHashOnly: true`)                             | `services/ShellNavigationHashChanger.js` lines 70, 928                  | `services/ShellNavigationHashChanger.js` lines 72, 932                                       |
| Filter order: `_disableSourceAppRouter` before `_handleDataLoss`                               | `renderer/Shell.controller.js` lines 419, 421                           | `renderer/Shell.controller.js` lines 434, 436                                                |
| `_disableSourceAppRouter` calls `stop()` on a cross-app change                                 | `renderer/Shell.controller.js` line 895                                 | `renderer/Shell.controller.js` line 926                                                      |
| `_resumeAppRouterIgnoringCurrentHash` calls `initialize(true)`                                 | `renderer/Shell.controller.js` line 911                                 | `renderer/Shell.controller.js` line 942                                                      |
| `_handleDataLoss` reads the dirty state, for in-app changes too                                | `renderer/Shell.controller.js` line 987                                 | `renderer/Shell.controller.js` line 1015                                                     |
| `_handleDataLoss` swallows the change that puts the hash back                                  | `renderer/Shell.controller.js` line 953                                 | `renderer/Shell.controller.js` line 984                                                      |
| `_handleDataLoss` puts the hash back and returns `Custom`                                      | `renderer/Shell.controller.js` line 1057                                | `renderer/Shell.controller.js` line 1074                                                     |
| `_restoreHashUsingAction` restarts the router                                                  | `renderer/Shell.controller.js` line 1124                                | `renderer/Shell.controller.js` line 1141                                                     |
| `window.confirm()` of the data-loss prompt                                                     | `renderer/Shell.controller.js` line 1097                                | `renderer/Shell.controller.js` line 1114                                                     |
| Restart after opening the app in a new window, after a failed navigation                       | `renderer/Shell.controller.js` lines 1934, 2031                         | `renderer/Shell.controller.js` lines 1855, 1938                                              |
| Keep-alive: routers of cached apps stopped before a new app is created                         | `appIntegration/contracts/EmbeddedUI5Handler.js` line 33                | `appIntegration/contracts/EmbeddedUI5Handler.js` line 58                                     |
| Keep-alive: hide calls `stop()`, unless `isKeepAliveSupported()`                               | `appIntegration/contracts/EmbeddedUI5Handler.js` lines 88, 100          | `appIntegration/contracts/EmbeddedUI5Handler.js` lines 138, 150                              |
| Keep-alive: show calls `initialize(true)`, unless `isKeepAliveSupported()`                     | `appIntegration/contracts/EmbeddedUI5Handler.js` lines 112, 128         | `appIntegration/contracts/EmbeddedUI5Handler.js` lines 170, 186                              |
| `Component#deactivate()` stops the router                                                      | `sap/ui/core/Component.js` line 3968 (OpenUI5)                          | `sap/ui/core/Component.js` line 3974 (OpenUI5)                                               |
| `Component#activate()` calls `initialize()`                                                    | `sap/ui/core/Component.js` line 4031 (OpenUI5)                          | `sap/ui/core/Component.js` line 4037 (OpenUI5)                                               |
| Restricted keep-alive: kept apps destroyed on the way home                                     | `appIntegration/AppLifeCycle.js` line 437                               | `appIntegration/AppLifeCycle.js` line 611                                                    |
| Iframe app hidden: `deactivate()` or `stop()`                                                  | `appRuntime/ui5/services/AppLifeCycleAgent.js` lines 295, 301           | `appRuntime/ui5/services/AppLifeCycleAgent.js` lines 323, 329                                |
| Iframe app shown: `activate()`, `initialize()` or `initialize(true)`                           | `appRuntime/ui5/services/AppLifeCycleAgent.js` lines 339-348            | `appRuntime/ui5/services/AppLifeCycleAgent.js` lines 363-372                                 |
| Iframe runtime swaps the dirty-state providers per app                                         | `appRuntime/ui5/services/AppLifeCycleAgent.js` lines 290, 331           | not present                                                                                  |
| Iframe: the shell sends `appLifeCycle.store` and `appLifeCycle.restore`                        | `appIntegration/contracts/StatefulContainerV2Handler.js` lines 101, 111 | `appIntegration/contracts/StatefulContainerV2Handler.js` lines 142, 161                      |
| Iframe: `store` without a running app answers `isInvalidIframe`                                | `appRuntime/ui5/services/AppLifeCycleAgent.js` line 277                 | `appRuntime/ui5/services/AppLifeCycleAgent.js` line 307                                      |
| Iframe: the app runtime places the app in the element `content` and then records it as running | `appRuntime/ui5/AppRuntime.js` lines 1128, 1136                         | `appRuntime/ui5/AppRuntime/AppRuntimeInternal.js` line 1056                                  |
| Iframe: every hash write asks for unsaved data first                                           | `appRuntime/ui5/AppRuntime.js` lines 751, 760                           | `appRuntime/ui5/AppRuntime/AppRuntimeInternal.js` lines 658, 667                             |
| Iframe: `window.confirm()` of the app runtime                                                  | `appRuntime/ui5/services/AppLifeCycleAgent.js` line 627                 | `appRuntime/ui5/services/AppLifeCycleAgent.js` line 670                                      |
| Iframe: a registered provider is not reported to the shell                                     | `appRuntime/ui5/services/Container.js` lines 94-99                      | `appIntegration/PostMessageHandler/AppInfoHandler.js` lines 176-191 (the message is ignored) |
| A URL app without a URL template opens in a new window                                         | `navigationMode.js` line 354                                            | `navigationMode.js` line 353                                                                 |
