# Declarative Manifest-Based Guard Configuration

**Date**: 2026-03-21 (updated 2026-03-22)
**Status**: Implemented
**Closes**: #41, #31
**Supersedes**: PR #46 (`feat/router-options-manifest-config`)

## Overview

Combine two related features into one cohesive manifest-first configuration system for the guard router:

1. **Router options** (from PR #46): `unknownRouteRegistration`, `navToPreflight`, `skipGuards`
2. **Declarative guard registration** (issue #41): declaring guard module paths in the manifest

Both features live under `sap.ui5.routing.config.guardRouter` in `manifest.json` and are implemented fresh against the state machine architecture (merged to main via `refactor/state-machine-v2`).

## Manifest Schema

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

### Router Options

| Option                     | Values                              | Default   | Description                                                                                                                                                                     |
| -------------------------- | ----------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unknownRouteRegistration` | `"ignore"` \| `"warn"` \| `"throw"` | `"warn"`  | Behavior when registering guards for unknown route names. With `"throw"`, a manifest guard on an unknown route is skipped and an error is logged; `initialize()` does not throw |
| `navToPreflight`           | `"guard"` \| `"bypass"` \| `"off"`  | `"guard"` | How programmatic `navTo()` interacts with the guard pipeline                                                                                                                    |
| `guardLoading`             | `"block"` \| `"lazy"`               | `"lazy"`  | How manifest-declared guard modules are loaded at initialization                                                                                                                |

### Guards Block

| Key           | Format                                     | Equivalent API                                   |
| ------------- | ------------------------------------------ | ------------------------------------------------ |
| `"*"`         | `string[]`                                 | `addGuard()` for each module                     |
| `"routeName"` | `string[]` (shorthand)                     | `addRouteGuard()` for each module (enter guards) |
| `"routeName"` | `{ "enter": string[], "leave": string[] }` | `addRouteGuard()` / `addLeaveGuard()`            |

- The `"*"` key only supports the `string[]` format (global leave guards do not exist in the API). Using the object form `{ "enter": [...] }` for `"*"` logs an info message and is treated as the array form; a `leave` array under `"*"` logs a warning and is skipped.
- Route keys match the route names UI5 registers: the `name` of each entry in a `routes` array; for routes given as an object map, the entry's `name` if set, else its key.
- Module paths use **dot notation** and resolve **relative to the component namespace** (`sap.app.id`).
    - Example: In app `demo.app`, `"guards.authGuard"` resolves to `demo/app/guards/authGuard` for `sap.ui.require`.
    - `"authGuard"` (no folder) resolves to `demo/app/authGuard` — the component root.
    - The component namespace is read from the router's owner component (the `oOwner` constructor argument) via `owner.getManifestEntry("sap.app")?.id`. If unavailable (e.g. standalone tests without a component), no namespace is prepended and the dot path is only converted to slashes.
    - Paths prefixed with `"module:"` bypass namespace resolution, following UI5's `sap.ui.core.routing.Target._getEffectiveObjectName()` convention. Example: `"module:some.other.lib.guard"` resolves to `some/other/lib/guard` directly.
- Each module's default export must be one of three shapes: a single function, an array of functions, or a plain object with function values (see [Guard Module Format](#guard-module-format)).
- A module entry may include a `#` cherry-pick suffix to select a single export: `"guards.security#checkAuth"` (see [Cherry-Pick Syntax](#cherry-pick-syntax)).
- Array order defines execution order within a route.
- Manifest guards are registered in `initialize()`, so they run after imperative guards added before `initialize()` and before those added after it (see [Execution Order](#execution-order)).

### Guard Module Format

A guard module's default export must be one of three shapes. The shape is detected when the router resolves the module's exports: at `initialize()` for cached or `"block"`-loaded modules, otherwise when the lazy wrapper first loads the module.

**Shape 1: Function** — single guard; name derived from the last segment of the module path.

```typescript
// guards/authGuard.ts → guard name: "authGuard"
import type { GuardContext, GuardResult } from "ui5/guard/router/types";

export default function authGuard(context: GuardContext): GuardResult {
	// Standalone function — no closure over component state.
	// For inter-guard data, use context.bag; for component state (models),
	// use context.ownerComponent (since 1.7.0).
	const user = context.bag.get("user");
	return user ? true : "login";
}
```

**Shape 2: Array** — ordered guards; names derived as `"moduleName#0"`, `"moduleName#1"`, etc. Array index = execution order.

```typescript
// guards/checks.ts → guard names: "checks#0", "checks#1"
export default [
	function (context: GuardContext): GuardResult {
		return checkA();
	},
	function (context: GuardContext): GuardResult {
		return checkB();
	},
];
```

**Shape 3: Plain Object** — named guards; object key = guard name; key insertion order = execution order (guaranteed by ES2015+).

```typescript
// guards/security.ts → guard names: "checkAuth", "checkRole", "checkPermission"
export default {
	checkAuth(context: GuardContext): GuardResult {
		/* ... */
	},
	checkRole(context: GuardContext): GuardResult {
		/* ... */
	},
	checkPermission(context: GuardContext): GuardResult {
		/* ... */
	},
};
```

Non-function entries within arrays or objects are warned and skipped individually. Empty arrays (`[]`) and empty objects (`{}`) pass shape detection but produce zero guards and log a warning.

Detection logic:

```
typeof export === "function"    → Shape 1
Array.isArray(export)           → Shape 2
plain object (Object or null prototype) → Shape 3
anything else                   → warning, module skipped
```

### Cherry-Pick Syntax

Append `#exportKey` to a module path to select a single export instead of registering all exports from the module.

| Syntax                        | Behavior                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `"guards.security"`           | Register **all** exports from module (key/array order)                                               |
| `"guards.security#checkAuth"` | Register only the named export (object key)                                                          |
| `"guards.checks#1"`           | Register only the export at index 1 (array index, or position in object key order)                   |
| `"guards.auth#anything"`      | For single-function modules, `#` is ignored — the function is the only export. Logs a debug message. |

The `module:` prefix and `#` cherry-pick compose naturally: `"module:some.other.lib.guards#checkAuth"` resolves to module path `some/other/lib/guards` with export key `checkAuth`. Parsing splits on `#` first, then namespace resolution handles the `module:` prefix on the base path.

If the specified key does not exist or is not a function, a warning is logged and the guard is skipped.

### Module Caching

`sap.ui.require` caches modules globally. Once a guard module is loaded (by either loading strategy), subsequent calls to `sap.ui.require("module/path")` return the cached export synchronously. There is no re-loading overhead for repeated guard evaluations.

## Guard Context `bag`

A shared mutable `Map<string, unknown>` on `GuardContext` for inter-guard data passing:

- Created fresh per pipeline run.
- Shared across all guards in the same pipeline (leave → global enter → route enter).
- The router never reads from or writes to it — it is purely a carrier.
- Scoped to a single navigation attempt; garbage collected when the pipeline finishes.

**Breaking change note**: `bag` is added as a required field on `GuardContext`. Existing guard functions that receive `GuardContext` are unaffected (they simply don't read `bag`). However, any application or test code that constructs a `GuardContext` literal will need to include `bag: new Map()`. This is a minor semver breaking change to the public type.

```typescript
// Guard A stores data
context.bag.set("user", await fetchUser(context.signal));

// Guard B reads data (runs after Guard A in array order)
const user = context.bag.get("user");
```

## Constructor and Initialization Flow

In TypeScript native classes, `super()` must be called before accessing `this`. The constructor handles this by preparing the cleaned config inline:

```
Constructor(routes, config, owner, ...)
  ├── Destructure guardRouter from config inline
  ├── Call super(routes, cleanedConfig, owner, ...) with guardRouter removed
  ├── parseGuardRouterConfig(guardRouter, sap.app/id) in GuardConfig.ts:
  │   ├── options (unknownRouteRegistration, navToPreflight, guardLoading, inheritance)
  │   │   → store as _options
  │   ├── routeMeta → RouteMetaStore (_meta, RouteMeta.ts)
  │   └── guards block → store as _pendingGuardDescriptors
  └── If guardLoading === "lazy":
        Fire preload hint: sap.ui.require(uniqueModulePaths) — no success callback;
        a failed load is reported when the guard runs

initialize()
  ├── If guardLoading === "block" and pending guards exist:
  │     Load all guard modules via sap.ui.require (GuardModules.loadGuardModules)
  │     → Register resolved functions through _registerManifestGuard
  │       (addGuard / addRouteGuard / leave guard registration)
  │     → Then call super.initialize()
  │     A router destroyed while loading registers nothing and does not start;
  │     after stop() the guards are registered but super.initialize() waits
  │     for the next initialize() call
  ├── If guardLoading === "lazy" (default) and pending guards exist:
  │     Create guards per descriptor (GuardModules.createLazyGuards),
  │     register them through _registerManifestGuard
  │     Bare-path descriptors: probe sap.ui.require(path)
  │     → Cache hit: register each guard of the module individually
  │     → Cache miss: register one wrapper that loads the module on first
  │       navigation and runs all of its guards in order (sync once loaded)
  │     Cherry-picked descriptors: register one lazy wrapper each
  │     → Each wrapper tries sync sap.ui.require(path) first (cache hit)
  │     → On cache miss, loads async via sap.ui.require([path], cb)
  │     Call super.initialize() — always synchronous in this mode
  └── If no guards declared:
        Call super.initialize() directly
```

The `initialize()` override delays the first `parse()` call (triggered by the HashChanger listener) until guards are loaded (`"block"`) or registers lazy wrappers (`"lazy"`). In `"lazy"` mode `initialize()` is always synchronous — the preload hint fired in the constructor makes cache hits the common case. This is safe because `initialize()` is the entry point for hash listening.

## navTo() with Preflight Modes

Two-level override system:

1. **Global** (`navToPreflight` in manifest/constructor) — default for all programmatic `navTo()` calls
2. **Per-call** (`{ skipGuards: true }` in `navTo()` options) — one-way escape hatch for a single call

### navTo Overload Signatures

```typescript
// Standard UI5 overloads (unchanged)
navTo(routeName: string, parameters?: object, bReplace?: boolean): this;
navTo(routeName: string, parameters?: object, componentTargetInfo?: Record<string, ComponentTargetParameters>, bReplace?: boolean): this;

// Extended overloads with GuardNavToOptions
navTo(routeName: string, parameters?: object, bReplace?: boolean, options?: GuardNavToOptions): this;
navTo(routeName: string, parameters?: object, componentTargetInfo?: Record<string, ComponentTargetParameters>, bReplace?: boolean, options?: GuardNavToOptions): this;
```

`GuardNavToOptions` is always the last argument. When using the short form (without `componentTargetInfo`), pass `options` in the 4th position:

```typescript
router.navTo("home", {}, true, { skipGuards: true });
```

### Preflight Decision Flow

```
navTo(routeName, parameters?, componentTargetInfoOrReplace?, replaceOrOptions?, options?)
  ├── Parse overloads → normalize arguments + extract GuardNavToOptions
  ├── Committing/redirect phase? → bypass to super.navTo() (existing)
  │
  ├── skipGuards === true OR navToPreflight === "bypass"?
  │     Set phase → committing (origin: "preflight")
  │     Call super.navTo() → parse() sees committing phase, commits
  │     (no hash change → navTo() commits directly; super.navTo() throws →
  │     phase reset to idle)
  │     Settlement outcome: NavigationOutcome.Committed
  │
  ├── navToPreflight === "off"?
  │     Call super.navTo() directly (no phase change)
  │     → parse() runs guards as fallback (deferred path)
  │     Note: inherits all limitations of the parse() fallback —
  │     hash changes before guards run, blocked navigations must
  │     restore the hash, and navigationSettled() may resolve late
  │     for async guards.
  │
  └── navToPreflight === "guard" (default)?
        Existing preflight flow: evaluate guards → apply decision
```

### Unknown Route Guard Registration

`_warnIfRouteUnknown()` becomes `_handleUnknownRouteRegistration()`:

- `"ignore"` — register silently
- `"warn"` — log warning, still register (default)
- `"throw"` — throw synchronously, do not register (all-or-nothing for config objects)

A manifest guard on an unknown route has no caller that could catch the throw. Under `"throw"`, `_registerManifestGuard` logs `guardRouter.guards: failed to register "<modulePath>"` and skips that guard; the other guards are registered and the router still starts. This holds in `"block"` and `"lazy"` mode, and for guards that `addRoute()` registers through inheritance.

## New and Modified Types

```typescript
// --- New types ---

type UnknownRouteRegistrationPolicy = "ignore" | "warn" | "throw";
type NavToPreflightMode = "guard" | "bypass" | "off";
type GuardLoading = "block" | "lazy";

interface GuardRouterOptions {
	unknownRouteRegistration?: UnknownRouteRegistrationPolicy;
	navToPreflight?: NavToPreflightMode;
	guardLoading?: GuardLoading;
	inheritance?: Inheritance; // added in v1.6.0
	guards?: ManifestGuardConfig;
	routeMeta?: Record<string, Record<string, unknown>>; // added in v1.6.0
}

interface GuardNavToOptions {
	skipGuards?: boolean;
}

type ManifestGuardConfig = Record<string, string[] | ManifestRouteGuardConfig>;

interface ManifestRouteGuardConfig {
	enter?: string[];
	leave?: string[];
}

// --- Modified types ---

interface GuardContext {
	toRoute: string;
	toHash: string;
	toArguments: RouteInfo["arguments"];
	fromRoute: string;
	fromHash: string;
	signal: AbortSignal;
	bag: Map<string, unknown>; // added in v1.5.0
	toMeta: Readonly<Record<string, unknown>>; // added in v1.6.0
	fromMeta: Readonly<Record<string, unknown>>; // added in v1.6.0
	ownerComponent?: UIComponent; // added in v1.7.0
}

// --- GuardRouter interface navTo overloads ---

interface GuardRouter extends MobileRouter {
	navTo(routeName: string, parameters?: object, bReplace?: boolean): this;
	navTo(
		routeName: string,
		parameters?: object,
		componentTargetInfo?: Record<string, ComponentTargetParameters>,
		bReplace?: boolean,
	): this;
	navTo(routeName: string, parameters?: object, bReplace?: boolean, options?: GuardNavToOptions): this;
	navTo(
		routeName: string,
		parameters?: object,
		componentTargetInfo?: Record<string, ComponentTargetParameters>,
		bReplace?: boolean,
		options?: GuardNavToOptions,
	): this;
	// ... existing guard methods unchanged ...
}
```

## Private Fields Added to Router

| Field                      | Type                         | Lifetime  | Purpose                                                                        |
| -------------------------- | ---------------------------- | --------- | ------------------------------------------------------------------------------ |
| `_options`                 | `ResolvedGuardRouterOptions` | Permanent | Normalized router options (all fields required)                                |
| `_pendingGuardDescriptors` | `GuardDescriptor[]`          | Transient | Parsed manifest guard declarations; consumed and cleared during `initialize()` |

No `_guardsBypassedHash` field is needed. Both `"bypass"` mode and `skipGuards: true` use the existing committing/preflight phase, which produces `NavigationOutcome.Committed` — the guards were not involved, but the navigation committed normally.

## Execution Order

Within a single navigation pipeline:

1. Leave guards (current route) — registration order
2. Global enter guards (`"*"`) — registration order
3. Route-specific enter guards — registration order

Manifest guards are registered during `initialize()`, before `super.initialize()` triggers the first navigation. In `"lazy"` mode this happens synchronously; in `"block"` mode it happens once all modules have loaded. Manifest guards therefore run after imperative guards registered before `router.initialize()` (for example in `Component.init()`), and before imperative guards registered after it (for example in controller `onInit` hooks, which run after the root view is created by `super.initialize()`). In `"block"` mode, imperative guards added after `initialize()` but before the modules finish loading also run before the manifest guards.

## Guard Loading Strategies

### `"block"`

Router delays `super.initialize()` until all manifest guard modules are resolved via `sap.ui.require`. The first navigation only fires after all guards are in place. Adds startup latency proportional to module loading time, but guarantees no unguarded navigation for manifest-declared guards.

### `"lazy"` (default)

The default strategy. Router fires a **preload hint** in the constructor for all guard module paths, then calls `super.initialize()` synchronously — there is no async gap during initialization. Guards are registered as lazy wrapper functions that resolve their module on first invocation.

**Pattern 5 — Preload + Lazy wrappers:**

```typescript
// Constructor: fire-and-forget preload (cache warming)
const uniquePaths = [...new Set(descriptors.map((d) => d.modulePath))];
// Purely a hint: a failed load is reported when the guard runs.
sap.ui.require(uniquePaths, undefined, () => {});

// initialize(): synchronous, always
this._registerLazyGuards(descriptors);
return super.initialize();
```

The preload is a cache-warming optimization. Because guard modules are small and the preload fires early in the constructor, they are almost certainly cached by the time the first navigation occurs. On a cache hit the lazy wrapper resolves synchronously; on a miss it loads async exactly as before.

Bare-path multi-guard entries (no `#` suffix) need shape detection to know how many guards to register. On a cache hit at `initialize()` they are expanded into individual guards. On a cache miss, one wrapper takes their place: it loads the module on first navigation and runs all of its guards in order, so none of them is skipped on that navigation. Cherry-picked entries use individual lazy wrappers and require no expansion.

Key properties:

- **No guards are skipped** — every guard is always evaluated, even on the first navigation.
- **`initialize()` is always synchronous** — no async gap, no destroy race during init.
- **First navigation** to a guarded route resolves from the preload cache (synchronous) in the common case. On a cache miss the guard returns a Promise while its module loads, so that navigation is async from this guard on, including all later guards.
- **All subsequent navigations** resolve synchronously: cherry-picked wrappers read the `sap.ui.require` cache, and a bare-path wrapper keeps the guards it loaded.
- **A guard that throws** during the async first load fails the navigation (`error`), like any other throwing guard.
- **True lazy loading** — if a route is never visited its guard modules produce no additional overhead beyond the preload hint.

## Testing Scope

### Router options (adapted from PR #46 to state machine)

- Constructor reads `guardRouter` from config, strips before parent
- Manifest-driven instantiation via UIComponent
- Malformed/invalid config warns and falls back to defaults
- `unknownRouteRegistration`: all three policies
- `unknownRouteRegistration: "throw"` on a manifest guard: logged and skipped in `"lazy"` and `"block"` mode, other manifest guards still apply
- `navToPreflight`: all three modes with correct settlement outcomes
- `skipGuards` per-call override in both navTo overload positions
- `"off"` mode defers to parse fallback, including async guard behavior

### Declarative guard registration (issue #41)

- Guards block parsed from manifest and registered via existing API
- `"*"` registers global guards, route names register enter/leave
- `"*"` with object form warns and treats `enter` as global guards
- Shorthand array form equivalent to `{ "enter": [...] }`
- Module paths resolved relative to component namespace (dot-to-slash)
- Component namespace obtained from owner's `sap.app.id`; without an owner, relative paths are used as-is (no namespace prefix)
- `guardLoading: "block"` delays initialize until modules load
- `guardLoading: "lazy"` (default) registers lazy wrappers with preload hint; first navigation resolves from cache (sync) or loads async on miss; subsequent navigations sync from cache
- Default `guardLoading` is `"lazy"` — no explicit config needed
- Invalid module paths warn and skip gracefully
- Manifest guards execute before imperative guards registered after `initialize()`
- Multiple guards per route execute in array order

### Multi-guard modules

- Module exports array → all functions registered in index order, named `"moduleName#0"`, `"moduleName#1"`
- Module exports plain object → all functions registered in key insertion order, named by key
- Module exports function → single guard registered, named by module path's last segment
- Non-function entries in array/object → warned and skipped individually
- Empty array or object export → warning logged, no guards registered

### Cherry-pick syntax

- `"guards.security#checkAuth"` → only the `checkAuth` export registered
- `"guards.checks#1"` → only the export at index 1 registered
- `"guards.auth#anything"` on a single-function module → `#` ignored, debug warning logged
- Invalid cherry-pick key (nonexistent or non-function) → warning, guard skipped
- `"module:lib.guards#key"` → `module:` prefix and `#` compose correctly
- `"*"` key with cherry-pick: `"*": ["guards.logging#verbose"]` → valid

### Pattern 5 loading

- Preload hint fires in constructor for all guard module paths in lazy mode; block mode starts loading in `initialize()` (both asserted through the resource timing of a fixture module that nothing else loads)
- `initialize()` is always synchronous in lazy mode
- Guard available sync on first navigation when preload has completed (cache hit)
- Guard loads async on first navigation when preload has not completed (cache miss)
- Bare-path multi-guard modules expanded at `initialize()` time from cache; cherry-picked entries use lazy wrappers
- Bare-path multi-guard module that misses the cache runs all of its guards in order on the first navigation, stops at the first block, and stops when the navigation is superseded
- Module that fails to load warns and settles the navigation as `error`
- Guard that throws during the async first load settles the navigation as `error`
- Bare-path module loaded on a cache miss runs synchronously on later navigations

### Named guard logging

Manifest guards are named after their module, and the name appears when the guard throws:
`Enter guard [1] "checks#1" on route "admin" threw, navigation failed`.

- Function export: the module's last path segment (`guards.auth` → `auth`); with `#key`, the key
- Array export: `moduleName#index` (`checks#0`, `checks#1`), also when cherry-picked
- Object export: the key (`checkAuth`); cherry-picked by index, the key at that index
- A lazy wrapper whose module missed the cache is named after the module (or `module#key`) until it loads, then after the guard it resolved to. A bare-path module with several guards keeps the module name, because one wrapper runs them all.

Guards registered with `addGuard()` and the other imperative methods have no name; their logs show phase and index only.

### Edge cases

- Same module used from multiple routes: loaded once, guards registered per-route independently
- Duplicate references (`"guards.security"` and `"guards.security#checkAuth"` in same route): each occurrence registers independently — `checkAuth` runs twice
- Execution order with multi-guard modules: bare path inserts all guards at the module's position in manifest array; cherry-picks respect their individual positions

### Guard context bag

- Fresh `Map` per pipeline run
- Shared across leave → enter guards in same pipeline
- Not carried across navigations

### Test fixtures needed

- Stub guard modules (default-exporting `GuardFn` / `LeaveGuardFn`)
- Test Component with manifest declaring guards
- Guard modules not pre-loaded (for lazy wrapper tests verifying async-then-sync behavior)

## Risks and Mitigations

| Risk                                                          | Mitigation                                                                                                                                                                                                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guard modules with closures can't access component state      | Document: manifest guards are standalone; use `context.ownerComponent` (since 1.7.0) for component state and `context.bag` for inter-guard data                                                                                                    |
| Guard ordering is implicit (array order)                      | Document clearly; test array-order execution                                                                                                                                                                                                       |
| Module paths are strings with no compile-time validation      | Graceful runtime warnings on invalid paths; future: UI5 linter rule                                                                                                                                                                                |
| Manifest + imperative guards coexist                          | Well-defined order: registration order within each phase (see [Execution Order](#execution-order))                                                                                                                                                 |
| `guardLoading: "lazy"` may make first navigation async        | Preload hint in constructor makes cache hit the common case. On cache miss behavior is identical to previous lazy mode. Document that guard modules should be kept small for best results.                                                         |
| `navToPreflight: "off"` inherits parse() fallback limitations | Document that `"off"` is unsuitable for apps relying on `navigationSettled()` after `navTo()` with async guards. Combining `"off"` with `guardLoading: "lazy"` compounds the latency since the first guard evaluation also loads the module async. |
| `bag` on `GuardContext` is a breaking type change             | Minor semver bump; existing guard functions are unaffected, only code constructing `GuardContext` literals needs updating                                                                                                                          |

## Out of Scope

- Build-time manifest validation of guard module paths (future linter rule)
- Component metadata-based guard registration (alternative to manifest; separate feature)
- Guard hot module replacement (works naturally via `sap.ui.require` reference semantics)
