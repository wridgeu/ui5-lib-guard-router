# Guard Integration Patterns

Common guard patterns for `ui5.guard.router.Router`. Each section describes a pattern, its guard type, and where to find the reference implementation.

## Pattern overview

| Pattern                                                                     | Guard type           | Sync / Async | Reference                                                            |
| --------------------------------------------------------------------------- | -------------------- | ------------ | -------------------------------------------------------------------- |
| [Authentication guard](#authentication-guard)                               | Route enter          | Sync         | `guards.ts` -- `createAuthGuard`                                     |
| [Redirect and resume](#redirect-and-resume)                                 | Global enter         | Sync         | inline example                                                       |
| [Async permission check](#async-permission-check-with-abortsignal)          | Route enter          | Async        | `guards.ts` -- `createAsyncPermissionGuard`                          |
| [Always block](#always-block)                                               | Route enter          | Sync         | `guards.ts` -- `blockedGuard`                                        |
| [Always redirect](#always-redirect)                                         | Route enter          | Sync         | `guards.ts` -- `forbiddenGuard`                                      |
| [Dirty form leave guard](#dirty-form-leave-guard)                           | Route leave          | Sync         | `guards.ts` -- `createDirtyFormGuard`                                |
| [Redirect with parameters](#redirect-with-parameters)                       | Route enter          | Sync         | `guards.ts` -- `createRedirectWithParamsGuard`                       |
| [Error handling](#error-handling-in-guards)                                 | Global / Route enter | Both         | `guards.ts` -- `createErrorDemoGuard`, `createAsyncErrorDemoGuard`   |
| [Guard factories](#guard-factories)                                         | Any                  | Any          | `guards.ts` -- all `create*` functions                               |
| [Controller-level lifecycle](#controller-level-guard-lifecycle)             | Route leave          | Sync         | `Home.controller.ts` -- `onInit` / `onExit`                          |
| [Object form (enter + leave)](#object-form-enter--leave)                    | Route enter + leave  | Any          | `Component.ts` -- `addRouteGuard` with config                        |
| [Chained authorization](#chained-authorization-redirect-chain-guards)       | Route enter          | Sync         | `guards.ts` -- multiple route guards                                 |
| [Async guard timeout](#async-guard-timeout)                                 | Route enter          | Async        | inline example                                                       |
| [Factory pattern for manifest guards](#factory-pattern-for-manifest-guards) | Any                  | Any          | inline example                                                       |
| [Nested route guard patterns](#nested-route-guard-patterns)                 | Global / Route enter | Any          | inline example                                                       |
| [Settlement for UI feedback](#settlement-for-ui-feedback)                   | N/A                  | Async        | [Library README](../../packages/lib/README.md#navigation-settlement) |

Most reusable guard factories live in [`packages/demo-app/webapp/guards.ts`](../../packages/demo-app/webapp/guards.ts). Controller lifecycle and object-form examples also reference `Component.ts` and `Home.controller.ts` where noted in the table above.

## Authentication guard

Synchronous boolean check against an auth model. Returns `true` to allow or a route name string to redirect.

```typescript
router.addRouteGuard("protected", (context) => {
	return authModel.getProperty("/isLoggedIn") === true ? true : "home";
});
```

Reference: `createAuthGuard` in `guards.ts`.

## Redirect and resume

When a guard redirects (e.g., unauthenticated user sent to login), the original destination is lost. Store the target route and its arguments as plain data, then resume with `router.navTo()` after the blocking condition is resolved.

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

In the login controller, resume the original navigation after a successful login:

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

`router.navTo()` is the standard UI5 router API for navigation. Guards re-run on the resumed navigation, which is the safe default — the auth guard passes because the user just logged in.

For cross-session flows (IdP redirect with page reload), in-memory model data does not survive. Store the destination in `sessionStorage` instead. There are two variants:

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
// After IdP callback — in Component.init(), after router.initialize()
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

This uses the standard router API and guards run on the resumed navigation. Because `router.initialize()` already processes the current hash, this causes two navigations: one for the initial hash (typically the default route) and one for the pending destination. For most apps with synchronous guards this is not noticeable, but apps with async guards may see a brief flicker.

**Variant B: store the hash, restore with `HashChanger` before the router starts**

```typescript
// In the guard, before redirecting to the IdP
sessionStorage.setItem("returnTo", context.toHash);
```

Import `HashChanger` at the top of the component file:

```typescript
import HashChanger from "sap/ui/core/routing/HashChanger";
```

Then in `Component.init()`, before `router.initialize()`:

```typescript
const returnTo = sessionStorage.getItem("returnTo");
if (returnTo) {
	sessionStorage.removeItem("returnTo");
	HashChanger.getInstance().setHash(returnTo);
}
router.initialize(); // picks up the restored hash on first parse
```

`HashChanger` is not commonly used in application code, but it avoids the double-navigation of Variant A. The hash is set before `router.initialize()`, so the router processes the restored hash on its first parse. `setHash()` writes a browser history entry; for the initial app load after an IdP callback this is typically acceptable.

## Async permission check with AbortSignal

Async guard that performs a backend call. Pass `context.signal` to `fetch()` so the request is cancelled when a newer navigation supersedes the pending one.

```typescript
router.addRouteGuard("dashboard", async (context) => {
	const res = await fetch(`/api/access/${context.toRoute}`, {
		signal: context.signal,
	});
	const { allowed } = await res.json();
	return allowed ? true : "home";
});
```

Wrap the `await` in a `try/catch` to handle `AbortError` separately from unexpected failures. The router blocks navigation and logs an error when a guard Promise rejects.

Reference: `createAsyncPermissionGuard` in `guards.ts`. See the [library README async guard example](../../packages/lib/README.md#async-guard-with-abortsignal) for the full pattern with a busy indicator.

## Async guard timeout

If an async guard's fetch hangs (dead endpoint, no timeout), the navigation stays in the evaluating phase indefinitely. The `AbortSignal` on `context.signal` only fires on supersede or router stop/destroy, not on "too slow."

Combine `context.signal` with `AbortSignal.timeout()` using `AbortSignal.any()` to enforce a hard deadline:

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

When the timeout fires, `fetch` rejects with a `TimeoutError`. Since the guard's Promise rejects, the navigation settles as `NavigationOutcome.Error`. Wrap the `await` in a `try/catch` if you need to distinguish timeout from supersede or return a redirect instead of an error.

> [!NOTE]
> `AbortSignal.any()` requires Node 20+ / modern browsers (Safari 17.4+, Chrome 116+, Firefox 124+). For broader compatibility, use a manual `AbortController` with `setTimeout`:
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

Return `false` to block navigation unconditionally. The hash reverts to the previous route.

```typescript
router.addRouteGuard("maintenance", () => false);
```

Reference: `blockedGuard` in `guards.ts`.

## Always redirect

Return a route name string to redirect unconditionally.

```typescript
router.addRouteGuard("old-page", () => "new-page");
```

Reference: `forbiddenGuard` in `guards.ts`.

## Dirty form leave guard

Leave guard that checks a model property before allowing navigation away from a route. Returns `boolean` only (no redirects).

```typescript
router.addRouteGuard("editor", {
	beforeLeave: (context) => {
		return formModel.getProperty("/isDirty") !== true;
	},
});
```

For a confirmation dialog before leaving, return the result of a `MessageBox.confirm` wrapped in a Promise. See the [library README leave guard tip](../../packages/lib/README.md#leave-guard-with-controller-lifecycle) for guidance on making blocked navigation visible to the user.

Reference: `createDirtyFormGuard` in `guards.ts`.

## Redirect with parameters

Return a `GuardRedirect` object to redirect while forwarding route parameters.

```typescript
router.addRouteGuard("old-detail", (context) => ({
	route: "detail",
	parameters: context.toArguments,
}));
```

Reference: `createRedirectWithParamsGuard` in `guards.ts`. See the [library README redirect example](../../packages/lib/README.md#redirect-with-parameters-guardredirect) for the `componentTargetInfo` variant.

## Error handling in guards

A guard that throws (sync) or rejects (async) settles navigation as `NavigationOutcome.Error`. This is distinct from `NavigationOutcome.Blocked` (guard returned `false`), allowing the app to show different UX for "access denied" vs "something went wrong." The thrown value is available on `result.error`.

Sync:

```typescript
router.addRouteGuard("risky", () => {
	throw new Error("something broke");
	// Navigation settles as Error. The router logs:
	// Enter guard [0] on route "risky" threw, navigation failed
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

Handling the distinction:

```typescript
const result = await router.navigationSettled();
switch (result.status) {
	case NavigationOutcome.Blocked:
		MessageToast.show("Access denied");
		break;
	case NavigationOutcome.Error:
		MessageBox.error("Navigation failed: " + String(result.error));
		break;
}
```

Enable debug logging to see all guard errors. See the [Debugging and Troubleshooting section](../../packages/lib/README.md#debugging-and-troubleshooting) in the library README.

Reference: `createErrorDemoGuard` and `createAsyncErrorDemoGuard` in `guards.ts`.

## Guard factories

Wrap guard logic in a factory function when the guard depends on external state (models, services, configuration). The factory captures dependencies via closure; the returned function is the guard.

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

All `create*` functions in `guards.ts` follow this pattern.

## Factory pattern for manifest guards

When multiple routes need the same guard logic with different parameters (e.g., different required roles), use a factory function that returns the guard and create thin wrappers for each manifest registration:

```typescript
// guards/requireRole.ts — shared factory (not a guard module itself)
import type { GuardFn } from "ui5/guard/router/types";

export function createRoleGuard(role: string): GuardFn {
	return () => {
		const roles = getUserRoles(); // app-level helper
		return roles.includes(role) ? true : "forbidden";
	};
}
```

```typescript
// guards/adminGuard.ts — thin wrapper for manifest registration
import { createRoleGuard } from "./requireRole";
export default createRoleGuard("admin");
```

```typescript
// guards/analystGuard.ts
import { createRoleGuard } from "./requireRole";
export default createRoleGuard("analyst");
```

Wire the guard modules in the manifest:

```json
"guardRouter": {
	"guards": {
		"admin": ["guards.adminGuard"],
		"reports": ["guards.analystGuard"]
	}
}
```

This keeps guard logic in a single place while letting each route configure its own parameters through the manifest.

## Controller-level guard lifecycle

Register a leave guard in `onInit` and remove it in `onExit`. UI5 caches XMLViews by default, so `onInit` runs once but `onExit` runs on `destroy()`.

```typescript
export default class EditorController extends BaseController {
	private _leaveGuard: LeaveGuardFn | null = null;

	onInit(): void {
		this._leaveGuard = createDirtyFormGuard(this.getModel("form"));
		(this.getRouter() as GuardRouter).addLeaveGuard("editor", this._leaveGuard);
	}

	onExit(): void {
		if (this._leaveGuard) {
			(this.getRouter() as GuardRouter).removeLeaveGuard("editor", this._leaveGuard);
			this._leaveGuard = null;
		}
	}
}
```

Reference: `Home.controller.ts` -- `onInit` / `onExit` pattern. See the [library README controller lifecycle section](../../packages/lib/README.md#leave-guard-with-controller-lifecycle) for the full explanation.

## Object form (enter + leave)

Use `addRouteGuard` with a `{ beforeEnter, beforeLeave }` object to register both guards for the same route in a single call. `removeRouteGuard` accepts the same object form.

```typescript
const guardConfig = {
	beforeEnter: createAuthGuard(authModel),
	beforeLeave: createDirtyFormGuard(formModel),
};

router.addRouteGuard("protected", guardConfig);

// Later:
router.removeRouteGuard("protected", guardConfig);
```

Reference: `Component.ts` guard registration.

## Chained authorization (redirect chain guards)

When a guard redirects to another route, that route's guards also run. This enables multi-step authorization chains where each route independently decides whether to allow, block, or redirect further.

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

On redirect hops, `context.fromRoute` and `context.fromHash` always refer to the **original** source route (where the user currently is), not the intermediate redirect target. This lets guards reason about where the user is coming from, regardless of how many hops preceded them.

Leave guards run only on the first hop (the initial navigation). Redirect chain hops skip leave guards to avoid re-prompting the user after they already confirmed leaving.

The router detects redirect loops (e.g., A → B → A) via a visited-hash set, and caps chain depth at 10 hops. Both safeguards block the navigation and log an error. See the [library README redirect chain section](../../packages/lib/README.md#redirect-chains) for details.

## Nested route guard patterns

UI5 supports nested routing through component targets. Guards are scoped to their router instance, so nested protection requires one of two patterns.

### Flat routes with naming convention

Use a global guard with prefix matching when all routes live on a single router:

```typescript
router.addGuard((context) => {
	if (context.toRoute.startsWith("admin") && !isAdmin()) {
		return "home";
	}
	return true;
});
```

This works well when admin routes follow a consistent naming convention (e.g., `admin`, `adminUsers`, `adminSettings`).

### Component-based nesting

When using nested components, each component registers its own guards on its own router. The parent component's guards protect the parent route (which loads the child component). The child component's guards protect its internal routes. This matches UI5's component isolation model:

```typescript
// Parent Component.ts
const router = this.getRouter() as GuardRouter;
router.addRouteGuard("orders", authGuard); // protects loading the Orders component

// Orders Component.ts (child)
const router = this.getRouter() as GuardRouter;
router.addRouteGuard("orderDetail", orderAccessGuard); // protects individual order routes
```

The parent guard runs first (protecting access to the child component), and the child's guards run within the child's own routing scope. Guards are cleaned up automatically when each component's router is destroyed.

## Settlement for UI feedback

`navigationSettled()` returns a Promise that resolves when the guard pipeline finishes. The result contains `status` (a `NavigationOutcome` enum value), `route`, and `hash`.

```typescript
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { NavigationResult } from "ui5/guard/router/types";

const result: NavigationResult = await router.navigationSettled();
if (result.status === NavigationOutcome.Blocked) {
	MessageToast.show("Navigation was blocked by a guard.");
}
```

The demo app uses this to display settlement status in the runtime panel. See `RuntimeCoordinator.ts` for the subscription pattern and the [library README settlement section](../../packages/lib/README.md#navigation-settlement) for the full API.
