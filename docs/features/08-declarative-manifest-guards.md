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

| Option                     | Values                              | Default   | Description                                                      |
| -------------------------- | ----------------------------------- | --------- | ---------------------------------------------------------------- |
| `unknownRouteRegistration` | `"ignore"` \| `"warn"` \| `"throw"` | `"warn"`  | Behavior when registering guards for unknown route names         |
| `navToPreflight`           | `"guard"` \| `"bypass"` \| `"off"`  | `"guard"` | How programmatic `navTo()` interacts with the guard pipeline     |
| `guardLoading`             | `"block"` \| `"lazy"`               | `"lazy"`  | How manifest-declared guard modules are loaded at initialization |

### Guards Block

| Key           | Format                                     | Equivalent API                                   |
| ------------- | ------------------------------------------ | ------------------------------------------------ |
| `"*"`         | `string[]`                                 | `addGuard()` for each module                     |
| `"routeName"` | `string[]` (shorthand)                     | `addRouteGuard()` for each module (enter guards) |
| `"routeName"` | `{ "enter": string[], "leave": string[] }` | `addRouteGuard()` / `addLeaveGuard()`            |

- The `"*"` key only supports the `string[]` format (global leave guards do not exist in the API). Using the object form `{ "enter": [...] }` for `"*"` logs a warning and is treated as the array form.
- Route keys match route `name` values exactly as declared in the `routes` array.
- Module paths use **dot notation** and resolve **relative to the component namespace** (`sap.app.id`).
    - Example: In app `demo.app`, `"guards.authGuard"` resolves to `demo/app/guards/authGuard` for `sap.ui.require`.
    - `"authGuard"` (no folder) resolves to `demo/app/authGuard` — the component root.
    - The component namespace is obtained via `this.getOwnerComponent()?.getManifestEntry("sap.app")?.id` (the public UI5 API for accessing the owning component). If unavailable (e.g. standalone tests without a component), manifest guards are skipped with a warning.
    - Paths prefixed with `"module:"` bypass namespace resolution, following UI5's `sap.ui.core.routing.Target._getEffectiveObjectName()` convention. Example: `"module:some.other.lib.guard"` resolves to `some/other/lib/guard` directly.
