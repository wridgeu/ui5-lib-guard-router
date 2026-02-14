# ui5-lib-guard-router

Drop-in replacement for `sap.m.routing.Router` that intercepts navigation **before** route matching, target loading, or view creation — preventing flashes of unauthorized content and polluted browser history.

> Born from [SAP/openui5#3411](https://github.com/SAP/openui5/issues/3411), an open request since 2021 for native navigation guard support in UI5.

> [!WARNING]
> This library is **experimental**. The API may change without notice. Pin your version and review changes before upgrading.

## Why

UI5's router has no way to block or redirect navigation before views render. The usual workaround — scattering guard logic across `attachPatternMatched` callbacks — causes flashes of unauthorized content, polluted browser history, and duplicated checks across controllers.

This library solves all three by intercepting at the router level, before any route matching begins.

## Install

```bash
npm install ui5-lib-guard-router
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
		const router = this.getRouter() as unknown as GuardRouter;

		// Route-specific guard — redirect when not logged in
		router.addRouteGuard("protected", (context) => {
			return isLoggedIn() ? true : "home";
		});

		// Global guard — runs for every navigation
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

The library extends `sap.m.routing.Router` and overrides `parse()`, the single method through which all navigation flows (programmatic `navTo`, browser back/forward, direct URL changes). Guards run before any route matching, target loading, or view creation.

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

| Property      | Type                                               | Description                                         |
| ------------- | -------------------------------------------------- | --------------------------------------------------- |
| `toRoute`     | `string`                                           | Target route name (empty if no match)               |
| `toHash`      | `string`                                           | Raw hash being navigated to                         |
| `toArguments` | `Record<string, string \| Record<string, string>>` | Parsed route parameters                             |
| `fromRoute`   | `string`                                           | Current route name (empty on first navigation)      |
| `fromHash`    | `string`                                           | Current hash                                        |
| `signal`      | `AbortSignal`                                      | Aborted when a newer navigation supersedes this one |

### Return values

**Enter guards** (`addGuard`, `addRouteGuard`):

| Return                                         | Effect                                          |
| ---------------------------------------------- | ----------------------------------------------- |
| `true`                                         | Allow navigation                                |
| `false`                                        | Block (stay on current route, no history entry) |
| `"routeName"`                                  | Redirect to named route (replaces history)      |
| `{ route, parameters?, componentTargetInfo? }` | Redirect with route parameters                  |
| anything else (`null`, `undefined`)            | Treated as block                                |

Only strict `true` allows navigation — no truthy coercion.

**Leave guards** (`addLeaveGuard`):

| Return                            | Effect                          |
| --------------------------------- | ------------------------------- |
| `true`                            | Allow leaving the current route |
| `false` (or any non-`true` value) | Block                           |

Leave guards cannot redirect. For redirection logic, use enter guards on the target route.

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

### Leave guard with controller lifecycle

```typescript
import type { GuardRouter, LeaveGuardFn } from "ui5/guard/router/types";
import { createDirtyFormGuard } from "./guards";

export default class EditOrderController extends Controller {
	private _leaveGuard: LeaveGuardFn;

	onInit(): void {
		const formModel = new JSONModel({ isDirty: false });
		this.getView()!.setModel(formModel, "form");

		const router = (this.getOwnerComponent() as UIComponent).getRouter() as unknown as GuardRouter;
		this._leaveGuard = createDirtyFormGuard(formModel);
		router.addLeaveGuard("editOrder", this._leaveGuard);
	}

	onExit(): void {
		const router = (this.getOwnerComponent() as UIComponent).getRouter() as unknown as GuardRouter;
		router.removeLeaveGuard("editOrder", this._leaveGuard);
	}
}
```

> **User feedback on blocked navigation**: When a leave guard blocks, the router silently restores the previous hash. There is no built-in confirmation dialog. Show a `sap.m.MessageBox.confirm()` inside your leave guard (returning the user's choice as a `Promise<boolean>`) to make the block visible.

> **Guard cleanup**: The router's `destroy()` method automatically clears all guards when the component is destroyed. Controller-registered guards persist across in-app navigations (since UI5 caches views), which is typically desired for route-specific guards tied to view state.

## Limitations

### Redirect targets bypass guards

When a guard redirects from route A to route B, route B's guards are **not** evaluated. This prevents infinite redirect loops. In practice, redirect targets are typically "safe" routes (`home`, `login`) without guards. If you need guard logic on a redirect target, run the check inline:

```typescript
router.addRouteGuard("dashboard", (context) => {
	if (!hasPermission()) {
		return isOnboarded() ? "profile" : "onboarding";
	}
	return true;
});
```

### URL bar flickers during async guards

When a guard returns a Promise, the browser's URL bar shows the target hash while the guard resolves. If it blocks or redirects, the URL reverts. This is a UI5 architecture constraint — `HashChanger` updates the URL before `parse()` is called. Sync guards are not affected.

Show a busy indicator while async guards resolve to communicate that navigation is in progress:

```typescript
router.addRouteGuard("dashboard", async (context) => {
	app.setBusy(true);
	try {
		const res = await fetch(`/api/access/${context.toRoute}`, { signal: context.signal });
		const { allowed } = await res.json();
		return allowed ? true : "home";
	} finally {
		app.setBusy(false);
	}
});
```

## Compatibility

- **Minimum UI5 version**: 1.118 (requires [`sap.ui.core.Lib`](https://sdk.openui5.org/api/sap.ui.core.Lib))
- **Router APIs**: depends on [`getRouteInfoByHash`](https://sdk.openui5.org/api/sap.ui.core.routing.Router%23methods/getRouteInfoByHash) (since 1.75)
- **Developed and tested against**: OpenUI5 1.144.0

## License

[MIT](https://github.com/wridgeu/ui5-lib-guard-router/blob/main/LICENSE)
