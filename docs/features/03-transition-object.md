# Feature: Transition Object (NavigationIntent)

> **Status**: Proposed. See the [feature index](./README.md) for priority and dependencies.

## Problem

When a guard redirects (for example, an unauthenticated user to the login page), the guard context knows the original destination, but the redirect target does not. Apps pass it by hand:

```typescript
// Workaround: pass the original hash as a route parameter
router.addGuard((context) => {
	if (!isLoggedIn() && context.toRoute !== "login") {
		return { route: "login", parameters: { returnTo: context.toHash } };
	}
	return true;
});

// Login controller: read the parameter from the route's patternMatched arguments
const returnTo = event.getParameter("arguments").returnTo;
if (returnTo) {
	HashChanger.getInstance().setHash(returnTo);
}
```

This is error-prone (encoding a hash inside a hash, hash vs. route name) and does not compose with complex route parameters.

Ember.js solves this with a **transition object**: the intercepted navigation as a value that can be stored and retried.

## Proposed API

### NavigationIntent Interface

```typescript
interface NavigationIntent {
	/** Target route name */
	readonly toRoute: string;
	/** Target hash */
	readonly toHash: string;
	/** Parsed route parameters */
	readonly toArguments: RouteInfo["arguments"];
	/** Source route name */
	readonly fromRoute: string;
	/** Source hash */
	readonly fromHash: string;

	/**
	 * Retry the navigation. Guards run again.
	 * Use when the blocking condition may or may not be resolved.
	 */
	retry(): void;

	/**
	 * Retry the navigation, bypassing all guards.
	 * Use when the blocking condition is definitely resolved
	 * (the user just logged in).
	 */
	retrySkipGuards(): void;

	/**
	 * True if this intent has been superseded by a newer navigation
	 * or has already been used. Stale intents should not be retried.
	 */
	isStale(): boolean;

	/** Monotonic ID for comparison between intents */
	readonly id: number;
}
```

### GuardContext Integration

`GuardContext` gains one field. All existing fields (`signal`, `bag`, `toMeta`, `fromMeta`, `ownerComponent`, ...) stay as they are.

```typescript
interface GuardContext {
	// ...existing fields
	transition: NavigationIntent;
}
```

## Usage Example

### Auth Guard with Resume

```typescript
// Guard registration, for example in Component.ts
router.addGuard((context) => {
    const auth = component.getModel("auth") as JSONModel;

    if (context.toRoute !== "login" && !auth.getProperty("/isLoggedIn")) {
        // Store the transition for later
        auth.setProperty("/pendingTransition", context.transition);
        return "login";
    }
    return true;
});

// Login.controller.ts, after a successful login
async onLoginSuccess() {
    const auth = this.getOwnerComponent()!.getModel("auth") as JSONModel;
    auth.setProperty("/isLoggedIn", true);

    const transition = auth.getProperty("/pendingTransition") as NavigationIntent | null;
    if (transition && !transition.isStale()) {
        auth.setProperty("/pendingTransition", null);
        transition.retrySkipGuards();  // User is now authenticated
    } else {
        router.navTo("home");  // No pending destination, go home
    }
}
```

### Form Guard with Retry

```typescript
// Leave guard (Feature 01): could store context.transition for a "Save and continue" button.
// Returning a confirmation result is simpler.
router.addLeaveGuard("editOrder", (context) => {
	if (!formModel.getProperty("/isDirty")) return true;
	return new Promise((resolve) => {
		MessageBox.confirm("Discard changes?", {
			onClose: (action) => resolve(action === "OK"),
		});
	});
});
```

## Implementation Sketch

### Creating the NavigationIntent

`_createGuardContext()` would create the intent, with a closure over the router and the generation of the navigation attempt.

### NavigationIntent Factory

```typescript
_createNavigationIntent(
    toHash: string,
    toRoute: string,
    routeInfo: RouteInfo | null,
    generation: number
): NavigationIntent {
    const router = this;
    let used = false;

    return {
        toRoute,
        toHash,
        toArguments: routeInfo ? { ...routeInfo.arguments } : {},
        fromRoute: this._currentRoute,
        fromHash: this._currentHash ?? "",
        id: generation,

        retry() {
            if (used) return;
            used = true;
            router.navTo(toRoute, this.toArguments);
        },

        retrySkipGuards() {
            if (used) return;
            used = true;
            router.navTo(toRoute, this.toArguments, undefined, false, { skipGuards: true });
        },

        isStale() {
            return used || router._parseGeneration !== generation;
        }
    };
}
```

### Staleness

`isStale()` is true when either holds:

1. **`used`**: `retry()` or `retrySkipGuards()` was already called.
2. **`generation !== router._parseGeneration`**: a newer navigation has started since the intent was created.

This prevents ghost navigations from stored intents that no longer apply. The hops of a redirect chain keep the generation, so an intent stored by a guard that redirects to login stays fresh until the next navigation starts. Any navigation on the login page before the retry makes it stale.

## Design Decisions

### Not Serializable

The `NavigationIntent` holds a closure over the router. It cannot be stored in `sessionStorage`. This is intentional: the intent is for in-memory "redirect and resume" within one session. To resume across a page reload, store `context.toHash` as a string.

### retry() Re-runs Guards

`retry()` navigates through the normal pipeline, so guards run again. This is the safe default: if the condition has not changed, the guard blocks again instead of letting the user through.

`retrySkipGuards()` is for when the app knows the condition is resolved (the user just logged in). It uses `navTo(..., { skipGuards: true })` ([Feature 02](./02-guard-bypass.md)).

### One-Shot Usage

`retry()` and `retrySkipGuards()` set `used = true`; later calls do nothing. This prevents double navigation from UI event handlers.

## Test Cases

1. `context.transition` is present and has correct properties
2. `transition.retry()` navigates to the original destination (guards run)
3. `transition.retrySkipGuards()` navigates without guards
4. `transition.isStale()` returns `false` immediately after creation
5. `transition.isStale()` returns `true` after a new navigation starts
6. `transition.isStale()` returns `true` after `retry()` is called
7. `retry()` is a no-op on second call (one-shot)
8. `retrySkipGuards()` is a no-op on second call (one-shot)
9. Auth guard stores transition, login page resumes via `retrySkipGuards()`
10. Stale transition does nothing when retried

## Dependencies

- **Feature 02 (Guard Bypass)**: shipped as `skipGuards`, so `retrySkipGuards()` can build on it. Usually `retry()` is enough: once the condition is resolved (the user logged in), the guards pass.

## Compatibility

- Additive property on `GuardContext`. Guards that do not read `transition` are unaffected.
- No change to guard return types or execution flow.
- The `NavigationIntent` methods are thin wrappers around `navTo()`.