- Each module's default export must be one of three shapes: a single function, an array of functions, or a plain object with function values (see [Guard Module Format](#guard-module-format)).
- A module entry may include a `#` cherry-pick suffix to select a single export: `"guards.security#checkAuth"` (see [Cherry-Pick Syntax](#cherry-pick-syntax)).
- Array order defines execution order within a route.
- Manifest guards run **before** imperatively registered guards (see [Execution Order](#execution-order) for caveats).

### Guard Module Format

A guard module's default export must be one of three shapes. The shape is detected at registration time.

**Shape 1: Function** — single guard; name derived from the last segment of the module path.

```typescript
// guards/authGuard.ts → guard name: "authGuard"
import type { GuardContext, GuardResult } from "ui5/guard/router/types";

export default function authGuard(context: GuardContext): GuardResult {
	// Standalone function — no closure over component state.
	// For shared state, use context.bag or a service/singleton pattern.
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
typeof export === "object"      → Shape 3
anything else                   → warning, module skipped
```

### Cherry-Pick Syntax

Append `#exportKey` to a module path to select a single export instead of registering all exports from the module.

| Syntax                        | Behavior                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `"guards.security"`           | Register **all** exports from module (key/array order)                                                     |
| `"guards.security#checkAuth"` | Register only the named export (object key)                                                                |
| `"guards.checks#1"`           | Register only the export at index 1 (array index, or position in object key order)                         |
| `"guards.auth#anything"`      | For single-function modules, `#` is ignored — the function is the only export. Logs a debug-level warning. |

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
  ├── Validate & normalize options via normalizeGuardRouterOptions()
  │   (unknownRouteRegistration, navToPreflight, guardLoading)
  ├── Parse guards block → store as _pendingGuardDescriptors
  ├── If guardLoading === "lazy" and pending guards exist:
  │     Fire preload hint: sap.ui.require(uniqueModulePaths) — no callback
  └── Store _options

initialize()
  ├── If guardLoading === "block" and pending guards exist:
  │     Load all guard modules via sap.ui.require (async, Promise-wrapped)
  │     → Register resolved functions via addGuard / addRouteGuard / addLeaveGuard
  │     → Then call super.initialize()
  ├── If guardLoading === "lazy" (default) and pending guards exist:
  │     Expand bare-path descriptors from cache (shape detection, may await single module if cache miss)
  │     Register lazy wrapper functions for cherry-picked descriptors
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

1. Leave guards (current route) — manifest-declared first, then imperative
2. Global enter guards (`"*"`) — manifest-declared first, then imperative
3. Route-specific enter guards — manifest-declared first, then imperative

"Manifest first" is achieved by registering manifest guards during `initialize()`, before `super.initialize()` triggers the first navigation. Since manifest guards are registered via `addGuard()` / `addRouteGuard()` / `addLeaveGuard()` before imperative guards, they appear earlier in the guard arrays.

**Important caveat**: This ordering guarantee applies to guards registered during `Component.init()` before `router.initialize()` is called. Guards registered in controller lifecycle hooks (`onInit`) fire after the root view is created by `super.initialize()`, so they are added after manifest guards regardless. This matches the existing timing of imperative registration — it is not a new limitation.

## Guard Loading Strategies

### `"block"`

Router delays `super.initialize()` until all manifest guard modules are resolved via `sap.ui.require`. The first navigation only fires after all guards are in place. Adds startup latency proportional to module loading time, but guarantees no unguarded navigation for manifest-declared guards.

### `"lazy"` (default)

The default strategy. Router fires a **preload hint** in the constructor for all guard module paths, then calls `super.initialize()` synchronously — there is no async gap during initialization. Guards are registered as lazy wrapper functions that resolve their module on first invocation.

**Pattern 5 — Preload + Lazy wrappers:**

```typescript
// Constructor: fire-and-forget preload (cache warming)
const uniquePaths = [...new Set(descriptors.map((d) => d.modulePath))];
sap.ui.require(uniquePaths); // no callback, no promise — purely a hint

// initialize(): synchronous, always
this._registerLazyGuards(descriptors);
return super.initialize();
```

The preload is a cache-warming optimization. Because guard modules are small and the preload fires early in the constructor, they are almost certainly cached by the time the first navigation occurs. On a cache hit the lazy wrapper resolves synchronously; on a miss it loads async exactly as before.

Bare-path multi-guard entries (no `#` suffix) need shape detection to know how many guards to register. These are expanded at `initialize()` time from the cache; cherry-picked entries use individual lazy wrappers and require no expansion.

Key properties:

- **No guards are skipped** — every guard is always evaluated, even on the first navigation.
- **`initialize()` is always synchronous** — no async gap, no destroy race during init.
- **First navigation** to a guarded route resolves from the preload cache (synchronous) in the common case; async load on cache miss.
- **All subsequent navigations** use the `sap.ui.require` cache and resolve synchronously — no Promise overhead.
- **True lazy loading** — if a route is never visited its guard modules produce no additional overhead beyond the preload hint.

## Testing Scope

### Router options (adapted from PR #46 to state machine)

- Constructor reads `guardRouter` from config, strips before parent
- Manifest-driven instantiation via UIComponent
- Malformed/invalid config warns and falls back to defaults
- `unknownRouteRegistration`: all three policies
- `navToPreflight`: all three modes with correct settlement outcomes
- `skipGuards` per-call override in both navTo overload positions
- `"off"` mode defers to parse fallback, including async guard behavior

### Declarative guard registration (issue #41)

- Guards block parsed from manifest and registered via existing API
- `"*"` registers global guards, route names register enter/leave
- `"*"` with object form warns and treats `enter` as global guards
- Shorthand array form equivalent to `{ "enter": [...] }`
- Module paths resolved relative to component namespace (dot-to-slash)
- Component namespace obtained from owner's `sap.app.id`; missing owner skips manifest guards with warning
- `guardLoading: "block"` delays initialize until modules load
- `guardLoading: "lazy"` (default) registers lazy wrappers with preload hint; first navigation resolves from cache (sync) or loads async on miss; subsequent navigations sync from cache
- Default `guardLoading` is `"lazy"` — no explicit config needed
- Invalid module paths warn and skip gracefully
- Manifest guards execute before imperatively registered guards
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

- Preload hint fires in constructor for all guard module paths
- `initialize()` is always synchronous in lazy mode
- Guard available sync on first navigation when preload has completed (cache hit)
- Guard loads async on first navigation when preload has not completed (cache miss)
- Bare-path multi-guard modules expanded at `initialize()` time from cache; cherry-picked entries use lazy wrappers

### Named guard logging

- Guard name appears in warning/error log output when a guard blocks navigation
- Object shape: key used as name; array shape: `moduleName#index`; function shape: module last segment

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
| Guard modules with closures can't access component state      | Document: manifest guards are standalone; use `context.bag` or services for shared state; imperative registration for component-bound guards                                                                                                       |
| Guard ordering is implicit (array order)                      | Document clearly; test array-order execution                                                                                                                                                                                                       |
| Module paths are strings with no compile-time validation      | Graceful runtime warnings on invalid paths; future: UI5 linter rule                                                                                                                                                                                |
| Manifest + imperative guards coexist                          | Well-defined order: manifest first, imperative second                                                                                                                                                                                              |
| `guardLoading: "lazy"` may make first navigation async        | Preload hint in constructor makes cache hit the common case. On cache miss behavior is identical to previous lazy mode. Document that guard modules should be kept small for best results.                                                         |
| `navToPreflight: "off"` inherits parse() fallback limitations | Document that `"off"` is unsuitable for apps relying on `navigationSettled()` after `navTo()` with async guards. Combining `"off"` with `guardLoading: "lazy"` compounds the latency since the first guard evaluation also loads the module async. |
| `bag` on `GuardContext` is a breaking type change             | Minor semver bump; existing guard functions are unaffected, only code constructing `GuardContext` literals needs updating                                                                                                                          |

## Out of Scope

- Build-time manifest validation of guard module paths (future linter rule)
- Component metadata-based guard registration (alternative to manifest; separate feature)
- Guard hot module replacement (works naturally via `sap.ui.require` reference semantics)
