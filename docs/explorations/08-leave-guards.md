# Alternative 8: Leave Guards for UI5

> **Status**: Implemented. This document captures the design research that informed the implementation. The actual API diverges from this proposal:
>
> - Uses shared `GuardContext` (including `signal: AbortSignal`) rather than a separate `LeaveGuardContext`
> - Public methods return `GuardRouter` (not the proposed `RouterInstance` — renamed to `RouterInternal` for the internal interface)
> - Helper is `isPromise` (not `isThenable`)
>
> See the [README](../../README.md) for usage examples and [Feature 01](../features/01-leave-guards.md) for the feature specification. The code samples below reflect the original **proposal**, not the final implementation.

## The Problem

All major SPA frameworks provide a way to prevent navigation **away** from a route, commonly called "leave guards" or "deactivation guards". The most common use case is warning users about unsaved form data.

### Framework Precedents

| Framework       | API                                                       | Pattern                                                                  | Status              |
| --------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------- |
| Vue Router      | `beforeRouteLeave(to, from)` / `onBeforeRouteLeave()`     | Return `false` to cancel                                                 | Stable              |
| Angular         | `canDeactivate(component)` / functional `CanDeactivateFn` | Receives component instance, checks state                                | Stable              |
| React Router    | `useBlocker(shouldBlock)`                                 | `proceed()` / `reset()` on blocker object                                | **Stable** (v6.19+) |
| TanStack Router | `useBlocker({ shouldBlockFn })`                           | `proceed()` / `reset()` + `ignoreBlocker`. `shouldBlockFn` can be async. | Experimental        |
| Ember.js        | `routeWillChange` + `transition.abort()`                  | Event-based, transition can be retried later                             | Stable              |
| SvelteKit       | `beforeNavigate` + `navigation.cancel()`                  | Client-side only, must be called during component init                   | Stable              |

---

## Design Approaches

### Approach A: Route-Level Leave Guards (Recommended)

Register leave guards on the router, similar to enter guards.

```typescript
// API
router.addLeaveGuard("editOrder", (context) => {
	const model = component.getModel("form") as JSONModel;
	if (model.getProperty("/isDirty")) {
		return false; // block navigation
	}
	return true; // allow
});

// With async confirmation dialog
router.addLeaveGuard("editOrder", async (context) => {
	const model = component.getModel("form") as JSONModel;
	if (!model.getProperty("/isDirty")) return true;

	return new Promise((resolve) => {
		MessageBox.confirm("Discard unsaved changes?", {
			onClose: (action) => resolve(action === "OK"),
		});
	});
});
```

#### Guard Context for Leave Guards

```typescript
interface LeaveGuardContext {
	fromRoute: string; // route being left
	fromHash: string; // current hash
	toRoute: string; // destination route
	toHash: string; // destination hash
	toArguments: Record<string, string>;
}
```

#### Execution Order

Following Vue Router's well-tested order:

```
1. Leave guards for the current route        ← NEW
2. Global guards (addGuard)                   ← existing
3. Route-specific enter guards (addRouteGuard) ← existing
```

#### Implementation in parse()

```typescript
parse(this: RouterInstance, newHash: string): void {
    // ... existing suppress/redirect/dedup checks ...

    const routeInfo = this.getRouteInfoByHash(newHash);
    const toRoute = routeInfo ? routeInfo.name : "";
    const generation = ++this._parseGeneration;

    // Build context
    const context = { toRoute, toHash: newHash, /* ... */ };

    // Run leave guards FIRST (for current route)
    const leaveResult = this._runLeaveGuards(this._currentRoute, context);

    if (isThenable(leaveResult)) {
        leaveResult.then((r) => {
            if (generation !== this._parseGeneration) return;
            if (r !== true) { this._restoreHash(); return; }
            // Then run enter guards
            this._runEnterGuards(newHash, toRoute, context, generation);
        });
    } else {
        if (leaveResult !== true) { this._restoreHash(); return; }
        this._runEnterGuards(newHash, toRoute, context, generation);
    }
}
```

#### Pros

