# Feature: Leave Guards

> **Status**: Implemented. See the [README](../../README.md) for usage examples.
>
> **Implementation note**: The final implementation diverges from this proposal in several ways:
>
> - Leave guards use the shared `GuardContext` (including `signal: AbortSignal`) rather than a separate `LeaveGuardContext`
> - There is no separate `LeaveGuardResult` type; `LeaveGuardFn` returns `boolean | Promise<boolean>` directly
> - Public methods return `GuardRouter` (not the proposed `RouterInstance` — which was renamed to `RouterInternal` for the internal interface)
> - `addRouteGuard` also accepts an object form `{ beforeEnter?, beforeLeave? }` for convenience
> - The helper is named `isPromise` (not `isThenable` as sketched below)
> - Open question #2 was resolved: leave guards receive the full `GuardContext`
>
> The code samples below reflect the original **proposal**, not the final implementation. Refer to `Router.ts` and `types.ts` for the actual code.

## Problem

The router currently only supports **enter guards**, functions that run before navigating **to** a route. There is no mechanism to prevent navigation **away from** a route, which is the standard approach for "unsaved changes?" dialogs in every major SPA framework (Vue's `beforeRouteLeave`, Angular's `canDeactivate`, React/TanStack's `useBlocker`).

Without leave guards, developers must either:

- Use a global guard that checks form state for every navigation (fragile, tightly coupled)
- Rely on browser `beforeunload` (only covers page close, not in-app navigation)
- Manually track dirty state in a model and check it everywhere

## Proposed API

```typescript
// Register a leave guard for a specific route
router.addLeaveGuard(routeName: string, guard: LeaveGuardFn): RouterInstance;

// Remove a previously registered leave guard
router.removeLeaveGuard(routeName: string, guard: LeaveGuardFn): RouterInstance;
```

### Leave Guard Function

```typescript
type LeaveGuardResult = boolean; // true = allow, false = block (no redirects)

type LeaveGuardFn = (context: LeaveGuardContext) => LeaveGuardResult | Promise<LeaveGuardResult>;

interface LeaveGuardContext {
	fromRoute: string;
	fromHash: string;
	toRoute: string;
	toHash: string;
	toArguments: Record<string, string>;
}
```

### Design Decision: No Redirects from Leave Guards

Leave guards can only return `true` (allow) or `false` (block). They cannot redirect. This matches Vue Router and Angular's convention: leave guards answer the question "can I leave?" not "where should I go instead?". Redirecting from a leave guard creates confusing UX and complex edge cases.

## Usage Example

```typescript
// In Component.ts or a guard registration module
const dirtyFormGuard: LeaveGuardFn = async (context) => {
	const model = component.getModel("form") as JSONModel;
	if (!model.getProperty("/isDirty")) return true;

	return new Promise((resolve) => {
		MessageBox.confirm("You have unsaved changes. Discard?", {
			onClose: (action: string) => resolve(action === "OK"),
		});
	});
};

router.addLeaveGuard("editOrder", dirtyFormGuard);

// Clean up when no longer needed
router.removeLeaveGuard("editOrder", dirtyFormGuard);
```

## Execution Order

The full guard pipeline becomes:

1. **Leave guards** for `fromRoute` (NEW)
2. **Global enter guards** (existing `_globalGuards`)
3. **Route-specific enter guards** for `toRoute` (existing `_enterGuards`)

If any leave guard returns `false`, the entire pipeline short-circuits and the hash is restored. Enter guards never run.

## Implementation Sketch

### State Addition

```typescript
// In constructor
this._leaveGuards = new Map<string, LeaveGuardFn[]>();
```

### parse() Modification

```typescript
parse(this: RouterInstance, newHash: string): void {
    // ... existing suppress/redirect/dedup checks ...

    const routeInfo = this.getRouteInfoByHash(newHash);
    const toRoute = routeInfo ? routeInfo.name : "";
    const generation = ++this._parseGeneration;

    // Check if any guards apply (leave OR enter)
    const hasLeaveGuards = this._currentRoute && this._leaveGuards.has(this._currentRoute);
    const hasEnterGuards = this._globalGuards.length > 0
        || (toRoute && this._enterGuards.has(toRoute));

    if (!hasLeaveGuards && !hasEnterGuards) {
        this._commitNavigation(newHash, toRoute);
        return;
    }

    const context = { /* ... build context ... */ };

    // Run leave guards first, then enter guards
    const leaveResult = hasLeaveGuards
        ? this._runLeaveGuards(context)
        : true;

    if (isThenable(leaveResult)) {
        leaveResult.then((r) => {
            if (generation !== this._parseGeneration) return;
            if (r !== true) { this._blockNavigation(); return; }
            // Continue with enter guards...
            runEnterGuards(); // local helper that calls _runEnterGuards and applies result
        });
    } else {
        if (leaveResult !== true) { this._blockNavigation(); return; }
        runEnterGuards(); // local helper that calls _runEnterGuards and applies result
    }
}
```

### LeaveGuardContext vs GuardContext

The `LeaveGuardContext` is intentionally a separate type from `GuardContext`. Leave guards don't receive a `transition` object (Feature 03) because they shouldn't redirect. They answer a binary question: "can I leave?"

## Types Addition

```typescript
// In types.ts
export type LeaveGuardResult = boolean;
export type LeaveGuardFn = (context: LeaveGuardContext) => LeaveGuardResult | Promise<LeaveGuardResult>;

export interface LeaveGuardContext {
    fromRoute: string;
    fromHash: string;
    toRoute: string;
    toHash: string;
    toArguments: Record<string, string>;
}

// RouterInstance additions
_leaveGuards: Map<string, LeaveGuardFn[]>;
addLeaveGuard(routeName: string, guard: LeaveGuardFn): RouterInstance;
removeLeaveGuard(routeName: string, guard: LeaveGuardFn): RouterInstance;
_runLeaveGuards(context: LeaveGuardContext): LeaveGuardResult | Promise<LeaveGuardResult>;
```

## Test Cases

1. Leave guard returning `true` allows navigation
2. Leave guard returning `false` blocks navigation and restores hash
3. Async leave guard with MessageBox-style Promise
4. Leave guard only runs when leaving its registered route
5. Leave guard does not run on initial navigation (no `fromRoute`)
6. Leave guard does not run during redirects (`_redirecting = true`)
7. Multiple leave guards: first `false` short-circuits
8. Leave guards run before enter guards (execution order)
9. Leave guard + enter guard: leave allows, enter blocks
10. Leave guard + enter guard: leave blocks (enter never runs)
11. `removeLeaveGuard` prevents guard from running
12. `destroy()` clears leave guards
13. Async leave guard with generation counter (superseded navigation)

## Compatibility

- Fully backward compatible (additive API)
- No changes to existing guard behavior
- Leave guards are independent of enter guards and can be adopted incrementally
- Pairs naturally with Feature 02 (Guard Bypass) for "Save & Navigate" patterns

## Open Questions

1. Should there be **global** leave guards (run on every route departure)? The initial design only supports per-route leave guards, matching the most common use case. Global leave guards could be added later if needed.
2. Should leave guards receive the full `GuardContext` (with `transition` from Feature 03) or a restricted `LeaveGuardContext`? The restricted type is safer but less flexible.
