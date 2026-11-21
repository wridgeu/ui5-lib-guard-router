# Feature: Leave Guards

> **Status**: Implemented. See the [library README](../../packages/lib/README.md) for the API and usage examples. `Router.ts`, `GuardPipeline.ts` and `types.ts` are the source of truth.

## Problem

Enter guards run before navigating **to** a route. Nothing stopped a navigation **away from** a route, which is how every major SPA framework asks "discard unsaved changes?" (Vue's `beforeRouteLeave`, Angular's `canDeactivate`, React/TanStack's `useBlocker`).

Without leave guards, apps had three poor options:

- A global guard that checks form state on every navigation (fragile, tightly coupled)
- The browser's `beforeunload` (covers closing the page, not in-app navigation)
- Tracking dirty state in a model and checking it everywhere

## API

```typescript
import type { GuardRouter, LeaveGuardFn } from "ui5/guard/router/types";

// LeaveGuardFn = (context: GuardContext) => boolean | PromiseLike<boolean>
router.addLeaveGuard(routeName: string, guard: LeaveGuardFn): GuardRouter;
router.removeLeaveGuard(routeName: string, guard: LeaveGuardFn): GuardRouter;

// Object form: register enter and leave guards for one route in one call
router.addRouteGuard(routeName, { beforeEnter?: GuardFn, beforeLeave?: LeaveGuardFn });
```

## Usage

```typescript
const dirtyFormGuard: LeaveGuardFn = (context) => {
	const model = component.getModel("form") as JSONModel;
	if (!model.getProperty("/isDirty")) return true;

	return new Promise((resolve) => {
		MessageBox.confirm("You have unsaved changes. Discard?", {
			onClose: (action: string) => resolve(action === "OK"),
		});
	});
};

router.addLeaveGuard("editOrder", dirtyFormGuard);
router.removeLeaveGuard("editOrder", dirtyFormGuard);
```

## Decisions

### No redirects from leave guards

A leave guard returns `true` (allow) or `false` (block). It cannot redirect. This matches Vue Router and Angular: a leave guard answers "can I leave?", not "where should I go instead?". A redirect from a leave guard makes confusing UX and complex edge cases. A non-boolean result logs a warning and blocks.

### Shared `GuardContext`

The proposal had a separate, smaller `LeaveGuardContext` and a `LeaveGuardResult` type. Both were dropped. Leave guards receive the same `GuardContext` as enter guards, including `signal`, `bag` and `toMeta`/`fromMeta`. The restricted type existed to keep a `transition` object ([Feature 03](./03-transition-object.md)) away from leave guards; that object was never shipped, so the restriction protected nothing.

### Per-route only

There are no global leave guards. The common case is "this view has unsaved changes", which belongs to one route. A manifest entry `guards["*"].leave` is skipped with a warning. Global leave guards can be added later if a use case appears.

### Guard functions, not events or blockers

A `beforeLeave` router event (Ember style) was rejected: UI5 events are synchronous, so async checks would need a side channel to collect promises, and the order of several listeners is unclear. A `createBlocker()` object (React style) was rejected too: more API, blocker state to keep in step with the router, no answer for two blockers on one route, and a race when the user navigates again between "blocked" and `proceed()`.

### Leave guards run first

Leave guards form the first phase of the pipeline, before global and route enter guards. If the user stays, no enter guard runs. See [Execution order](../../packages/lib/README.md#execution-order).

## Behavior

- A leave guard runs only when its route is left. It does not run on the initial navigation (no `fromRoute`).
- It does not run on the hops of a redirect chain: the route was already left once.
- The first guard that does not return `true` stops the rest.
- A newer navigation aborts `context.signal` and discards the result of a pending async leave guard.
- `destroy()` clears all leave guards.

## Compatibility

The API is additive. Leave guards are independent of enter guards and can be adopted one route at a time. They pair with `navTo(..., { skipGuards: true })` ([Feature 02](./02-guard-bypass.md)) for "save and navigate".
