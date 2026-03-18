# Guard Integration Patterns

Common guard patterns for `ui5.guard.router.Router`. Each section describes a pattern, its guard type, and where to find the reference implementation.

## Pattern overview

| Pattern                                                            | Guard type           | Sync / Async | Reference                                                            |
| ------------------------------------------------------------------ | -------------------- | ------------ | -------------------------------------------------------------------- |
| [Authentication guard](#authentication-guard)                      | Route enter          | Sync         | `guards.ts` -- `createAuthGuard`                                     |
| [Async permission check](#async-permission-check-with-abortsignal) | Route enter          | Async        | `guards.ts` -- `createAsyncPermissionGuard`                          |
| [Always block](#always-block)                                      | Route enter          | Sync         | `guards.ts` -- `blockedGuard`                                        |
| [Always redirect](#always-redirect)                                | Route enter          | Sync         | `guards.ts` -- `forbiddenGuard`                                      |
| [Dirty form leave guard](#dirty-form-leave-guard)                  | Route leave          | Sync         | `guards.ts` -- `createDirtyFormGuard`                                |
| [Redirect with parameters](#redirect-with-parameters)              | Route enter          | Sync         | `guards.ts` -- `createRedirectWithParamsGuard`                       |
| [Error handling](#error-handling-in-guards)                        | Global / Route enter | Both         | `guards.ts` -- `createErrorDemoGuard`, `createAsyncErrorDemoGuard`   |
| [Guard factories](#guard-factories)                                | Any                  | Any          | `guards.ts` -- all `create*` functions                               |
| [Controller-level lifecycle](#controller-level-guard-lifecycle)    | Route leave          | Sync         | `Home.controller.ts` -- `onInit` / `onExit`                          |
| [Object form (enter + leave)](#object-form-enter--leave)           | Route enter + leave  | Any          | `Component.ts` -- `addRouteGuard` with config                        |
| [Settlement for UI feedback](#settlement-for-ui-feedback)          | N/A                  | Async        | [Library README](../../packages/lib/README.md#navigation-settlement) |

All reference implementations live in [`packages/demo-app/webapp/guards.ts`](../../packages/demo-app/webapp/guards.ts).

## Authentication guard

Synchronous boolean check against an auth model. Returns `true` to allow or a route name string to redirect.

```typescript
router.addRouteGuard("protected", (context) => {
	return authModel.getProperty("/isLoggedIn") === true ? true : "home";
});
```

Reference: `createAuthGuard` in `guards.ts`.

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

For a confirmation dialog before leaving, return the result of a `MessageBox.confirm` wrapped in a Promise. See the [library README leave guard example](../../packages/lib/README.md#leave-guard-with-controller-lifecycle) for the `MessageBox` pattern.

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

A guard that throws (sync) or rejects (async) blocks navigation. The router logs the error at `error` level and treats the result as `false`.

Sync:

```typescript
router.addRouteGuard("risky", () => {
	throw new Error("something broke");
	// Navigation is blocked. The router logs:
	// Enter guard [0] for route "risky" threw, blocking navigation
});
```

Async:

```typescript
router.addRouteGuard("risky", async (context) => {
	const res = await fetch("/api/check", { signal: context.signal });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return true;
	// If fetch rejects, navigation is blocked and the error is logged.
});
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
