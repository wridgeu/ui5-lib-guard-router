# ui5-lib-guard-router

Drop-in replacement for `sap.m.routing.Router` that intercepts navigation **before** route matching, target loading, or view creation, preventing flashes of unauthorized content and polluted browser history.

> Born from [SAP/openui5#3411](https://github.com/SAP/openui5/issues/3411), an open request since 2021 for native navigation guard support in UI5.
>
> **Related resources**:
>
> - [Stack Overflow: Preventing router from navigating](https://stackoverflow.com/questions/29165700/preventing-router-from-navigating/29167292#29167292) (native NavContainer `navigate` event, sync-only, fires after route match)
> - [Research: Native NavContainer navigate event](../../docs/research-native-router-navigate-event.md) (detailed comparison with this library)

> [!WARNING]
> This library is **experimental**. It is not battle-tested in production environments, and the API may change without notice. If you choose to consume it, you do so at your own risk. Make sure to pin your version and review changes before upgrading.

## Why

UI5's router has no way to block or redirect navigation before views render. The usual workaround, scattering guard logic across `attachPatternMatched` callbacks, causes flashes of unauthorized content, polluted browser history, and scattered guard logic across controllers.

This library solves all three by intercepting at the router level, before any route matching begins.

## Install

```bash
npm install ui5-lib-guard-router
```

If your app uses TypeScript and does not already depend on the UI5 typings, install them too (`@sapui5/types` works as well):

```bash
npm install -D @openui5/types
```

TypeScript types follow the UI5 module names. Add the package to `compilerOptions.types`:

```json
{
	"compilerOptions": {
		"types": ["@openui5/types", "ui5-lib-guard-router"]
	}
}
```

Then import the types from the UI5 module path:

```typescript
import type { GuardRouter, GuardFn, LeaveGuardFn, GuardContext, GuardResult } from "ui5/guard/router/types";
import type { GuardRedirect, RouteGuardConfig } from "ui5/guard/router/types";
```

UI5 runtime module names stay `ui5/guard/router/*`.

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

### Return values

**Enter guards** (`addGuard`, `addRouteGuard`):

| Return                                         | Effect                                          |
| ---------------------------------------------- | ----------------------------------------------- |
| `true`                                         | Allow navigation                                |
| `false`                                        | Block (stay on current route, no history entry) |
| `"routeName"`                                  | Redirect to named route (replaces history)      |
| `{ route, parameters?, componentTargetInfo? }` | Redirect with route parameters                  |
| anything else (`null`, `undefined`)            | Treated as block                                |

Only strict `true` allows navigation. There is no truthy coercion.

On first load, blocking a non-empty hash restores `""` and continues with the app's default route. Blocking the default route itself stays blocked. If you need a specific denied-first-load destination such as `login`, return a redirect instead of `false`.

**Leave guards** (`addLeaveGuard`):

| Return                            | Effect                          |
| --------------------------------- | ------------------------------- |
| `true`                            | Allow leaving the current route |
| `false` (or any non-`true` value) | Block                           |

Leave guards cannot redirect. For redirection logic, use enter guards on the target route.

### Lifecycle

| Method      | Behavior                                                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stop()`    | Cancels pending async guards (aborts the `AbortSignal`), resets internal flags, preserves route state so a subsequent `initialize()` avoids a redundant initial navigation |
| `destroy()` | Clears all registered guards (global, enter, leave), cancels pending async guards, then calls `super.destroy()`                                                            |

### Execution order

1. **Leave guards** for the current route (registration order)
2. **Global enter guards** (registration order)
3. **Route-specific enter guards** for the target (registration order)
4. Pipeline **short-circuits** at the first non-`true` result

## Examples

### Async guard with AbortSignal

```typescript
router.addRouteGuard("dashboard", async (context) => {
	const res = await fetch(`/api/access/${context.toRoute}`, {
		signal: context.signal,
	});
	const { allowed } = await res.json();
	return allowed ? true : "forbidden";
});
```

### Redirect with parameters

```typescript
router.addGuard((context) => {
	if (context.toRoute === "old-detail") {
		return {
			route: "detail",
			parameters: { id: context.toArguments.id },
		};
	}
	return true;
});
```

### Guard factories

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

### Object form (enter + leave)

```typescript
router.addRouteGuard("editOrder", {
	beforeEnter: createAuthGuard(authModel),
	beforeLeave: createDirtyFormGuard(formModel),
});
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

```typescript
import type { GuardRouter, LeaveGuardFn } from "ui5/guard/router/types";
import { createDirtyFormGuard } from "./guards";

export default class EditOrderController extends Controller {
	private _leaveGuard: LeaveGuardFn;

	onInit(): void {
		const formModel = new JSONModel({ isDirty: false });
		this.getView()!.setModel(formModel, "form");

		const router = UIComponent.getRouterFor(this) as GuardRouter;
		this._leaveGuard = createDirtyFormGuard(formModel);
		router.addLeaveGuard("editOrder", this._leaveGuard);
	}

	onExit(): void {
		const router = UIComponent.getRouterFor(this) as GuardRouter;
		router.removeLeaveGuard("editOrder", this._leaveGuard);
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

No `toRoute` check or FLP detection is needed in the leave guard. The leave guard protects in-app route changes; the FLP dirty-state provider protects cross-app navigation, browser close, and the shell home button. They never overlap in production.

> **FLP sandbox note**: The `fiori-tools-preview` sandbox used during local development has a simplified hash changer that passes cross-app hashes to the app router, unlike production FLP. This can cause a "double-block" where the user confirms in the FLP dialog but the leave guard also blocks. This is a sandbox limitation, not something application code should work around. See `docs/architecture.md` for details.

See the [FLP Dirty State Research](../../docs/research-flp-dirty-state.md) for a detailed analysis of the FLP internals.

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

## Compatibility

> [!IMPORTANT]
> **Shipped UI5 baseline: 1.144.0**
>
> The published package declares `minUI5Version: 1.144.0`, and the full CI suite runs on that shipped baseline. In addition, CI runs the library QUnit suite against OpenUI5 `1.118.0` as a compatibility lane for the core router implementation. That extra lane does not change the published manifest baseline yet, but it provides a concrete verification signal for consumers evaluating older runtimes.

If you maintain an app on an older UI5 stack and want to validate locally, run the dedicated compatibility check from the monorepo root:

```bash
npm run test:qunit:compat:118
```

## License

[MIT](LICENSE)
