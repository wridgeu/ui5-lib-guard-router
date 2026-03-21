# Declarative Manifest-Based Guard Configuration

**Date**: 2026-03-21
**Status**: Proposed
**Closes**: #41, #31
**Supersedes**: PR #46 (`feat/router-options-manifest-config`)

## Overview

Combine two related features into one cohesive manifest-first configuration system for the guard router:

1. **Router options** (from PR #46): `unknownRouteGuardRegistration`, `navToPreflight`, `skipGuards`
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
					"unknownRouteGuardRegistration": "warn",
					"navToPreflight": "guard",
					"guardLoading": "block",
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

| Option                          | Values                              | Default   | Description                                                      |
| ------------------------------- | ----------------------------------- | --------- | ---------------------------------------------------------------- |
| `unknownRouteGuardRegistration` | `"ignore"` \| `"warn"` \| `"throw"` | `"warn"`  | Behavior when registering guards for unknown route names         |
| `navToPreflight`                | `"guard"` \| `"bypass"` \| `"off"`  | `"guard"` | How programmatic `navTo()` interacts with the guard pipeline     |
| `guardLoading`                  | `"block"` \| `"lazy"`               | `"block"` | How manifest-declared guard modules are loaded at initialization |

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
- Each module must export a **default function** matching `GuardFn` or `LeaveGuardFn`.
- Array order defines execution order within a route.
- Manifest guards run **before** imperatively registered guards (see [Execution Order](#execution-order) for caveats).

### Guard Module Format

```typescript
// webapp/guards/authGuard.ts
// Module path: demo/app/guards/authGuard
import type { GuardContext, GuardResult } from "ui5/guard/router/types";

export default function authGuard(context: GuardContext): GuardResult {
	// Standalone function — no closure over component state.
	// For shared state, use context.meta or a service/singleton pattern.
	const user = context.meta.get("user");
	return user ? true : "login";
}
```

### Module Caching

`sap.ui.require` caches modules globally. Once a guard module is loaded (by either loading strategy), subsequent calls to `sap.ui.require("module/path")` return the cached export synchronously. There is no re-loading overhead for repeated guard evaluations.

## Guard Context `meta` Bag

A shared mutable `Map<string, unknown>` on `GuardContext` for inter-guard data passing:

- Created fresh per pipeline run in `_evaluateGuards()`.
- Shared across all guards in the same pipeline (leave → global enter → route enter).
- The router never reads from or writes to it — it is purely a carrier.
- Scoped to a single navigation attempt; garbage collected when the pipeline finishes.

**Breaking change note**: `meta` is added as a required field on `GuardContext`. Existing guard functions that receive `GuardContext` are unaffected (they simply don't read `meta`). However, any application or test code that constructs a `GuardContext` literal will need to include `meta: new Map()`. This is a minor semver breaking change to the public type.

```typescript
// Guard A stores data
context.meta.set("user", await fetchUser(context.signal));

// Guard B reads data (runs after Guard A in array order)
const user = context.meta.get("user");
```

## Constructor and Initialization Flow

In TypeScript native classes, `super()` must be called before accessing `this`. The constructor handles this by preparing the cleaned config inline:

```
Constructor(routes, config, owner, ...)
  ├── Destructure guardRouter from config inline
  ├── Call super(routes, cleanedConfig, owner, ...) with guardRouter removed
  ├── Validate & normalize options via normalizeGuardRouterOptions()
  │   (unknownRouteGuardRegistration, navToPreflight, guardLoading)
  ├── Parse guards block → store as _pendingGuardDescriptors
  └── Store _options

initialize()
  ├── If guardLoading === "block" and pending guards exist:
  │     Load all guard modules via sap.ui.require (async, Promise-wrapped)
  │     → Register resolved functions via addGuard / addRouteGuard / addLeaveGuard
  │     → Then call super.initialize()
  ├── If guardLoading === "lazy" and pending guards exist:
  │     Register lazy wrapper functions for each guard module
  │     → Each wrapper tries sync sap.ui.require(path) first (cache hit)
  │     → On cache miss, loads async via sap.ui.require([path], cb)
  │     → After first load, all subsequent calls resolve synchronously
  │     Call super.initialize() immediately
  └── If no guards declared:
        Call super.initialize() directly
```

The `initialize()` override delays the first `parse()` call (triggered by the HashChanger listener) until guards are loaded (`"block"`) or registers lazy wrappers that load on-demand (`"lazy"`). This is safe because `initialize()` is the entry point for hash listening.

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

type UnknownRouteGuardRegistrationPolicy = "ignore" | "warn" | "throw";
type NavToPreflightMode = "guard" | "bypass" | "off";
type GuardLoading = "block" | "lazy";

interface GuardRouterOptions {
	unknownRouteGuardRegistration?: UnknownRouteGuardRegistrationPolicy;
	navToPreflight?: NavToPreflightMode;
	guardLoading?: GuardLoading;
	guards?: ManifestGuardConfig;
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
	meta: Map<string, unknown>; // NEW — breaking change to public type
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

### `"block"` (default)

Router delays `super.initialize()` until all manifest guard modules are resolved via `sap.ui.require`. The first navigation only fires after all guards are in place. Adds startup latency proportional to module loading time, but guarantees no unguarded navigation for manifest-declared guards.

### `"lazy"`

Router registers **lazy wrapper functions** for each manifest guard, then calls `super.initialize()` immediately. No modules are pre-loaded. Each wrapper leverages `sap.ui.require`'s two calling forms:

```typescript
// Conceptual implementation of a lazy guard wrapper
function createLazyGuard(modulePath: string): GuardFn {
	return (context: GuardContext) => {
		// Try sync resolution (cache hit after first load)
		const cached = sap.ui.require(modulePath);
		if (cached) {
			return cached(context); // sync — no Promise
		}
		// First use: load async, then execute
		return new Promise((resolve, reject) => {
			sap.ui.require([modulePath], (fn) => resolve(fn(context)), reject);
		});
	};
}
```

Key properties:

- **No guards are skipped** — every guard is always evaluated, even on the first navigation.
- **First navigation** to a guarded route loads the module async (returns a Promise; the existing async guard pipeline handles this naturally).
- **All subsequent navigations** use the `sap.ui.require` cache and resolve synchronously — no Promise overhead.
- **True lazy loading** — modules are only loaded when their route is actually navigated to. If a route is never visited, its guard modules are never loaded.

## Testing Scope

### Router options (adapted from PR #46 to state machine)

- Constructor reads `guardRouter` from config, strips before parent
- Manifest-driven instantiation via UIComponent
- Malformed/invalid config warns and falls back to defaults
- `unknownRouteGuardRegistration`: all three policies
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
- `guardLoading: "lazy"` registers lazy wrappers, first navigation loads async, subsequent sync from cache
- Invalid module paths warn and skip gracefully
- Manifest guards execute before imperatively registered guards
- Multiple guards per route execute in array order

### Guard context meta bag

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
| Guard modules with closures can't access component state      | Document: manifest guards are standalone; use `context.meta` or services for shared state; imperative registration for component-bound guards                                                                                                      |
| Guard ordering is implicit (array order)                      | Document clearly; test array-order execution                                                                                                                                                                                                       |
| Module paths are strings with no compile-time validation      | Graceful runtime warnings on invalid paths; future: UI5 linter rule                                                                                                                                                                                |
| Manifest + imperative guards coexist                          | Well-defined order: manifest first, imperative second                                                                                                                                                                                              |
| `guardLoading: "lazy"` makes first navigation async           | Acceptable trade-off; subsequent navigations are sync from cache. Document that the first visit to a guarded route may be slightly slower.                                                                                                         |
| `navToPreflight: "off"` inherits parse() fallback limitations | Document that `"off"` is unsuitable for apps relying on `navigationSettled()` after `navTo()` with async guards. Combining `"off"` with `guardLoading: "lazy"` compounds the latency since the first guard evaluation also loads the module async. |
| `meta` on `GuardContext` is a breaking type change            | Minor semver bump; existing guard functions are unaffected, only code constructing `GuardContext` literals needs updating                                                                                                                          |

## Out of Scope

- Build-time manifest validation of guard module paths (future linter rule)
- Component metadata-based guard registration (alternative to manifest; separate feature)
- Guard hot module replacement (works naturally via `sap.ui.require` reference semantics)