- **Consistent API**: Same pattern as `addRouteGuard` / `removeRouteGuard`
- **Centralized**: Guards registered on the router, easy to manage
- **Testable**: Can be unit-tested without views/controllers
- **Async support**: Works with `MessageBox.confirm` via Promises
- **No UI5 framework changes needed**: Works within `parse()` override

#### Cons

- **No component access**: The guard function doesn't receive the view/controller instance (unlike Angular's `canDeactivate` which gets the component)
- **Workaround needed**: Developers must capture component references via closures or models
- **Leave guards can only block, not redirect**: Redirecting from a leave guard creates confusing UX (Vue and Angular don't allow it either)

---

### Approach B: Component-Level Leave Guards (Vue-Inspired)

Let controllers register their own leave guards.

```typescript
// In a Controller's onInit:
onInit() {
    const router = this.getOwnerComponent().getRouter() as RouterInstance;

    // Register a leave guard scoped to this controller
    this._leaveGuard = (context: LeaveGuardContext) => {
        const model = this.getView().getModel("form") as JSONModel;
        if (model.getProperty("/isDirty")) {
            return false;
        }
        return true;
    };

    router.addLeaveGuard("editOrder", this._leaveGuard);
}

onExit() {
    const router = this.getOwnerComponent().getRouter() as RouterInstance;
    router.removeLeaveGuard("editOrder", this._leaveGuard);
}
```

This is essentially the same as Approach A, but with a convention that controllers register/unregister their own guards. The router API is identical.

#### A Helper Mixin

To reduce boilerplate, a mixin could auto-register/unregister:

```typescript
// Hypothetical controller mixin
const LeaveGuardMixin = {
    /** Override in your controller */
    canLeave(context: LeaveGuardContext): GuardResult | Promise<GuardResult> {
        return true;
    },

    onInit() {
        this._leaveGuardRef = (ctx: LeaveGuardContext) => this.canLeave(ctx);
        const routeName = /* determine from current route */;
        this.getRouter().addLeaveGuard(routeName, this._leaveGuardRef);
    },

    onExit() {
        this.getRouter().removeLeaveGuard(routeName, this._leaveGuardRef);
    }
};
```

#### Pros

- **Component access**: The guard closure captures `this` (the controller), enabling direct state checks
- **Familiar pattern**: UI5 developers are used to `onInit` / `onExit` lifecycle
- **Self-contained**: Each controller manages its own guard

#### Cons

- **Lifecycle management**: Developers must remember to unregister in `onExit` or risk memory leaks
- **Fragile**: If a view is destroyed without `onExit` (edge case), the guard function references a dead controller
- **Not truly in-component**: Unlike Vue, where the framework manages component guard lifecycle, here it's manual

---

### Approach C: Event-Based Leave Guards (Ember-Inspired)

Fire an event on the router before leaving a route. Components or controllers can listen and abort.

```typescript
// Router fires "beforeLeave" event with an abort mechanism
router.attachBeforeLeave((event) => {
    const context = event.getParameter("context");
    const navigation = event.getParameter("navigation");

    if (context.fromRoute === "editOrder" && formIsDirty()) {
        navigation.abort();  // Cancel the navigation

        // Optionally: store for later retry
        this._pendingNavigation = navigation;
    }
});

// Later, after saving:
onSaveComplete() {
    if (this._pendingNavigation) {
        this._pendingNavigation.retry();
        this._pendingNavigation = null;
    }
}
```

#### The Navigation Object

```typescript
interface NavigationIntent {
	readonly toRoute: string;
	readonly toHash: string;
	readonly toArguments: Record<string, string>;
	readonly fromRoute: string;
	readonly fromHash: string;

	abort(): void; // Cancel this navigation
	retry(): void; // Re-attempt this navigation
	isStale(): boolean; // True if another navigation occurred since abort
}
```

#### Pros

- **Familiar UI5 pattern**: `attachEvent` / `detachEvent` is idiomatic UI5
- **Retry support**: Like Ember's `transition.retry()`, enables "save then navigate"
- **Decoupled**: Any code with router access can listen, not just the target route's controller
- **Stale detection**: `isStale()` prevents retrying outdated navigations

#### Cons

- **Async complexity**: Event-based patterns don't naturally support async (UI5 events are synchronous). Would need a registration-based approach to collect Promises.
- **Order ambiguity**: Multiple listeners on the same event. Who wins? Need clear priority.
- **Event spam**: `beforeLeave` fires for every navigation, not just route changes
- **Implementation complexity**: The `retry()` mechanism needs careful integration with `parse()` and `_parseGeneration`

---

### Approach D: Blocker Pattern (React-Inspired)

Provide a "blocker" API that components can create and manage.

```typescript
// In a Controller
onInit() {
    const router = this.getOwnerComponent().getRouter() as RouterInstance;

    // Create a blocker -- will prevent navigation when active
    this._blocker = router.createBlocker("editOrder", () => {
        return this._formIsDirty;
    });
}

// In template or controller logic
onNavigationBlocked() {
    // The blocker intercepted a navigation
    const blocker = this._blocker;

    if (blocker.state === "blocked") {
        MessageBox.confirm("Discard changes?", {
            onClose: (action) => {
                if (action === "OK") {
                    blocker.proceed();  // Continue the blocked navigation
                } else {
                    blocker.reset();    // Cancel, stay on current route
                }
            }
        });
    }
}

onExit() {
    this._blocker.destroy();
}
```

#### Blocker API

```typescript
interface RouteBlocker {
	readonly state: "unblocked" | "blocked" | "proceeding";
	readonly pendingNavigation: NavigationIntent | null;

	proceed(): void; // Allow the blocked navigation to continue
	reset(): void; // Cancel the blocked navigation
	destroy(): void; // Remove this blocker

	attachStateChange(handler: (event: Event) => void): void;
	detachStateChange(handler: (event: Event) => void): void;
}
```

#### Pros

- **Rich UX**: The component controls when and how to proceed (custom dialogs, save-first flows)
- **Stateful**: `blocker.state` enables reactive UI binding
- **UI5-friendly**: `attachStateChange` / `detachStateChange` matches UI5 event patterns
- **Explicit lifecycle**: `destroy()` ensures cleanup

#### Cons

- **Complex**: More API surface than a simple guard function
- **Stateful complexity**: Managing blocker state alongside router state and `_parseGeneration`
- **One blocker per route?**: What if multiple components on the same route create blockers?
- **Timing issues**: Between `blocked` and `proceed()`, the user might navigate again

---

## Recommended Approach

**Start with Approach A (route-level leave guards)**, then optionally layer Approach C's retry mechanism on top.

Rationale:

1. **Approach A** is the simplest and most consistent with the existing API
2. **Approach C's NavigationIntent** can be added later as an enhancement to guard context
3. **Approach B** is just a usage pattern on top of Approach A (no router changes needed)
4. **Approach D** is the most powerful but also the most complex; consider only if user demand is high

### Phased Implementation

**Phase 1**: `addLeaveGuard(routeName, fn)` / `removeLeaveGuard(routeName, fn)` with basic `true`/`false` returns. Leave guards run before enter guards in `parse()`.

**Phase 2**: Add `NavigationIntent` to guard context, enabling `context.navigation.abort()` and stored retry.

**Phase 3**: Consider `createBlocker()` API if the stateful pattern proves necessary.

## Impact on Existing Code

Leave guards slot naturally into the existing `parse()` override:

```
parse(newHash) called
  → suppress/redirect/dedup checks (unchanged)
  → run leave guards for _currentRoute          ← NEW
  → if blocked: _restoreHash(), return           ← NEW
  → run global enter guards (existing)
  → run route-specific enter guards (existing)
  → _commitNavigation (existing)
```

**Backward compatible**: Existing guards continue to work. Leave guards are opt-in.

## References

- [Vue Router beforeRouteLeave](https://router.vuejs.org/guide/advanced/navigation-guards.html#in-component-guards)
- [Angular canDeactivate](https://angular.io/api/router/CanDeactivate)
- [React Router useBlocker](https://reactrouter.com/en/main/hooks/use-blocker)
- [React Router Navigation Blocking How-To](https://reactrouter.com/how-to/navigation-blocking)
- [TanStack Router useBlocker](https://tanstack.com/router/v1/docs/framework/react/api/router/useBlockerHook)
- [Ember.js Preventing and Retrying Transitions](https://guides.emberjs.com/release/routing/preventing-and-retrying-transitions/)
