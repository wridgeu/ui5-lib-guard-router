# Declarative Manifest-Based Guard Configuration

**Status**: Implemented
**Closes**: #41, #31
**Supersedes**: PR #46 (`feat/router-options-manifest-config`)

## Overview

One manifest-first configuration for the guard router, under `sap.ui5.routing.config.guardRouter`:

1. **Router options** (from PR #46): `unknownRouteRegistration` and `navToPreflight`, plus the per-call `skipGuards` option of `navTo()`.
2. **Declarative guards** (issue #41): guard module paths in the manifest.

Multi-guard modules, cherry-picks, guard names and the `"lazy"` loading strategy came in a second step: [08b](./08b-multi-guard-modules-and-pattern5-loading.md).

## Manifest schema

```json
{
	"sap.ui5": {
		"routing": {
			"config": {
				"routerClass": "ui5.guard.router.Router",
				"guardRouter": {
					"unknownRouteRegistration": "warn",
					"navToPreflight": "guard",
					"guardLoading": "lazy",
					"guards": {
						"*": ["guards.authGuard"],
						"admin": {
							"enter": ["guards.adminGuard"],
							"leave": ["guards.unsavedChangesGuard"]
						},
						"editor": {
							"leave": ["guards.dirtyFormGuard"]
						},
						"settings": ["guards.settingsGuard"]
					}
				}
			}
		}
	}
}
```

### Router options

| Option                     | Values                              | Default   | Description                                                                                                                         |
| -------------------------- | ----------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `unknownRouteRegistration` | `"ignore"` \| `"warn"` \| `"throw"` | `"warn"`  | Registration for an unknown route name. Under `"throw"`, a manifest guard on an unknown route is logged and skipped; nothing throws |
| `navToPreflight`           | `"guard"` \| `"bypass"` \| `"off"`  | `"guard"` | How a programmatic `navTo()` runs the guards                                                                                        |
| `guardLoading`             | `"block"` \| `"lazy"`               | `"lazy"`  | How manifest guard modules load                                                                                                     |
| `inheritance`              | `"none"` \| `"pattern-tree"`        | `"none"`  | Whether manifest guards and route metadata also apply to routes whose pattern extends the declared route's pattern (1.6.0)          |

The block also holds the `guards` and `routeMeta` maps, which are not options. An invalid option value is warned about and replaced by its default.

### Guards block

| Key           | Format                                     | Equivalent API                        |
| ------------- | ------------------------------------------ | ------------------------------------- |
| `"*"`         | `string[]`                                 | `addGuard()` for each module          |
| `"routeName"` | `string[]` (shorthand for `enter`)         | `addRouteGuard()` for each module     |
| `"routeName"` | `{ "enter": string[], "leave": string[] }` | `addRouteGuard()` / `addLeaveGuard()` |

- There are no global leave guards. The object form under `"*"` logs an info message and treats `enter` as global guards; a `leave` array under `"*"` is warned about and skipped.
- Keys other than `enter` and `leave`, and `enter` or `leave` values that are not arrays, are warned about and skipped.
- Route keys are the route names UI5 registers: the `name` of each entry in a `routes` array; for an object map, the entry's `name` if set, else its key.
- Array order is execution order within a route.

### Module paths

- Paths use dot notation and resolve relative to the component namespace (`sap.app/id` of the router's owner component). In app `demo.app`, `"guards.authGuard"` becomes `demo/app/guards/authGuard`, and `"authGuard"` becomes `demo/app/authGuard`.
- Without an owner (standalone tests), no namespace is prepended; dots only become slashes.
- A `"module:"` prefix skips the namespace, following UI5's `sap.ui.core.routing.Target._getEffectiveObjectName()`: `"module:some.other.lib.guard"` becomes `some/other/lib/guard`.
- `sap.ui.require` caches modules globally, so a loaded module is never loaded again.

### Guard module format

A module's default export is a function, an array of functions or a plain object of functions. A module with only named exports counts as an object, in the order its exports are written. `#key` picks one export: `"guards.security#checkAuth"`. [08b](./08b-multi-guard-modules-and-pattern5-loading.md) has the shapes, the cherry-pick rules and the risks.

```typescript
// guards/authGuard.ts: guard name "authGuard"
import type { GuardContext, GuardResult } from "ui5/guard/router/types";

export default function authGuard(context: GuardContext): GuardResult {
	// A module guard has no closure over component state.
	// Share data between guards through context.bag; reach models through context.ownerComponent (1.7.0).
	const user = context.bag.get("user");
	return user ? true : "login";
}
```

The shape is detected when the router resolves the module: at `initialize()` for cached or `"block"`-loaded modules, otherwise when a lazy wrapper first loads it.

## Guard context `bag`

A `Map<string, unknown>` on `GuardContext` for passing data between guards. Manifest guards need it because they are standalone functions.

- Created per navigation attempt and shared by all its guards (leave, global enter, route enter), including those of every redirect hop.
- Not carried to the next navigation.
- The router never reads or writes it.

```typescript
// Guard A
context.bag.set("user", await fetchUser(context.signal));

// Guard B, later in array order
const user = context.bag.get("user");
```

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

```typescript
type UnknownRouteRegistrationPolicy = "ignore" | "warn" | "throw";
type NavToPreflightMode = "guard" | "bypass" | "off";
type GuardLoading = "block" | "lazy";

interface GuardRouterOptions {
	unknownRouteRegistration?: UnknownRouteRegistrationPolicy;
	navToPreflight?: NavToPreflightMode;
	guardLoading?: GuardLoading;
	inheritance?: Inheritance; // 1.6.0
	guards?: ManifestGuardConfig;
	routeMeta?: Record<string, Record<string, unknown>>; // 1.6.0
}

interface GuardNavToOptions {
	skipGuards?: boolean;
}

type ManifestGuardConfig = Record<string, string[] | ManifestRouteGuardConfig>;

interface ManifestRouteGuardConfig {
	enter?: string[];
	leave?: string[];
}

interface GuardContext {
	toRoute: string;
	toHash: string;
	toArguments: RouteInfo["arguments"];
	fromRoute: string;
	fromHash: string;
	signal: AbortSignal;
	bag: Map<string, unknown>; // 1.5.0
	toMeta: Readonly<Record<string, unknown>>; // 1.6.0
	fromMeta: Readonly<Record<string, unknown>>; // 1.6.0
	ownerComponent?: UIComponent; // 1.7.0
}
```

The `GuardRouter` interface declares the four `navTo` overloads above.

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
