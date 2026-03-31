# ui5-lib-guard-router

Drop-in replacement for `sap.m.routing.Router` that intercepts navigation **before** route matching, target loading, or view creation, preventing flashes of unauthorized content and polluted browser history.

> Born from [SAP/openui5#3411](https://github.com/SAP/openui5/issues/3411), an open request for native navigation guard support in UI5.
>
> **Related resources**:
>
> - [Stack Overflow: Preventing router from navigating](https://stackoverflow.com/questions/29165700/preventing-router-from-navigating/29167292#29167292) (native NavContainer `navigate` event, sync-only, fires after route match)
> - [Research: Native NavContainer navigate event](../../docs/research/native-router-navigate-event.md) (detailed comparison with this library)

> [!WARNING]
> This library is **experimental**. It is not battle-tested in production environments, and the API may change without notice. If you choose to consume it, you do so at your own risk. Make sure to pin your version and review changes before upgrading.

> [!CAUTION]
> Navigation guards are a UX layer, not a security boundary. They can prevent unauthorized content flashes and steer client-side navigation, but they do **not** replace server-side authorization, backend validation, or service-level access control.

## Why

UI5's router has no way to block or redirect navigation before views render. The usual workaround, scattering guard logic across `attachPatternMatched` callbacks, causes flashes of unauthorized content, polluted browser history, and scattered guard logic across controllers.

This library solves all three by intercepting at the router level, before any route matching begins.

## Install

```bash
npm install ui5-lib-guard-router
```

> [!NOTE]
> The npm package is ~190 KB compressed (~810 KB unpacked) because it ships both pre-built distributables (`dist/`) and TypeScript sources (`src/`) to support multiple [serving options](#serving-the-library). At runtime, the browser loads only the `library-preload.js` bundle (~29 KB).

### TypeScript

Add the library to `compilerOptions.types` so TypeScript can resolve the type declarations. If your app does not already depend on UI5 typings, install them too (`@sapui5/types` works as well):

```bash
npm install -D @openui5/types
```

Add both packages to `compilerOptions.types`:

```json
{
	"compilerOptions": {
		"types": ["@openui5/types", "ui5-lib-guard-router"]
	}
}
```

Then import types from the UI5 module path as needed:

```typescript
// Core: router interface and guard function signatures
import type { GuardRouter, GuardFn, LeaveGuardFn } from "ui5/guard/router/types";

// Guard pipeline: context passed to guards, and the result union they return
import type { GuardContext, GuardResult } from "ui5/guard/router/types";

// Settlement: outcome of a navigation after the guard pipeline finishes
import type { NavigationResult } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";

// Advanced: object form for redirect-with-parameters and enter+leave registration
import type { GuardRedirect, RouteGuardConfig } from "ui5/guard/router/types";
```

### Serving the library

The npm package ships both pre-built distributables (`dist/`) and TypeScript sources (`src/`). There are three ways to serve the library in your app:

#### Option A: Pre-built (recommended)

The package includes a [UI5 build manifest](https://github.com/SAP/ui5-tooling/blob/main/rfcs/0006-local-dependency-resolution.md) (`dist/.ui5/build-manifest.json`). UI5 Tooling v4+ detects it automatically and serves the pre-built JavaScript from `dist/` with no extra configuration:

```bash
npm install ui5-lib-guard-router
# That's it. `ui5 serve` picks up the build manifest.
```

No transpile tooling, no middleware, no additional `ui5.yaml` changes.

#### Option B: Transpile from source

If you prefer to serve from TypeScript sources (e.g. for debugging with source maps), install [`ui5-tooling-transpile`](https://github.com/ui5-community/ui5-ecosystem-showcase/tree/main/packages/ui5-tooling-transpile) and enable `transpileDependencies` in your app's `ui5.yaml`:

```bash
npm install -D ui5-tooling-transpile
```

```yaml
# ui5.yaml
server:
    customMiddleware:
        - name: ui5-tooling-transpile-middleware
          afterMiddleware: compression
          configuration:
              transpileDependencies: true
```

This transpiles the library's `.ts` sources on the fly during `ui5 serve`.

#### Option C: Static serving (workaround)

If neither option works for your setup, you can mount the pre-built resources manually using [`ui5-middleware-servestatic`](https://github.com/ui5-community/ui5-ecosystem-showcase/tree/main/packages/ui5-middleware-servestatic) (or a similar community middleware) and point it at the `dist/resources` folder in `node_modules`:

```bash
npm install -D ui5-middleware-servestatic
```

```yaml
# ui5.yaml
server:
    customMiddleware:
        - name: ui5-middleware-servestatic
          afterMiddleware: compression
          configuration:
              rootPath: node_modules/ui5-lib-guard-router/dist/resources
```

## Setup

**1. Add the library dependency and set the router class in your `manifest.json`:**

```json
{
	"sap.ui5": {
		"dependencies": {
			"libs": {
				"ui5.guard.router": {}
			}
		},
		"routing": {
			"config": {
				"routerClass": "ui5.guard.router.Router"
			}
		}
	}
}
```

All existing routes, targets, and navigation calls continue to work unchanged.

**2. Register guards in your Component:**

```typescript
import UIComponent from "sap/ui/core/UIComponent";
import type { GuardRouter } from "ui5/guard/router/types";

export default class Component extends UIComponent {
	static metadata = {
		manifest: "json",
		interfaces: ["sap.ui.core.IAsyncContentCreation"],
	};

	init(): void {
		super.init();
		const router = this.getRouter() as GuardRouter;

		// Route-specific guard: redirect when not logged in
		router.addRouteGuard("protected", (context) => {
			return isLoggedIn() ? true : "home";
		});

		// Global guard: runs for every navigation
		router.addGuard((context) => {
			if (context.toRoute === "admin" && !isAdmin()) {
				return "home";
			}
			return true;
		});

		router.initialize();
	}
}
```

## How it works

The library extends [`sap.m.routing.Router`](https://sdk.openui5.org/api/sap.m.routing.Router) and intercepts navigation through two entry points:

- **`navTo()` preflight**: For programmatic navigation (`router.navTo()`), guards run _before_ any hash change occurs. If a guard blocks or redirects, the hash never changes, so no history entry is created.
- **`parse()` fallback**: For browser-initiated navigation (back/forward buttons, URL bar entry, direct hash changes), guards run inside the `parse()` override after the browser has already changed the hash. If a guard blocks or redirects, the router restores the previous hash via `replaceHash()`.

Both entry points feed the same guard pipeline. There is no separate configuration. The same guard functions registered via `addGuard()`, `addRouteGuard()`, and `addLeaveGuard()` protect all navigation paths.

Because it extends the mobile router directly, all existing `sap.m.routing.Router` behavior (Targets, route events, `navTo`, back navigation) works unchanged.

The guard pipeline stays **synchronous when all guards return plain values** and only becomes async when a guard returns a Promise. A generation counter discards stale async results when navigations overlap, and an `AbortSignal` is passed to each guard so async work (like `fetch`) can be cancelled early.

## API

All guard registration and removal methods return `this` for chaining. `navigationSettled()` returns a `Promise<NavigationResult>`.

### Guard registration

| Method                                                     | Description                                    |
| ---------------------------------------------------------- | ---------------------------------------------- |
| `addGuard(fn)`                                             | Global enter guard (runs for every navigation) |
| `addRouteGuard(routeName, fn)`                             | Enter guard for a specific route               |
| `addRouteGuard(routeName, { beforeEnter?, beforeLeave? })` | Enter and/or leave guards via object form      |
| `addLeaveGuard(routeName, fn)`                             | Leave guard (runs when leaving the route)      |

### Guard removal

| Method                                                        | Description                                      |
| ------------------------------------------------------------- | ------------------------------------------------ |
| `removeGuard(fn)`                                             | Remove a global enter guard                      |
| `removeRouteGuard(routeName, fn)`                             | Remove an enter guard                            |
| `removeRouteGuard(routeName, { beforeEnter?, beforeLeave? })` | Remove enter and/or leave guards via object form |
| `removeLeaveGuard(routeName, fn)`                             | Remove a leave guard                             |

### Route metadata

| Method                          | Description                                                           |
| ------------------------------- | --------------------------------------------------------------------- |
| `getRouteMeta(routeName)`       | Get resolved metadata (manifest defaults merged with runtime)         |
| `setRouteMeta(routeName, meta)` | Set runtime metadata for a route (replaces previous runtime metadata) |

### Unknown routes during registration

`addRouteGuard()` and `addLeaveGuard()` warn when the route name is unknown at registration time, but they still register the guard. This is intentional so applications can attach guards before dynamic `addRoute()` calls or before route definitions are finalized.

### GuardContext

Every guard receives a `GuardContext` object:

| Property      | Type                                               | Description                                                             |
| ------------- | -------------------------------------------------- | ----------------------------------------------------------------------- |
| `toRoute`     | `string`                                           | Target route name (empty if no match)                                   |
| `toHash`      | `string`                                           | Raw hash being navigated to                                             |
| `toArguments` | `Record<string, string \| Record<string, string>>` | Parsed route parameters                                                 |
| `fromRoute`   | `string`                                           | Current route name (empty on first navigation)                          |
| `fromHash`    | `string`                                           | Current hash                                                            |
| `signal`      | `AbortSignal`                                      | Aborted when navigation is superseded, or on `stop()`/`destroy()`       |
| `bag`         | `Map<string, unknown>`                             | Shared mutable store for inter-guard data passing within one navigation |
| `toMeta`      | `Readonly<Record<string, unknown>>`                | Resolved metadata for the target route (manifest + runtime, frozen)     |
| `fromMeta`    | `Readonly<Record<string, unknown>>`                | Resolved metadata for the current route (manifest + runtime, frozen)    |

### Return values (`GuardResult`)

Enter guards return `GuardResult`, covering four behaviors:

```
GuardResult = boolean | string | GuardRedirect
```

| Return                                         | Type            | When to use                                             | Effect                                                                                                                                                       |
| ---------------------------------------------- | --------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `true`                                         | `boolean`       | Guard condition passes                                  | Allow navigation                                                                                                                                             |
| `false`                                        | `boolean`       | Guard condition fails, no specific destination          | Stay on current route. Programmatic `navTo()` creates no history entry. Browser-initiated navigation restores the previous hash.                             |
| `"routeName"`                                  | `string`        | Redirect to a fixed route (no parameters needed)        | Navigate to target route. Programmatic `navTo()` goes directly to target with no intermediate entry. Browser-initiated navigation replaces the current hash. |
| `{ route, parameters?, componentTargetInfo? }` | `GuardRedirect` | Redirect and pass route parameters or component targets | Same as string redirect, with parameters                                                                                                                     |

`GuardRedirect` is the object form of a redirect. Use it when you need to pass route parameters (`parameters`) or nested component targets (`componentTargetInfo`). For simple redirects without parameters, the string shorthand (`return "home"`) is equivalent and shorter.

Any other value (`null`, `undefined`, `0`, etc.) is treated as a block. Only strict `true` allows navigation; there is no truthy coercion.

On first load, blocking a non-empty hash restores `""` and continues with the app's default route. Blocking the default route itself stays blocked. If you need a specific denied-first-load destination such as `login`, return a redirect instead of `false`.

**Leave guards** (`addLeaveGuard`) return `boolean` only:

| Return                            | Effect                          |
| --------------------------------- | ------------------------------- |
| `true`                            | Allow leaving the current route |
| `false` (or any non-`true` value) | Block                           |

Leave guards answer "can I leave?" and cannot redirect. For redirection logic, use enter guards on the target route.

### Lifecycle

| Method      | Behavior                                                                                                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stop()`    | Cancels pending async guards (aborts the `AbortSignal`), resets guard state. A subsequent `initialize()` re-parses the current hash and fires `routeMatched`, matching native router behavior |
| `destroy()` | Clears all registered guards (global, enter, leave), cancels pending async guards, then calls `super.destroy()`                                                                               |

### Navigation settlement

`navigationSettled()` returns a Promise that resolves when the guard pipeline finishes. The returned `NavigationResult` contains the outcome as a `NavigationOutcome` enum value, the route name, and the hash determined by the guard pipeline.

```typescript
import type { NavigationResult } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";

const result: NavigationResult = await router.navigationSettled();
```

| `result.status`                | Meaning                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `NavigationOutcome.Committed`  | Guards allowed the navigation; target route is active                                                   |
| `NavigationOutcome.Bypassed`   | Guards allowed the navigation, but no route matched; UI5 continued with `bypassed` / not-found handling |
| `NavigationOutcome.Blocked`    | A guard blocked navigation; previous route stays active                                                 |
| `NavigationOutcome.Redirected` | A guard redirected navigation to a different route                                                      |
| `NavigationOutcome.Cancelled`  | Navigation was cancelled before settling (superseded, stopped, or destroyed)                            |
| `NavigationOutcome.Error`      | A guard threw or rejected; previous route stays active. `result.error` holds the thrown value           |

A guard redirect that fails to trigger a follow-up navigation settles as `Blocked` because no route change commits. A nonexistent route name is the most common cause, and the router logs the target name to help diagnose it.

An accepted unmatched hash settles as `Bypassed` with `route === ""` and the attempted hash preserved in `hash`. Idle `navigationSettled()` calls replay that `Bypassed` result until another navigation settles, matching the existing replay behavior for the other outcomes.

If no navigation is in flight, `navigationSettled()` resolves immediately with the most recent settlement result. That makes it safe to call right after `navTo()`, even when guards settle synchronously. On a fresh router, this defaults to `Committed` with the instance's current route/hash state. After `stop()`, those fields are reset, so idle calls resolve with empty strings until the next navigation settles. Multiple callers waiting on the same pending navigation all receive the same result.

**App code: busy indicator during async guards**

```typescript
router.addRouteGuard("dashboard", async (context) => {
	app.setBusy(true);
	try {
		const res = await fetch(`/api/access/${context.toRoute}`, { signal: context.signal });
		return (await res.json()).allowed ? true : "home";
	} finally {
		app.setBusy(false);
	}
});

// Show a global busy while the guard pipeline runs
router.navTo("dashboard");
const result = await router.navigationSettled();
switch (result.status) {
	case NavigationOutcome.Committed:
		break; // navigation succeeded
	case NavigationOutcome.Bypassed:
		MessageToast.show("No route matched; showing not-found flow");
		break;
	case NavigationOutcome.Blocked:
		MessageToast.show("Access denied");
		break;
	case NavigationOutcome.Redirected:
		MessageToast.show(`Redirected to ${result.route}`);
		break;
	case NavigationOutcome.Error:
		MessageBox.error("Navigation failed: " + String(result.error));
		break;
	case NavigationOutcome.Cancelled:
		break; // superseded by a newer navigation
}
```

**Test code: wait for guards deterministically**

```typescript
router.navTo("protected");
const result = await router.navigationSettled();
assert.strictEqual(result.status, NavigationOutcome.Blocked, "Navigation was blocked");
assert.strictEqual(result.route, "home", "User stays on home");
```

**Event-based: observe every navigation outcome**

`attachNavigationSettled` fires synchronously after every guard pipeline settlement. Unlike the one-shot `navigationSettled()` Promise, the event fires for every navigation without re-registration:

```typescript
router.attachNavigationSettled((event) => {
	const status = event.getParameter("status"); // NavigationOutcome
	const route = event.getParameter("route");
	const hash = event.getParameter("hash");
	console.log(`Navigation settled: ${status} on ${route}`);
});
```

Use `detachNavigationSettled(fnFunction, oListener)` to remove the listener. The same function and listener references must match those passed to `attachNavigationSettled`. The event uses UI5's native `EventProvider` mechanism, so the standard `attachEvent` / `detachEvent` pattern also works.

### Error handling

When a guard throws or its Promise rejects, the navigation settles as `Error` with `result.error` containing the thrown value. The previous route stays active. `Error` indicates an unexpected failure, as opposed to `Blocked` which signals intentional denial.

### Execution order

1. **Leave guards** for the current route (registration order)
2. **Global enter guards** (registration order)
3. **Route-specific enter guards** for the target (registration order)
4. Pipeline **short-circuits** at the first non-`true` result

Each phase short-circuits on the first non-`true` result. If a leave guard blocks, no enter guards run. If a global guard redirects, route-specific guards are skipped.

## Manifest Configuration

Guards can be declared directly in `manifest.json` using the `guardRouter` block inside `sap.ui5.routing.config`. This eliminates boilerplate in `Component.ts` for common guard patterns.

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
					"inheritance": "none",
					"guards": {
						"*": ["guards.authGuard"],
						"admin": {
							"enter": ["guards.adminGuard"],
							"leave": ["guards.unsavedChangesGuard"]
						}
					},
					"routeMeta": {
						"admin": { "requiresAuth": true, "roles": ["admin"] },
						"profile": { "requiresAuth": true }
					}
				}
			}
		}
	}
}
```

### Router options

| Option                     | Values                              | Default   | Description                                                                                                                                                                                                                                                           |
| -------------------------- | ----------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unknownRouteRegistration` | `"ignore"` \| `"warn"` \| `"throw"` | `"warn"`  | Policy for guard and metadata registration against unknown route names                                                                                                                                                                                                |
| `navToPreflight`           | `"guard"` \| `"bypass"` \| `"off"`  | `"guard"` | Whether `navTo()` calls run through the guard pipeline (`"guard"`), skip guards (`"bypass"`), or the preflight is disabled entirely (`"off"`)                                                                                                                         |
| `guardLoading`             | `"block"` \| `"lazy"`               | `"lazy"`  | `"lazy"`: registers lazy wrappers, loads modules on first navigation; a preload hint fires in the constructor to warm the cache; `initialize()` is always synchronous. `"block"`: loads all modules before `initialize()` completes; `initialize()` is async.         |
| `inheritance`              | `"none"` \| `"pattern-tree"`        | `"none"`  | `"none"`: guards and metadata apply only to their declared route. `"pattern-tree"`: guards propagate to all routes whose URL pattern extends the declared route's pattern; metadata propagates via shallow merge (child values override ancestor values on conflict). |

The `guardRouter` block also accepts `guards` (see [Declarative guards](#declarative-guards)) and `routeMeta` (see [Route metadata](#route-metadata)).

### Declarative guards

The `guards` map wires guard modules to routes without writing code in `Component.ts`.

**Global guards** run on every navigation and are declared under the `"*"` key:

```json
"guards": {
	"*": ["guards.authGuard"]
}
```

**Per-route guards** use the route name as the key. The shorthand array form registers enter guards only:

```json
"guards": {
	"admin": ["guards.adminGuard"]
}
```

The full object form with `enter` and `leave` keys registers both enter and leave guards:

```json
"guards": {
	"admin": {
		"enter": ["guards.adminGuard"],
		"leave": ["guards.unsavedChangesGuard"]
	}
}
```

**Module paths** use dot notation and are resolved relative to `sap.app.id`. Given `sap.app.id = "com.example.app"`, the path `"guards.authGuard"` resolves to `"com/example/app/guards/authGuard"`.

To use an absolute module path, prefix it with `"module:"`:

```json
"*": ["module:com/shared/guards/authGuard"]
```

### Complete example

manifest.json:

```json
{
	"sap.ui5": {
		"routing": {
			"config": {
				"routerClass": "ui5.guard.router.Router",
				"guardRouter": {
					"guards": {
						"*": ["guards.authGuard"],
						"admin": { "enter": ["guards.roleGuard"], "leave": ["guards.unsavedGuard"] }
					}
				}
			}
		}
	}
}
```

guards/authGuard.ts:

```typescript
import type { GuardContext, GuardResult } from "ui5/guard/router/types";

export default function authGuard(context: GuardContext): GuardResult {
	if (!isAuthenticated()) return "login";
	return true;
}
```

The router loads `guards.authGuard` relative to `sap.app.id`. For `sap.app.id = "com.example.app"`, this resolves to `com/example/app/guards/authGuard`.

### Guard module format

Each entry in the guard array is a module whose default export is one of three shapes:

**Shape 1: Function (single guard)**

```typescript
// guards/auth.ts
import type { GuardContext, GuardResult } from "ui5/guard/router/types";

export default function authGuard(context: GuardContext): GuardResult {
	return isAuthenticated() ? true : "login";
}
```

**Shape 2: Array (ordered guards)**

```typescript
// guards/checks.ts (registered as "checks#0", "checks#1")
import type { GuardContext, GuardResult } from "ui5/guard/router/types";

export default [
	function checkAuth(context: GuardContext): GuardResult {
		return true;
	},
	function checkRole(context: GuardContext): GuardResult {
		return false;
	},
];
```

**Shape 3: Plain Object (named guards)**

```typescript
// guards/security.ts (registered as "checkAuth", "checkRole")
import type { GuardContext, GuardResult } from "ui5/guard/router/types";

export default {
	checkAuth(context: GuardContext): GuardResult {
		/* ... */ return true;
	},
	checkRole(context: GuardContext): GuardResult {
		/* ... */ return false;
	},
};
```

Detection: function produces a single guard, `Array` produces ordered guards, and a plain object produces named guards in key order. Non-function entries in arrays and objects are warned and skipped. Empty arrays and objects are warned and produce no guards.

> [!NOTE]
> When a module path appears in a `"leave"` array, the exported function acts as a `LeaveGuardFn` and must return `boolean`. Returning a string or `GuardRedirect` from a leave guard is not an error, but any non-`true` value is treated as a block. Redirects from leave guards are not supported. Use enter guards for redirection.

### Cherry-pick syntax

When a module exports multiple guards, you can register a subset using `#` to select by name or index:

```json
{
	"guards": {
		"admin": ["guards.security#checkAuth", "guards.security#checkRole"],
		"dashboard": ["guards.security"],
		"settings": ["guards.checks#1"],
		"*": ["guards.logging"]
	}
}
```

| Syntax                               | Behavior                                      |
| ------------------------------------ | --------------------------------------------- |
| `"guards.security"`                  | Register all exports (key/array order)        |
| `"guards.security#checkAuth"`        | Register only that named export               |
| `"guards.security#1"`                | Register by index (array or object key order) |
| `"module:some.lib.guards#checkAuth"` | `module:` prefix composes with `#`            |

When `#` is used on a single-function module, the export key is ignored with a debug message and the function is still registered.

### Guard context `bag`

Guards can share data through `context.bag`, a `Map<string, unknown>` that is created fresh for each navigation and shared across all guards in that navigation, including across redirect chain hops:

```typescript
export default function firstGuard(context: GuardContext): GuardResult {
	context.bag.set("userId", getCurrentUserId());
	return true;
}

export default function secondGuard(context: GuardContext): GuardResult {
	const userId = context.bag.get("userId") as string | undefined;
	if (!userId) return "login";
	return true;
}
```

The bag is typed as `Map<string, unknown>`, so consumers cast on `.get()`. This matches how UI5 handles untyped model data (`getProperty()` returns `any`) and avoids generic complexity that can't flow through UI5's class system.

This is useful for avoiding repeated work (such as fetching the current user) when multiple guards need the same data in a single navigation.

### Route metadata

Per-route metadata can be declared in the manifest under `guardRouter.routeMeta`. Keys are route names, values are arbitrary objects. The router stores but never interprets the metadata. Guards read it from `context.toMeta` and `context.fromMeta`.

```json
"guardRouter": {
	"routeMeta": {
		"admin": { "requiresAuth": true, "roles": ["admin"] },
		"profile": { "requiresAuth": true },
		"home": { "public": true }
	}
}
```

A single global guard can then implement policy-driven access control:

```typescript
router.addGuard((context) => {
	if (context.toMeta.requiresAuth && !isLoggedIn()) return "login";
	if (context.toMeta.roles && !hasAnyRole(context.toMeta.roles as string[])) return "forbidden";
	return true;
});
```

Runtime metadata can be set programmatically via `setRouteMeta()`. When read via `getRouteMeta()`, runtime values take precedence over manifest defaults:

```typescript
router.setRouteMeta("betaFeature", { enabled: featureToggle.isActive("beta") });
```

`getRouteMeta()` returns a frozen object with manifest defaults merged with runtime overrides. When `inheritance: "pattern-tree"` is enabled, the result also includes metadata inherited from ancestor routes (see [Guard and metadata inheritance](#guard-and-metadata-inheritance)). For unconfigured routes, it returns an empty frozen object.

### `skipGuards` option

Pass `{ skipGuards: true }` as the fourth argument to `navTo()` to bypass all guards for a single call. Use this for internal redirects or navigations that should not be subject to guard logic:

```typescript
router.navTo("settings", {}, false, { skipGuards: true });
```

### Guard and metadata inheritance

When `inheritance` is set to `"pattern-tree"`, guards declared on a route automatically apply to all routes whose URL pattern extends that route's pattern:

```json
"guardRouter": {
	"inheritance": "pattern-tree",
	"guards": {
		"employees": ["guards.authGuard"]
	}
}
```

With routes `employees`, `employees/{id}`, and `employees/{id}/resume`, the auth guard runs for all three. Ancestor guards run before descendant guards.

With the same `inheritance: "pattern-tree"` setting, route metadata also propagates. Inheritance is determined by URL patterns. Assuming the route-to-pattern mapping `"employees"` -> `employees`, `"employee"` -> `employees/{id}`, `"employeeResume"` -> `employees/{id}/resume`:

```json
"guardRouter": {
	"inheritance": "pattern-tree",
	"routeMeta": {
		"employees": { "section": "hr", "requiresAuth": true },
		"employee": { "clearance": "manager" }
	}
}
```

`getRouteMeta("employeeResume")` returns `{ section: "hr", requiresAuth: true, clearance: "manager" }` (inherited from both `employees` and `employee`). `getRouteMeta("employee")` returns `{ section: "hr", requiresAuth: true, clearance: "manager" }` (merged, own values win).

Defaults to `"none"` for backward compatibility.

**Root-pattern route (`""`) is a universal ancestor.** A route with an empty pattern (typically "home") is considered an ancestor of every other route in the router. With `pattern-tree` inheritance enabled, metadata or guards declared on the root-pattern route propagate to all routes:

```json
"guardRouter": {
	"inheritance": "pattern-tree",
	"routeMeta": {
		"home": { "requiresAuth": true }
	}
}
```

Every route in the app inherits `requiresAuth: true` from "home" unless it declares its own override. This is useful for app-wide defaults but requires care. Setting `{ "requiresAuth": false }` on the root route with `pattern-tree` inheritance would make every route public unless explicitly overridden.

Metadata is resolved lazily on first access via `getRouteMeta()` and cached until `setRouteMeta()` or `addRoute()` invalidates the cache. Guard inheritance is resolved at `initialize()` time; routes added dynamically via `addRoute()` are integrated into the pattern tree on the fly (inherited guards are registered and the metadata cache is cleared).

Runtime metadata set via `setRouteMeta()` participates in inheritance. Child routes see updated ancestor metadata after cache invalidation.

### Mixing declarative and programmatic guards

Manifest guards and programmatic guards coexist on the same pipeline. Manifest guards are registered during `initialize()` (before the first navigation), and programmatic guards are added whenever `addGuard()` / `addRouteGuard()` / `addLeaveGuard()` is called.

**Execution order:** manifest guards run first (in declaration order), then programmatic guards (in registration order). For the same route, both sets execute. They are additive, not exclusive.

A common pattern is to declare static guards in the manifest and add context-dependent guards programmatically:

- **Manifest:** guards that don't need component state (simple blocks, redirects, logging)
- **Programmatic:** guards that close over models, services, or runtime state
- **Controller-level:** guards tied to a specific view's lifecycle (registered in `onInit`, removed in `onExit`)

## Examples

### Async guard with AbortSignal

```typescript
import type { GuardContext, GuardResult } from "ui5/guard/router/types";

router.addRouteGuard("dashboard", async (context: GuardContext): Promise<GuardResult> => {
	const res = await fetch(`/api/access/${context.toRoute}`, {
		signal: context.signal, // cancelled when a newer navigation supersedes this one
	});
	const { allowed } = await res.json();
	return allowed ? true : "forbidden";
});
```

### Redirect with parameters (GuardRedirect)

```typescript
import type { GuardRedirect } from "ui5/guard/router/types";

router.addGuard((context): GuardRedirect | true => {
	if (context.toRoute === "old-detail") {
		return {
			route: "detail",
			parameters: { id: context.toArguments.id },
		};
	}
	return true;
});
```

The demo app keeps `createRedirectWithParamsGuard()` as a reference implementation in `packages/demo-app/webapp/guards.ts`; the runnable demo routes do not use it because they have no route parameters.

### Guard factories

The demo app keeps reusable guard factories in `packages/demo-app/webapp/guards.ts`. `createDirtyFormGuard()` and `createAuthGuard()` are reference-only implementations showing the factory pattern; the runnable demo uses the manifest-declared `guards/dirtyFormGuard.ts` module for the `"protected"` leave guard and the async `createAsyncPermissionGuard()` for the `"protected"` enter guard.

```typescript
// guards.ts
import JSONModel from "sap/ui/model/json/JSONModel";
import type { GuardFn, LeaveGuardFn, GuardContext, GuardResult } from "ui5/guard/router/types";

export function createAuthGuard(authModel: JSONModel): GuardFn {
	return (context: GuardContext): GuardResult => {
		return authModel.getProperty("/isLoggedIn") ? true : "home";
	};
}

export function createDirtyFormGuard(formModel: JSONModel): LeaveGuardFn {
	return (context: GuardContext): boolean => {
		return !formModel.getProperty("/isDirty");
	};
}
```

### Object form with RouteGuardConfig

The object form is useful when registering both enter and leave guards for the same route in a single call:

```typescript
import type { RouteGuardConfig } from "ui5/guard/router/types";

const protectedGuards: RouteGuardConfig = {
	beforeEnter: createAsyncPermissionGuard(authModel),
	beforeLeave: createDirtyFormGuard(formModel),
};

router.addRouteGuard("protected", protectedGuards);
// later: router.removeRouteGuard("protected", protectedGuards);
```

### Dynamic guard registration

Guards can be added or removed at any point during the router's lifetime:

```typescript
const logGuard: GuardFn = (ctx) => {
	console.log(`Navigation: ${ctx.fromRoute} → ${ctx.toRoute}`);
	return true;
};

router.addGuard(logGuard);
// later...
router.removeGuard(logGuard);
```

### Leave guard with controller lifecycle

The demo app shows the same lifecycle pattern in `packages/demo-app/webapp/controller/Home.controller.ts`, registering `createHomeLeaveLogger()` on the `home` route and removing it again in `onExit()`.

```typescript
import type { GuardRouter, LeaveGuardFn } from "ui5/guard/router/types";
import BaseController from "./BaseController";
import { createHomeLeaveLogger } from "../guards";

export default class HomeController extends BaseController {
	private _leaveGuard: LeaveGuardFn | null = null;

	onInit(): void {
		const router = this.getRouter<GuardRouter>();
		this._leaveGuard = createHomeLeaveLogger();
		router.addLeaveGuard("home", this._leaveGuard);
	}

	onExit(): void {
		if (this._leaveGuard) {
			const router = this.getRouter<GuardRouter>();
			router.removeLeaveGuard("home", this._leaveGuard);
			this._leaveGuard = null;
		}
	}
}
```

> [!TIP]
> **User feedback on blocked navigation**: When a leave guard blocks, the router silently restores the previous hash. There is no built-in confirmation dialog. Show a `sap.m.MessageBox.confirm()` inside your leave guard (returning the user's choice as a `Promise<boolean>`) to make the block visible.

> [!NOTE]
> **Guard cleanup and lifecycle**
>
> **Component level**: The router's `destroy()` method automatically clears all registered guards when the component is destroyed (including during FLP navigation).
>
> **Controller level**: UI5's routing caches views indefinitely, so `onExit` is called only when the component is destroyed, not on every navigation away. Controller-registered guards therefore persist across in-app navigations. This is typically the desired behavior for route-specific guards tied to view state.
>
> In FLP apps with `sap-keep-alive` enabled, the component persists when navigating to other apps. Guards remain registered since the same instance is reused.

### Metadata-driven guards via manifest (legacy alternative)

> [!NOTE]
> The native `guardRouter.routeMeta` configuration (see [Route metadata](#route-metadata)) is the recommended way to declare per-route metadata. The custom-namespace approach below predates native support and is shown for historical reference only.

For common patterns like "this route requires authentication", you can store per-route metadata in a custom manifest section and use a single global guard instead of writing repetitive per-route guards:

```json
{
	"ui5.guard.router": {
		"routeMeta": {
			"admin": { "requiresAuth": true, "roles": ["admin"] },
			"profile": { "requiresAuth": true },
			"home": { "public": true }
		}
	}
}
```

```typescript
// Component.ts: read the custom section via getManifestEntry (typed path lookup)
type RouteMeta = Record<string, Record<string, unknown>>;
const routeMeta = (this.getManifestEntry("/ui5.guard.router/routeMeta") ?? {}) as RouteMeta;

router.addGuard((context) => {
	const meta = routeMeta[context.toRoute] ?? {};
	if (meta.requiresAuth && !authModel.getProperty("/isLoggedIn")) return "login";
	if (meta.roles && !hasAnyRole(meta.roles as string[])) return "forbidden";
	return true;
});
```

`getManifestEntry()` accepts a path string (starting with `/`) to reach into nested manifest sections. The return type is `any`, so the local `RouteMeta` alias provides type safety at the consumption site.

This keeps guard logic in one place and route annotations in the manifest where they're visible and auditable. The custom namespace `ui5.guard.router` is ignored by the UI5 framework. It is a convention for application data.

### Native alternative for leave guards: Fiori Launchpad data loss prevention

If your app runs inside SAP Fiori Launchpad (FLP), the shell provides built-in data loss protection through two public APIs on `sap.ushell.Container`:

**`setDirtyFlag(bDirty)`** (since 1.27.0): A simple boolean flag. When set to `true`, FLP shows a browser `confirm()` dialog when the user attempts cross-app navigation (home button, other tiles), browser back/forward out of the app, or page refresh/close:

```typescript
sap.ushell.Container.setDirtyFlag(true); // mark unsaved changes
sap.ushell.Container.setDirtyFlag(false); // clear after save
```

**`registerDirtyStateProvider(fn)`** (since 1.31.0): Registers a callback that FLP calls during navigation to dynamically determine dirty state. The callback receives a `NavigationContext` with `isCrossAppNavigation` (boolean) and `innerAppRoute` (string), allowing the provider to distinguish between cross-app and in-app navigation:

```typescript
const dirtyProvider = (navigationContext) => {
	if (navigationContext?.isCrossAppNavigation === false) {
		return false; // let in-app routing handle it
	}
	return formModel.getProperty("/isDirty") === true;
};
sap.ushell.Container.registerDirtyStateProvider(dirtyProvider);

// Clean up (since 1.67.0)
sap.ushell.Container.deregisterDirtyStateProvider(dirtyProvider);
```

> **Note**: `getDirtyFlag()` is deprecated since UI5 1.120. FLP internally uses `getDirtyFlagsAsync()` (private) which combines the flag with all registered providers. The synchronous `getDirtyFlag()` still works but should not be relied upon in new code.

#### Combining leave guards with FLP dirty-state protection

When you use both a route leave guard and `registerDirtyStateProvider`, the two handle separate scopes and do not need to coordinate in application code:

- **Leave guard** protects **in-app** navigation (route to route within your app)
- **Dirty-state provider** protects **cross-app** navigation (shell home, other tiles, browser close)

In production FLP, `ShellNavigationHashChanger` intercepts cross-app navigation **before** it reaches the app router, so the leave guard never runs for cross-app hashes. The two mechanisms never overlap:

```typescript
// 1. Leave guard: blocks in-app navigation when dirty
router.addRouteGuard("editOrder", {
	beforeLeave: () => formModel.getProperty("/isDirty") !== true,
});

// 2. Dirty-state provider: tells FLP about unsaved changes for cross-app
const dirtyProvider = (navigationContext) => {
	if (navigationContext?.isCrossAppNavigation === false) {
		return false; // in-app navigation handled by leave guard
	}
	return formModel.getProperty("/isDirty") === true;
};
sap.ushell.Container.registerDirtyStateProvider(dirtyProvider);
```

No `toRoute` check or FLP detection is needed in the leave guard. Cross-app navigation via `toExternal()` operates at the shell level in both production and the FLP sandbox, so the leave guard never runs for cross-app hashes. The leave guard protects in-app route changes; the FLP dirty-state provider protects cross-app navigation, browser close, and the shell home button.

> [!TIP]
> **Testing with the FLP preview**: The `fiori-tools-preview` middleware supports `enhancedHomePage: true` (UI5 >= 1.123.0), which uses CDM-based bootstrap for a more complete UShell service layer. This is recommended for testing dirty-state provider integration, as it provides `ShellNavigationHashChanger` and `CrossApplicationNavigation` behavior closer to production FLP.

See the [FLP Dirty State Research](../../docs/research/flp-dirty-state.md) for a detailed analysis of the FLP internals.

## Redirect chains

When a guard redirects navigation from route A to route B, the router evaluates route B's guards before committing. If route B also redirects, the chain continues. Leave guards are skipped on redirect hops (they only run on the first navigation), but global and route-specific enter guards run on every hop.

```
User navigates to "dashboard"
  → dashboard guard checks permissions, returns "profile"
  → profile guard checks onboarding status ← this guard RUNS
  → onboarding guard allows → onboarding view renders
```

Two safeguards prevent infinite redirect loops:

- **Visited-set detection**: The router tracks every hash evaluated in the current chain. Revisiting a hash is treated as a loop and blocks the navigation.
- **Depth cap** (10 hops): Chains that exceed 10 redirect hops are blocked, even if every hash is unique. This guards against unbounded chains with parameterized routes.

Both safeguards log an error and settle the navigation as `Blocked`.

## Limitations

### History guarantees differ by navigation source

Programmatic `router.navTo()` calls get clean history: blocked or redirected navigations create no history entry. Browser back/forward and URL bar entry may leave an extra history entry because the browser changes the hash before guards can intercept. The guard still protects the route, but the browser history may contain a duplicate entry that the router repairs via `replaceHash()`.

### URL bar shows target hash during async guards (browser-initiated only)

For browser-initiated navigation (back/forward, URL bar entry, direct hash changes), the URL bar shows the target hash while an async guard resolves. If the guard blocks or redirects, the URL reverts via `replaceHash()`. There is a brief window where the displayed URL does not match the active route.

This does **not** apply to programmatic `navTo()` calls, where the hash does not change until guards approve. It also does not affect sync guards on the `parse()` path, which resolve in the same tick as the hash change.

**Why the parse() path cannot prevent this**: UI5's `HashChanger` updates the URL and fires `hashChanged` before `parse()` runs. The router cannot prevent the URL change; it can only react to it. Frameworks like Vue Router and Angular Router avoid this by controlling the URL update themselves (calling `history.pushState` only after guards resolve), but UI5's architecture does not allow this without intercepting at the HashChanger level, which is globally scoped and fragile.

```
Browser-initiated navigation (back/forward, URL bar, setHash):
  HashChanger updates browser URL    ← URL changes HERE
          ↓
  HashChanger fires hashChanged
          ↓
  Router.parse() called              ← guards run HERE
          ↓
     ┌────┴────┐
  allowed    blocked
     ↓          ↓
  views      _restoreHash()
  load       reverts URL

Programmatic navigation (navTo):
  navTo() called                     ← guards run HERE
          ↓
     ┌────┴────┐
  allowed    blocked
     ↓          ↓
  super.navTo()  return
  hash changes   (no hash change)
```

For the `parse()` path, show a busy indicator while async guards resolve. This communicates that navigation is in progress, making the URL bar state a non-issue:

```typescript
router.addRouteGuard("dashboard", async (context) => {
	const app = rootView.byId("app") as App;
	app.setBusy(true);
	try {
		const res = await fetch(`/api/access/${context.toRoute}`, {
			signal: context.signal,
		});
		const { allowed } = await res.json();
		return allowed ? true : "home";
	} finally {
		app.setBusy(false);
	}
});
```

This follows the same pattern as [TanStack Router's `pendingComponent`](https://tanstack.com/router/latest/docs/framework/react/guide/navigation-blocking#handling-blocked-navigations): the URL reflects the intent while a loading state signals that the navigation hasn't committed yet.

## Debugging and Troubleshooting

### Enabling guard logs

The router logs guard registration errors, pipeline decisions, and async discard events through UI5's `Log` API under the component name `ui5.guard.router.Router`.

Enable debug-level output programmatically:

```typescript
import Log from "sap/base/Log";
Log.setLevel(Log.Level.DEBUG, "ui5.guard.router.Router");
```

Or set the global log level via URL parameter (per-component filtering is only available through the programmatic API above):

```
?sap-ui-log-level=DEBUG
```

> **Note**: UI5 1.120+ uses kebab-case URL parameters (`sap-ui-log-level`). Older versions use camelCase (`sap-ui-logLevel`).

### Common issues

**Guards not running**: Verify the route name passed to `addRouteGuard()` matches the route name in `manifest.json`, not the pattern or target name. Guards on redirect targets do run; if a redirect chain is blocked by loop detection, check the error log for details. See [Redirect chains](#redirect-chains).

**Navigation blocked unexpectedly**: Only a strict `true` return value allows navigation. Returning `undefined`, `null`, or omitting a return statement blocks. Enable debug-level logging to identify which guard blocked.

**Redirect treated as blocked**: The redirect did not trigger a follow-up navigation. Most often the target route name is wrong, but a same-hash no-op can look similar. The router logs the target name so you can verify the route and parameters.

**Async guard hangs indefinitely**: `context.signal` only aborts on supersede or router stop/destroy, not on "too slow." If a guard's `fetch` targets a dead endpoint, the navigation stays in the evaluating phase forever. Combine `context.signal` with `AbortSignal.timeout()` to enforce a hard deadline: `signal: AbortSignal.any([context.signal, AbortSignal.timeout(10_000)])`. See the [async guard timeout pattern](../../docs/guides/integration-patterns.md#async-guard-timeout) for the full example and a compatibility fallback for older browsers.

**Async guard result discarded**: A newer navigation started before the async guard resolved. The router uses a generation counter to discard stale results. This is expected behavior during rapid sequential navigations. The debug log confirms when this occurs.

**URL bar shows target hash, then reverts**: This is expected for async guards. The `HashChanger` updates the URL before `parse()` runs. See [URL bar shows target hash during async guards](#url-bar-shows-target-hash-during-async-guards) for the architectural explanation and the busy-indicator pattern.

## Testing

### Running tests

The library ships three QUnit test suites that run in headless Chrome via WebdriverIO:

```bash
# All three suites (Router, NativeRouterCompat, UpstreamParity)
npm run test:qunit

# Full matrix including OpenUI5 1.120 compatibility lane and E2E
npm run test:full
```

### Accessing private members in tests

The router's internal state (phase model, guard registries, generation counter) uses TypeScript's `private` keyword for encapsulation. Tests inspect these internals via [`Reflect.get`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Reflect/get):

```typescript
const phase = Reflect.get(router, "_phase");
const generation = Reflect.get(router, "_parseGeneration");
```

This works because TypeScript `private` is a [compile-time-only constraint](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-8.html). The property exists as a regular enumerable property at runtime, so `Reflect.get` reads it without any cast or `as any`. The alternative -- ECMAScript `#private` fields -- enforces privacy at runtime via `WeakMap`-backed storage. Properties declared with `#` are invisible to `Reflect.get`, bracket notation, and any other external access. The trade-off:

|                                  | TypeScript `private`                | ECMAScript `#private`                                      |
| -------------------------------- | ----------------------------------- | ---------------------------------------------------------- |
| Enforcement                      | Compile-time only                   | Runtime (engine-level)                                     |
| `Reflect.get` access             | Works                               | Returns `undefined`                                        |
| Bracket notation (`obj["prop"]`) | Works                               | Returns `undefined`                                        |
| Test inspection                  | Straightforward                     | Requires dedicated accessors                               |
| UI5 compatibility                | Full (prototype-based class system) | Limited (UI5 metadata introspection cannot see `#` fields) |

This library uses TypeScript `private` because UI5's `ManagedObject.extend()` class system relies on prototype-based inheritance and runtime metadata introspection, which is incompatible with ECMAScript `#private` fields. `Reflect.get` is the established pattern across the test suite for inspecting internal state without type-safety escape hatches.

## Compatibility

> [!IMPORTANT]
> **Shipped UI5 baseline: 1.144.0**
>
> The published package declares `minUI5Version: 1.144.0`, and the full CI suite runs on that shipped baseline. In addition, CI runs the library QUnit suite against OpenUI5 `1.120.0` as a compatibility lane for the core router implementation. The compatibility baseline is 1.120 because `DataType.registerEnum` (used for the `NavigationOutcome` enum) requires that version. The shipped baseline also carries a vendored OpenUI5 router parity lane for inherited `sap.m.routing.Router` behavior when no guards are active.

If you maintain an app on an older UI5 stack and want to validate locally, run the dedicated compatibility check from the monorepo root:

```bash
npm run test:qunit:compat:120
```

The vendored parity tests run as part of the main QUnit suite:

```bash
npm run test:qunit
```

## License

[MIT](LICENSE)
