# Declarative Manifest-Based Guard Configuration

**Status**: Implemented
**Closes**: #41, #31
**Supersedes**: PR #46 (`feat/router-options-manifest-config`)

## Overview

One manifest-first configuration for the guard router, under `sap.ui5.routing.config.guardRouter`:

1. **Router options** (from PR #46): `unknownRouteRegistration` and `navToPreflight`, plus the per-call `skipGuards` option of `navTo()`.
2. **Declarative guards** (issue #41): guard module paths in the manifest.

Multi-guard modules, cherry-picks, guard names and the `"lazy"` loading strategy came in a second step: [08b](./08b-multi-guard-modules-and-pattern5-loading.md).

## Configuration

The schema, the options with their values and defaults, the `guards` block, module paths and the guard module format are documented once, in the library README: [Manifest Configuration](../../packages/lib/README.md#manifest-configuration) and [Guard module format](../../packages/lib/README.md#guard-module-format). The decisions behind them:

- Everything lives in `sap.ui5.routing.config.guardRouter`, next to `routerClass`, so router options and guards are configured in one place. An invalid option value is warned about and replaced by its default instead of failing the app.
- There are no global leave guards (see [01](./01-leave-guards.md#per-route-only)); `leave` under `"*"` is warned about and skipped.
- Module paths resolve relative to the component namespace, and a `"module:"` prefix opts out, following UI5's `sap.ui.core.routing.Target._getEffectiveObjectName()`.
- The export shape is detected when the router resolves the module: at `initialize()` for cached or `"block"`-loaded modules, otherwise when a lazy wrapper first loads it.

## Guard context `bag`

Manifest guards are standalone functions without a closure over component state, so they need `context.bag` ([README](../../packages/lib/README.md#guard-context-bag)) to pass data between them. It is created per navigation attempt, shared by all guards of that attempt including every redirect hop, and never read or written by the router.

`bag` is a required field (1.5.0). Guard functions are unaffected; code that builds a `GuardContext` literal (usually tests) must add `bag: new Map()`. This was shipped as a minor version.

## Constructor and `initialize()`

A TypeScript class must call `super()` before it touches `this`, so the constructor strips `guardRouter` from the config inline:

```
constructor(routes, config, owner, ...)
  ├── super(routes, config without guardRouter, owner, ...)
  ├── parseGuardRouterConfig(guardRouter, sap.app/id)   (GuardConfig.ts)
  │   ├── options   -> _options
  │   ├── routeMeta -> _meta (RouteMetaStore, RouteMeta.ts)
  │   └── guards    -> _pendingGuardDescriptors
  └── guardLoading "lazy": preload hint sap.ui.require(uniqueModulePaths)

initialize()
  ├── no manifest guards: start the router
  ├── inheritance "pattern-tree": expand descriptors to descendant routes
  ├── "lazy" (default): register the guards from createLazyGuards() (GuardModules.ts),
  │   then start synchronously
  └── "block": load all modules (loadGuardModules()), register their guards,
      then start
```

Every manifest guard goes through `_registerManifestGuard()`. Manifest guards are registered in `initialize()`, so they exist before the first navigation. Guards that a controller of a routed view adds in `onInit` run after them, because `initialize()` displays the target views. Guards added before `initialize()`, for example in a root view created synchronously, run before them; see [Mixing declarative and programmatic guards](../../packages/lib/README.md#mixing-declarative-and-programmatic-guards).

How `destroy()`, `stop()` and `navTo()` behave while `"block"` modules load: library README, [Lifecycle](../../packages/lib/README.md#lifecycle), and [Module Loading and Destroy Safety](../reference/module-loading-and-destroy-safety.md#stop-and-initialize-while-modules-load).

The new private state is `_options` (normalized options, all fields set) and `_pendingGuardDescriptors` (cleared by `initialize()`).

## Guard loading

### `"block"`

`initialize()` loads all manifest modules first and starts the router when they are registered. The first navigation waits for that, so no navigation runs without its manifest guards. Startup latency grows with module load time. A module that fails to load is warned about and its guards are skipped.

### `"lazy"` (default)

The constructor fires a preload hint for all module paths. `initialize()` registers lazy wrappers and starts synchronously, without an async gap. [08b](./08b-multi-guard-modules-and-pattern5-loading.md#1-pattern-5-preload--lazy) has the design.

- **No guard is skipped**, not even on the first navigation.
- **First navigation:** a module cached by the preload runs synchronously. On a miss the guard returns a Promise while its module loads, and the rest of that navigation is async.
- **Later navigations** are synchronous: cherry-pick wrappers read the module cache, and a bare-path wrapper keeps the guards it loaded.
- **A bare-path module that missed the cache** runs all its guards in order on the first navigation, stops at the first one that does not allow, and stops if the navigation is superseded.
- **Failures:** a module that fails to load warns and settles the navigation as `Error`. A guard that throws during that first load also settles as `Error`, like any throwing guard.
- **Unvisited routes** cost nothing beyond the preload hint.

Keep guard modules small: a cache miss makes the first navigation that needs the guard wait for its module.

## `navTo()` and preflight modes

Two levels:

1. **Global:** `navToPreflight`, the default for every programmatic `navTo()`.
2. **Per call:** `{ skipGuards: true }`, a one-way escape hatch for one call.

```typescript
// Standard UI5 overloads
navTo(routeName: string, parameters?: object, bReplace?: boolean): this;
navTo(routeName: string, parameters?: object, componentTargetInfo?: Record<string, ComponentTargetParameters>, bReplace?: boolean): this;

// With GuardNavToOptions, always the last argument
navTo(routeName: string, parameters?: object, bReplace?: boolean, options?: GuardNavToOptions): this;
navTo(routeName: string, parameters?: object, componentTargetInfo?: Record<string, ComponentTargetParameters>, bReplace?: boolean, options?: GuardNavToOptions): this;

router.navTo("home", {}, true, { skipGuards: true });
```

```
navTo(...)
  ├── normalize the overloads, extract GuardNavToOptions
  ├── committing/redirect phase? -> super.navTo() (the final step of a redirect chain)
  ├── skipGuards or navToPreflight "bypass":
  │     phase committing (origin "preflight"), super.navTo(), parse() commits.
  │     Without a hash change navTo() commits directly. Settles Committed.
  ├── navToPreflight "off":
  │     super.navTo() without a phase change; parse() runs the guards.
  └── navToPreflight "guard" (default): evaluate the guards, apply the decision
```

`"bypass"` and `skipGuards` reuse the committing phase, so no extra state (such as a `_guardsBypassedHash` field) is needed. They settle as `Committed`: the guards were not involved, but the navigation committed normally.

`"off"` has all limits of the `parse()` fallback: the hash changes before the guards run, a blocked navigation must restore the hash, and `navigationSettled()` can resolve late with async guards. It does not suit apps that await `navigationSettled()` after `navTo()` with async guards. With `guardLoading: "lazy"` the first evaluation may also wait for a module.

## Unknown route registration

`_warnIfRouteUnknown()` became `_handleUnknownRouteRegistration()`:

- `"ignore"`: registers silently.
- `"warn"` (default): logs a warning, registers.
- `"throw"`: throws synchronously and registers nothing. A `RouteGuardConfig` object is all or nothing.

A manifest guard has no caller that could catch the throw. Under `"throw"`, `_registerManifestGuard()` logs `guardRouter.guards: failed to register "<modulePath>"` and skips that guard; the other guards register and the router starts. This holds in both loading modes and for guards that `addRoute()` registers through inheritance.

## Types

`GuardRouterOptions`, `GuardNavToOptions`, `ManifestGuardConfig` and `GuardContext` are in `packages/lib/src/types.ts`; the `GuardRouter` interface declares the four `navTo` overloads above.

## Execution order

The phase order and where manifest guards run relative to imperative ones: library README, [Execution order](../../packages/lib/README.md#execution-order) and [Mixing declarative and programmatic guards](../../packages/lib/README.md#mixing-declarative-and-programmatic-guards).

## Named guard logging

Manifest guards are named after their module. The name appears when the guard throws:
`Enter guard [1] "checks#1" on route "admin" threw, navigation failed`.

- Function export: the last path segment (`guards.auth` -> `auth`); with `#key`, the key.
- Array export: `moduleName#index` (`checks#0`), also when cherry-picked.
- Object export: the key (`checkAuth`); cherry-picked by index, the key at that index.
- A lazy wrapper whose module missed the cache carries the module name (or `module#key`) until it loads, then the name of the guard it resolved to. A bare-path module with several guards keeps the module name, because one wrapper runs them all.

Guards added with `addGuard()` and the other imperative methods have no name; their logs show the phase and index only.

## Tests

Under `packages/lib/test/qunit/router/`:

- `lifecycle/Options.qunit.ts`: the constructor options and their defaults, the three `unknownRouteRegistration` policies, the three `navToPreflight` modes with their settlements, `skipGuards` in both overload positions.
- `manifest/Instantiation.qunit.ts`: manifest-driven instantiation through a `UIComponent`.
- `manifest/InvalidConfig.qunit.ts`: invalid `guards` blocks, entries and exports warn and are skipped.
- `manifest/DeclarativeGuards.qunit.ts`: registration from the guards block, `"*"`, the `module:` prefix, both loading modes, guard names in logs, the shared `bag`, manifest guards before imperative ones.
- `manifest/GuardOrder.qunit.ts`: order, shapes and lifecycle; the preload in the constructor and the block load in `initialize()` (asserted through the resource timing of a fixture module nothing else loads); the `"throw"` policy on manifest guards.
- `manifest/MultiGuardModules.qunit.ts`, `manifest/CherryPick.qunit.ts`: see [08b](./08b-multi-guard-modules-and-pattern5-loading.md#tests).
- `navigation/NavToPreflight.qunit.ts`: the preflight itself.

## Risks

| Risk                                                     | Mitigation                                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Module guards cannot close over component state          | `context.ownerComponent` (1.7.0) for component state, `context.bag` for data between guards          |
| Guard order is implicit (array order)                    | Documented and tested                                                                                |
| Module paths are strings without compile-time validation | Runtime warnings on invalid paths; a UI5 linter rule could follow                                    |
| Manifest and imperative guards coexist                   | Defined order: registration order within each phase ([Execution order](#execution-order))            |
| `"lazy"` can make the first navigation async             | The preload makes a cache hit the common case; keep modules small                                    |
| `"off"` inherits the `parse()` fallback limits           | Documented as unsuitable for apps that await `navigationSettled()` after `navTo()` with async guards |
| `bag` is a required field on `GuardContext`              | Guard functions are unaffected; only code that builds `GuardContext` literals changes                |

## Out of scope

- Build-time validation of guard module paths (a future linter rule)
- Guard registration through component metadata instead of the manifest
- Guard hot module replacement (it would follow from `sap.ui.require` reference semantics)
