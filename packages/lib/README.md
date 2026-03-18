# ui5-lib-guard-router

Drop-in replacement for `sap.m.routing.Router` that intercepts navigation **before** route matching, target loading, or view creation, preventing flashes of unauthorized content and polluted browser history.

> Born from [SAP/openui5#3411](https://github.com/SAP/openui5/issues/3411), an open request since 2021 for native navigation guard support in UI5.
>
> **Related resources**:
>
> - [Stack Overflow: Preventing router from navigating](https://stackoverflow.com/questions/29165700/preventing-router-from-navigating/29167292#29167292) (native NavContainer `navigate` event, sync-only, fires after route match)
> - [Research: Native NavContainer navigate event](https://github.com/wridgeu/ui5-lib-guard-router/blob/main/docs/research/native-router-navigate-event.md) (detailed comparison with this library)

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

If you prefer to serve from TypeScript sources (e.g. for debugging with source maps), install [`ui5-tooling-transpile`](https://github.com/nicholasmackey/ui5-tooling-transpile) and enable `transpileDependencies` in your app's `ui5.yaml`:

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

If neither option works for your setup, you can mount the pre-built resources manually using [`ui5-middleware-servestatic`](https://github.com/nicholasmackey/ui5-middleware-servestatic) (or a similar community middleware) and point it at the `dist/resources` folder in `node_modules`:

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

The library extends [`sap.m.routing.Router`](https://sdk.openui5.org/api/sap.m.routing.Router) and overrides `parse()`, the single method through which all navigation flows (programmatic `navTo`, browser back/forward, direct URL changes). Guards run before any route matching, target loading, or view creation.

Because it extends the mobile router directly, all existing `sap.m.routing.Router` behavior (Targets, route events, `navTo`, back navigation) works unchanged.

The guard pipeline stays **synchronous when all guards return plain values** and only becomes async when a guard returns a Promise. A generation counter discards stale async results when navigations overlap, and an `AbortSignal` is passed to each guard so async work (like `fetch`) can be cancelled early.

## API

All methods return `this` for chaining.

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

### Unknown routes during registration

`addRouteGuard()` and `addLeaveGuard()` warn when the route name is unknown at registration time, but they still register the guard. This is intentional so applications can attach guards before dynamic `addRoute()` calls or before route definitions are finalized.

### GuardContext

Every guard receives a `GuardContext` object:

| Property      | Type                                               | Description                                                       |
| ------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| `toRoute`     | `string`                                           | Target route name (empty if no match)                             |
| `toHash`      | `string`                                           | Raw hash being navigated to                                       |
| `toArguments` | `Record<string, string \| Record<string, string>>` | Parsed route parameters                                           |
| `fromRoute`   | `string`                                           | Current route name (empty on first navigation)                    |
| `fromHash`    | `string`                                           | Current hash                                                      |
| `signal`      | `AbortSignal`                                      | Aborted when navigation is superseded, or on `stop()`/`destroy()` |

### Return values (`GuardResult`)

Enter guards return `GuardResult`, a union of four outcomes:

```
GuardResult = boolean | string | GuardRedirect
```

| Return                                         | Type            | When to use                                             | Effect                                          |
| ---------------------------------------------- | --------------- | ------------------------------------------------------- | ----------------------------------------------- |
| `true`                                         | `boolean`       | Guard condition passes                                  | Allow navigation                                |
| `false`                                        | `boolean`       | Guard condition fails, no specific destination          | Block (stay on current route, no history entry) |
| `"routeName"`                                  | `string`        | Redirect to a fixed route (no parameters needed)        | Redirect to named route (replaces history)      |
| `{ route, parameters?, componentTargetInfo? }` | `GuardRedirect` | Redirect and pass route parameters or component targets | Redirect with parameters (replaces history)     |

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
| `NavigationOutcome.Committed`  | Guards allowed the navigation; target route is now active                                               |
| `NavigationOutcome.Bypassed`   | Guards allowed the navigation, but no route matched; UI5 continued with `bypassed` / not-found handling |
| `NavigationOutcome.Blocked`    | A guard blocked navigation; previous route stays active                                                 |
| `NavigationOutcome.Redirected` | A guard redirected navigation to a different route                                                      |
| `NavigationOutcome.Cancelled`  | Navigation was cancelled before settling (superseded, stopped, or destroyed)                            |

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

### Execution order

1. **Leave guards** for the current route (registration order)
2. **Global enter guards** (registration order)
3. **Route-specific enter guards** for the target (registration order)
4. Pipeline **short-circuits** at the first non-`true` result

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

The demo app keeps matching reusable guard factories in `packages/demo-app/webapp/guards.ts`, including `createAuthGuard()` and `createDirtyFormGuard()`.

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

The runnable demo uses the same object form in `packages/demo-app/webapp/Component.ts`, pairing an async permission check with a leave guard on the `protected` route.

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

See the [FLP Dirty State Research](https://github.com/wridgeu/ui5-lib-guard-router/blob/main/docs/research/flp-dirty-state.md) for a detailed analysis of the FLP internals.

## Limitations

### Redirect targets bypass guards

When a guard redirects navigation from route A to route B, route B's guards are **not** evaluated. The redirect commits immediately.

This matters when the redirect target has its own guards. For example:

```
User navigates to "dashboard"
  → dashboard guard checks permissions, returns "profile"
  → profile guard checks onboarding status ← this guard is SKIPPED
  → profile view renders
```

This is intentional. Evaluating guards on redirect targets introduces the risk of infinite loops (`A → B → A → B → ...`). While solvable with a visited-set that detects cycles, the implementation adds significant complexity. This is particularly true when redirect targets have **async** guards, since the redirect chain can no longer be bracketed in a single synchronous call stack. The chain state must then persist across async boundaries and be cleared only by terminal events (commit, block, or loop detection).

In practice, redirect targets are typically "safe" routes like `home` or `login` that don't have guards of their own. If you need guard logic on a redirect target, run the check inline before returning the redirect:

```typescript
router.addRouteGuard("dashboard", (context) => {
	if (!hasPermission()) {
		return isOnboarded() ? "profile" : "onboarding";
	}
	return true;
});
```

### URL bar shows target hash during async guards

When a guard returns a Promise (e.g., a `fetch` call to check permissions), the browser's URL bar shows the target hash while the guard is resolving. If the guard ultimately blocks or redirects, the URL reverts. However, there is a brief window where the displayed URL doesn't match the active route.

This does **not** affect sync guards, which resolve in the same tick as the hash change (the URL flicker is imperceptible).

**Why the router doesn't handle this**: UI5's `HashChanger` updates the URL and fires `hashChanged` _before_ `parse()` is called. The router cannot prevent the URL change; it can only react to it. Frameworks like Vue Router and Angular Router avoid this by controlling the URL update themselves (calling `history.pushState` only after guards resolve), but UI5's architecture doesn't allow this without intercepting at the HashChanger level, which is globally scoped and fragile.

```
User clicks link / navTo()
        ↓
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
```

Show a busy indicator while async guards resolve. This communicates to the user that navigation is in progress, making the URL bar state a non-issue:

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

### Log reference

| Level   | Message                                                                             | Trigger                                                                                             |
| ------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| warning | `addGuard called with invalid guard, ignoring`                                      | Non-function passed to `addGuard()`                                                                 |
| warning | `addRouteGuard called with invalid guard, ignoring`                                 | Non-function `beforeEnter`, `beforeLeave`, or direct guard                                          |
| info    | `addRouteGuard called with config missing both beforeEnter and beforeLeave`         | Empty `RouteGuardConfig` object (no handlers)                                                       |
| warning | `addLeaveGuard called with invalid guard, ignoring`                                 | Non-function passed to `addLeaveGuard()`                                                            |
| warning | `removeGuard called with invalid guard, ignoring`                                   | Non-function passed to `removeGuard()`                                                              |
| warning | `removeRouteGuard called with invalid guard, ignoring`                              | Non-function passed to `removeRouteGuard()`                                                         |
| warning | `removeLeaveGuard called with invalid guard, ignoring`                              | Non-function passed to `removeLeaveGuard()`                                                         |
| warning | `{method} called for unknown route; guard will still register...`                   | Route name not found at registration time                                                           |
| warning | `Guard returned invalid value, treating as block`                                   | Enter guard returned something other than `true`, `false`, a non-empty string, or a `GuardRedirect` |
| warning | `Leave guard returned non-boolean value, treating as block`                         | Leave guard returned something other than `true` or `false`                                         |
| warning | `Guard redirect target "{route}" did not produce a navigation, treating as blocked` | Redirect target did not trigger a follow-up navigation (most commonly an unknown route name)        |
| error   | `Async enter guard for route "{route}" failed, blocking navigation`                 | Async enter guard Promise rejected                                                                  |
| error   | `Async leave guard on route "{route}" failed, blocking navigation`                  | Async leave guard Promise rejected                                                                  |
| error   | `Enter guard [{n}] for/on route "{route}" threw, blocking navigation`               | Sync or async enter guard threw an exception                                                        |
| error   | `Leave guard [{n}] on route "{route}" threw, blocking navigation`                   | Sync or async leave guard threw an exception                                                        |
| debug   | `Async enter guard result discarded (superseded by newer navigation)`               | A newer `parse()` call invalidated the pending async result                                         |
| debug   | `Async leave guard result discarded (superseded by newer navigation)`               | A newer `parse()` call invalidated the pending async result                                         |

### Common issues

**Guards not running**: Verify the route name passed to `addRouteGuard()` matches the route name in `manifest.json`, not the pattern or target name. If the guard is on a redirect target, it does not run -- see [Redirect targets bypass guards](#redirect-targets-bypass-guards).

**Navigation blocked unexpectedly**: Only a strict `true` return value allows navigation. Returning `undefined`, `null`, or omitting a return statement blocks. Enable debug-level logging to identify which guard blocked.

**Redirect treated as blocked**: The redirect did not trigger a follow-up navigation. Most often the target route name is wrong, but a same-hash no-op can look similar. The router logs the target name so you can verify the route and parameters.

**Async guard result discarded**: A newer navigation started before the async guard resolved. The router uses a generation counter to discard stale results. This is expected behavior during rapid sequential navigations. The debug log confirms when this occurs.

**URL bar shows target hash, then reverts**: This is expected for async guards. The `HashChanger` updates the URL before `parse()` runs. See [URL bar shows target hash during async guards](#url-bar-shows-target-hash-during-async-guards) for the architectural explanation and the busy-indicator pattern.

## Compatibility

> [!IMPORTANT]
> **Shipped UI5 baseline: 1.144.0**
>
> The published package declares `minUI5Version: 1.144.0`, and the full CI suite runs on that shipped baseline. In addition, CI runs the library QUnit suite against OpenUI5 `1.120.0` as a compatibility lane for the core router implementation. The compatibility baseline is 1.120 because `DataType.registerEnum` (used for the `NavigationOutcome` enum) requires that version. That extra lane does not change the published manifest baseline, but it provides a concrete verification signal for consumers evaluating older runtimes.

If you maintain an app on an older UI5 stack and want to validate locally, run the dedicated compatibility check from the monorepo root:

```bash
npm run test:qunit:compat:120
```

## License

[MIT](LICENSE)
