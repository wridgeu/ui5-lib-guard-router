# Guard Integration Patterns

Guard patterns for `ui5.guard.router.Router`, with the guard type and the demo app file that implements each one.

## Pattern overview

| Pattern                                                                     | Guard type           | Sync / Async | Reference                                                            |
| --------------------------------------------------------------------------- | -------------------- | ------------ | -------------------------------------------------------------------- |
| [Authentication guard](#authentication-guard)                               | Route enter          | Sync         | inline example                                                       |
| [Redirect and resume](#redirect-and-resume)                                 | Global enter         | Sync         | inline example                                                       |
| [Async permission check](#async-permission-check-with-abortsignal)          | Route enter          | Async        | `guards.ts` -- `createAsyncPermissionGuard`                          |
| [Always block](#always-block)                                               | Route enter          | Sync         | `guards/blockedGuard.ts`                                             |
| [Always redirect](#always-redirect)                                         | Route enter          | Sync         | `guards/forbiddenGuard.ts`                                           |
| [Dirty form leave guard](#dirty-form-leave-guard)                           | Route leave          | Sync         | `guards/dirtyFormGuard.ts`                                           |
| [Redirect with parameters](#redirect-with-parameters)                       | Route enter          | Sync         | inline example                                                       |
| [Error handling](#error-handling-in-guards)                                 | Global / Route enter | Both         | inline example                                                       |
| [Guard factories](#guard-factories)                                         | Any                  | Any          | `guards.ts` -- the `create*` functions                               |
| [Controller-level lifecycle](#controller-level-guard-lifecycle)             | Route leave          | Sync         | `Home.controller.ts` -- `onInit` / `onExit`                          |
| [Object form (enter + leave)](#object-form-enter--leave)                    | Route enter + leave  | Any          | inline example                                                       |
| [Chained authorization](#chained-authorization-redirect-chain-guards)       | Route enter          | Both         | `guards.ts` -- `adminGuard`, `createAsyncPermissionGuard`            |
| [Async guard timeout](#async-guard-timeout)                                 | Route enter          | Async        | inline example                                                       |
| [Factory pattern for manifest guards](#factory-pattern-for-manifest-guards) | Any                  | Any          | inline example                                                       |
| [Nested route guard patterns](#nested-route-guard-patterns)                 | Global / Route enter | Any          | `webapp/reporting/` -- nested component with manifest guards         |
| [Settlement for UI feedback](#settlement-for-ui-feedback)                   | N/A                  | Async        | [Library README](../../packages/lib/README.md#navigation-settlement) |

The guard factories that the demo app registers are in [`packages/demo-app/webapp/guards.ts`](../../packages/demo-app/webapp/guards.ts). The controller lifecycle example references `Home.controller.ts`. The other factories are written out in their sections, where `LOG_COMPONENT` is the log component of the app.

## Authentication guard

Synchronous boolean check against an auth model. Returns `true` to allow or a route name string to redirect.

```typescript
router.addRouteGuard("protected", (context) => {
	return authModel.getProperty("/isLoggedIn") === true ? true : "home";
});
```

As a factory that takes the model (see [Guard factories](#guard-factories)); the demo app registers the async variant `createAsyncPermissionGuard` instead:

```typescript
export function createAuthGuard(authModel: JSONModel): GuardFn {
	return (context: GuardContext): GuardResult => {
		const isLoggedIn: unknown = authModel.getProperty("/isLoggedIn");
		if (isLoggedIn !== true) {
			Log.info(`Auth guard blocked navigation to "${context.toRoute}"`, "", LOG_COMPONENT);
			return "home";
		}
		return true;
	};
}
```

## Redirect and resume

A redirect to a login page loses the original destination. Store the target route and its arguments, then call `router.navTo()` after login.

```typescript
router.addGuard((context) => {
	if (!isLoggedIn() && context.toRoute !== "login") {
		authModel.setProperty("/pendingNavigation", {
			route: context.toRoute,
			arguments: context.toArguments,
		});
		return "login";
	}
	return true;
});
```

In the login controller:

```typescript
onLoginSuccess(): void {
	authModel.setProperty("/isLoggedIn", true);
	const pending = authModel.getProperty("/pendingNavigation") as
		| { route: string; arguments: Record<string, string | Record<string, string>> }
		| null;
	authModel.setProperty("/pendingNavigation", null);
	const router = this.getRouter() as GuardRouter;
	if (pending) {
		router.navTo(pending.route, pending.arguments);
	} else {
		router.navTo("home");
	}
}
```

Guards run again on the resumed navigation. The auth guard now passes.

An IdP redirect reloads the page, so model data is lost. Store the destination in `sessionStorage` instead, in one of two ways.

**Variant A: store route name and arguments, resume with `navTo()`**

```typescript
// In the guard, before redirecting to the IdP
sessionStorage.setItem(
	"returnTo",
	JSON.stringify({
		route: context.toRoute,
		arguments: context.toArguments,
	}),
);
```

```typescript
// After the IdP callback, in Component.init(), after router.initialize()
const raw = sessionStorage.getItem("returnTo");
if (raw) {
	sessionStorage.removeItem("returnTo");
	const pending = JSON.parse(raw) as {
		route: string;
		arguments: Record<string, string | Record<string, string>>;
	};
	router.navTo(pending.route, pending.arguments);
}
```

Guards run on the resumed navigation. `router.initialize()` has already processed the current hash, so this makes two navigations: one to the initial hash (usually the default route) and one to the stored destination. With sync guards the first route can flash briefly; with async guards the `navTo()` cancels the first navigation before anything is displayed.

**Variant B: store the hash, restore with `HashChanger` before the router starts**

```typescript
// In the guard, before redirecting to the IdP
sessionStorage.setItem("returnTo", context.toHash);
```

In `Component.init()`, before `router.initialize()`:

```typescript
import HashChanger from "sap/ui/core/routing/HashChanger";

const returnTo = sessionStorage.getItem("returnTo");
if (returnTo) {
	sessionStorage.removeItem("returnTo");
	HashChanger.getInstance().setHash(returnTo);
}
router.initialize(); // picks up the restored hash on first parse
```

This avoids the second navigation of Variant A: the router parses the restored hash first. `setHash()` adds a browser history entry.

## Async permission check with AbortSignal

Pass `context.signal` to `fetch()` so the request is cancelled when a newer navigation supersedes this one.

```typescript
router.addRouteGuard("dashboard", async (context) => {
	const res = await fetch(`/api/access/${context.toRoute}`, {
		signal: context.signal,
	});
	const { allowed } = await res.json();
	return allowed ? true : "home";
});
```

Wrap the `await` in a `try/catch` to handle `AbortError` separately from unexpected failures. When a guard Promise rejects, the router logs an error and settles the navigation as `NavigationOutcome.Error`. A rejection after the signal was aborted (the navigation was superseded) is not logged.

Reference: `createAsyncPermissionGuard` in `guards.ts`. The [busy indicator example](../../packages/lib/README.md#navigation-settlement) shows a busy indicator while guards run.

## Async guard timeout

If a guard's fetch hangs, the navigation never settles. `context.signal` aborts only on supersede, `stop()` or `destroy()`, not on a slow response. Combine it with `AbortSignal.timeout()` through `AbortSignal.any()`:

```typescript
router.addRouteGuard("dashboard", async (context) => {
	const res = await fetch("/api/check", {
		signal: AbortSignal.any([
			context.signal, // cancelled on supersede
			AbortSignal.timeout(10_000), // 10s hard timeout
		]),
	});
	return (await res.json()).allowed ? true : "home";
});
```

On timeout, `fetch` rejects with a `TimeoutError` and the navigation settles as `NavigationOutcome.Error`. Catch it to tell a timeout from a supersede, or to return a redirect instead.

> [!NOTE]
> `AbortSignal.any()` needs Chrome 116+, Firefox 124+ or Safari 17.4+. For older browsers, use an `AbortController` with `setTimeout`:
>
> ```typescript
> router.addRouteGuard("dashboard", async (context) => {
> 	const controller = new AbortController();
> 	const timer = setTimeout(() => controller.abort(), 10_000);
> 	context.signal.addEventListener("abort", () => controller.abort());
> 	try {
> 		const res = await fetch("/api/check", { signal: controller.signal });
> 		return (await res.json()).allowed ? true : "home";
> 	} finally {
> 		clearTimeout(timer);
> 	}
> });
> ```

## Always block

Return `false` to block. A blocked `navTo()` never changes the hash. A blocked browser navigation restores the previous hash.

```typescript
router.addRouteGuard("maintenance", () => false);
```

Reference: `guards/blockedGuard.ts` (a manifest guard module).

## Always redirect

Return a route name to redirect.

```typescript
router.addRouteGuard("old-page", () => "new-page");
```

Reference: `guards/forbiddenGuard.ts` (a manifest guard module).

The navigation settles on the route that matches the target's hash. With overlapping patterns, for example a renamed route whose old name is kept as an alias with the same pattern, that is the first matching route in manifest order, which can differ from the name the guard returned. The demo app shows this with its `team` and `staff` routes, see the [demo app README](../../packages/demo-app/README.md#overlapping-routes-team-and-staff).

## Dirty form leave guard

A leave guard returns a boolean only. It cannot redirect.

```typescript
router.addRouteGuard("editor", {
	beforeLeave: (context) => {
		return formModel.getProperty("/isDirty") !== true;
	},
});
```

To ask the user, return a Promise that resolves with the answer of `MessageBox.confirm`. The [library README](../../packages/lib/README.md#leave-guard-with-controller-lifecycle) shows how to make a blocked navigation visible.

As a factory that takes the form model; the demo app declares `guards/dirtyFormGuard.ts` in the manifest instead, which reads the model through `context.ownerComponent`:

```typescript
export function createDirtyFormGuard(formModel: JSONModel): LeaveGuardFn {
	return (context: GuardContext): boolean => {
		const isDirty: unknown = formModel.getProperty("/isDirty");
		if (isDirty === true) {
			Log.info(`Dirty form guard blocked leaving "${context.fromRoute}"`, "", LOG_COMPONENT);
			return false;
		}
		return true;
	};
}
```

The guard needs no bypass for the Fiori launchpad. Cross-app navigation happens at the shell level, so the leave guard never runs for cross-app hashes; the dirty-state provider registered with `registerDirtyStateProvider` covers those with the launchpad's own confirmation popup.

## Redirect with parameters

Return a `GuardRedirect` object to redirect with route parameters.

```typescript
router.addRouteGuard("old-detail", (context) => ({
	route: "detail",
	parameters: context.toArguments,
}));
```

As a factory for any target route; the demo app registers none, because none of its routes was renamed to a route with the same parameters:

```typescript
export function createRedirectWithParamsGuard(targetRoute: string): GuardFn {
	return (context: GuardContext): GuardResult => {
		Log.info(`Redirecting from "${context.toRoute}" to "${targetRoute}" with params`, "", LOG_COMPONENT);
		return {
			route: targetRoute,
			parameters: context.toArguments,
		};
	};
}

router.addRouteGuard("old-detail", createRedirectWithParamsGuard("detail"));
```

The returned object has the type `GuardRedirect`; add `componentTargetInfo` to the returned object to pass nested component targets.

## Error handling in guards

A guard that throws or rejects settles the navigation as `NavigationOutcome.Error`, not `NavigationOutcome.Blocked`, so the app can tell "access denied" from "something went wrong". The thrown value is on `result.error`.

Sync:

```typescript
router.addRouteGuard("risky", () => {
	throw new Error("something broke");
	// Navigation settles as Error. The router logs:
	// Enter guard [0] on route "risky" threw, navigation failed
	// A manifest guard is also named: Enter guard [0] "auth" on route "risky" threw, ...
});
```

Async:

```typescript
router.addRouteGuard("risky", async (context) => {
	const res = await fetch("/api/check", { signal: context.signal });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return true;
	// If fetch rejects, navigation settles as Error and the error is logged.
});
```

The app tells the two outcomes apart through `navigationSettled()`: [Navigation settlement](../../packages/lib/README.md#navigation-settlement) has the `switch` over all outcomes.

Guard errors are logged as errors, so they show at every log level. Debug logging adds each settled outcome and the discarded async results ([Debugging and Troubleshooting](../../packages/lib/README.md#debugging-and-troubleshooting)).

To try both outcomes, register guards that fail on demand. No scenario of the demo app settles as `Error`, so it registers neither:

```typescript
export function createErrorDemoGuard(errorModel: JSONModel): GuardFn {
	return (context: GuardContext): GuardResult => {
		if (errorModel.getProperty("/simulateError") === true) {
			throw new Error(`Simulated guard error for route "${context.toRoute}"`);
		}
		return true;
	};
}

export function createAsyncErrorDemoGuard(errorModel: JSONModel, delayMs = 50): GuardFn {
	return async (context: GuardContext): Promise<GuardResult> => {
		await new Promise((resolve) => setTimeout(resolve, delayMs));
		if (errorModel.getProperty("/simulateAsyncError") === true) {
			throw new Error(`Simulated async guard error for route "${context.toRoute}"`);
		}
		return true;
	};
}

const errorModel = new JSONModel({ simulateError: false, simulateAsyncError: false });
router.addGuard(createErrorDemoGuard(errorModel));
router.addRouteGuard("risky", createAsyncErrorDemoGuard(errorModel));
```

## Guard factories

When a guard depends on models, services or configuration, write a factory that takes them and returns the guard.

```typescript
function createRoleGuard(userModel: JSONModel, requiredRole: string): GuardFn {
	return () => {
		const roles = userModel.getProperty("/roles") as string[];
		return roles.includes(requiredRole) ? true : "forbidden";
	};
}

router.addRouteGuard("admin", createRoleGuard(userModel, "admin"));
router.addRouteGuard("reports", createRoleGuard(userModel, "analyst"));
```

The `create*` functions in `guards.ts` and in the sections above follow this pattern.

## Factory pattern for manifest guards

A manifest guard module exports a guard, not a factory. To reuse one guard with different parameters, export each configured guard from its own thin module:

```typescript
// guards/requireRole.ts: shared factory, not a guard module
import type { GuardFn } from "ui5/guard/router/types";

export function createRoleGuard(role: string): GuardFn {
	return () => {
		const roles = getUserRoles(); // app-level helper
		return roles.includes(role) ? true : "forbidden";
	};
}
```

```typescript
// guards/adminGuard.ts
import { createRoleGuard } from "./requireRole";
export default createRoleGuard("admin");
```

```typescript
// guards/analystGuard.ts
import { createRoleGuard } from "./requireRole";
export default createRoleGuard("analyst");
```

Declare the modules in the manifest:

```json
"guardRouter": {
	"guards": {
		"admin": ["guards.adminGuard"],
		"reports": ["guards.analystGuard"]
	}
}
```

## Controller-level guard lifecycle

Register a leave guard in `onInit` and remove it in `onExit`, keeping the function in a field so the same one is removed. The demo code and why views stay cached: [Leave guard with controller lifecycle](../../packages/lib/README.md#leave-guard-with-controller-lifecycle) in the library README.

## Object form (enter + leave)

Use `addRouteGuard` with a `{ beforeEnter, beforeLeave }` object to register both guards for the same route in a single call. `removeRouteGuard` accepts the same object form. The example uses the factories of [Authentication guard](#authentication-guard) and [Dirty form leave guard](#dirty-form-leave-guard).

```typescript
const guardConfig = {
	beforeEnter: createAuthGuard(authModel),
	beforeLeave: createDirtyFormGuard(formModel),
};

router.addRouteGuard("protected", guardConfig);

// Later:
router.removeRouteGuard("protected", guardConfig);
```

The demo app does not use the object form.

## Chained authorization (redirect chain guards)

When a guard redirects, the guards of the target route run too. Each route decides on its own whether to allow, block or redirect again.

```typescript
// Route "admin" requires admin role, redirects non-admins to "dashboard"
router.addRouteGuard("admin", () => {
	return userModel.getProperty("/isAdmin") ? true : "dashboard";
});

// Route "dashboard" requires onboarding, redirects to "onboarding"
router.addRouteGuard("dashboard", () => {
	return userModel.getProperty("/onboarded") ? true : "onboarding";
});

// Result: non-admin user navigating to "admin" is redirected to "dashboard",
// then "dashboard"'s guard checks onboarding and may redirect to "onboarding".
```

- On every hop, `context.fromRoute` and `context.fromHash` are the route the user is on, not the previous redirect target.
- Leave guards run only on the first hop, so the user is not asked twice.
- A hash visited twice (A → B → A) or a chain longer than 10 hops blocks the navigation and logs an error. See [Redirect chains](../../packages/lib/README.md#redirect-chains).

## Nested route guard patterns

Guards belong to one router instance. Protect nested routes in one of two ways.

### Flat routes with naming convention

When all routes are on one router, match a route name prefix in a global guard:

```typescript
router.addGuard((context) => {
	if (context.toRoute.startsWith("admin") && !isAdmin()) {
		return "home";
	}
	return true;
});
```

### Component-based nesting

Each component registers guards on its own router. The parent's guards protect the route that loads the child component. The child's guards protect the child's routes:

```typescript
// Parent Component.ts
const router = this.getRouter() as GuardRouter;
router.addRouteGuard("orders", authGuard); // protects loading the Orders component

// Orders Component.ts (child)
const router = this.getRouter() as GuardRouter;
router.addRouteGuard("orderDetail", orderAccessGuard); // protects individual order routes
```

The parent guard runs first. Each router drops its guards when it is destroyed.

The demo app contains a runnable version of this pattern with manifest guards: its `reports` route displays the nested component [`demo.app.reporting`](../../packages/demo-app/webapp/reporting/), which declares its own `routerClass` and `guardRouter` block.

```jsonc
// Parent manifest.json (sap.ui5)
"componentUsages": {
	"reports": { "name": "demo.app.reporting", "lazy": true }
},
"routing": {
	"routes": [{ "name": "reports", "pattern": "reports", "target": { "name": "reports", "prefix": "reports" } }],
	"targets": {
		"reports": { "type": "Component", "usage": "reports", "id": "reportsComponent" }
	}
}
```

- The nested router writes its hash under the prefix of the parent route, for example `#/reports&/reports/sales`, and behind the shell intent in the Fiori launchpad (`#app-preview&/reports&/reports/sales` in the demo's FLP preview).
- A manifest guard of the nested component receives the nested component as `context.ownerComponent`. The demo's [`confidentialGuard`](../../packages/demo-app/webapp/reporting/guards/confidentialGuard.ts) reads a model of the nested component and redirects within the nested router.
- The parent route waits for the nested router's first navigation, also when a guard redirects it. If a guard blocks that first navigation, the parent route is displayed and the nested component shows no view, so prefer a redirect for routes that can be reached by deep link. See [UI5 Internals the Router Relies On](../reference/architecture.md#ui5-internals-the-router-relies-on).

See the [demo app README](../../packages/demo-app/README.md#nested-component-reports) for the hashes to try.

## Settlement for UI feedback

`navigationSettled()` resolves when the guard pipeline finishes, with `status` (a `NavigationOutcome`), `route`, `hash` and, for `Error`, `error`.

```typescript
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { NavigationResult } from "ui5/guard/router/types";

const result: NavigationResult = await router.navigationSettled();
if (result.status === NavigationOutcome.Blocked) {
	MessageToast.show("Navigation was blocked by a guard.");
}
```

The demo app shows the result in its runtime panel; see `demo/RuntimeCoordinator.ts`. The full API is in [Navigation settlement](../../packages/lib/README.md#navigation-settlement).
