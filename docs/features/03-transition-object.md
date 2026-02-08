# Feature: Transition Object (NavigationIntent)

## Problem

When a guard redirects (e.g., unauthenticated user → login page), the original destination is available in the guard's context but not easily passed to the redirect target. Developers must manually encode it:

```typescript
// Current workaround: manual hash encoding
router.addGuard((context) => {
	if (!isLoggedIn && context.toRoute !== "login") {
		// Must manually pass the original destination
		return { route: "login", parameters: { returnTo: context.toHash } };
	}
	return true;
});

// Login controller must manually decode and navigate
const returnTo = this.getRoute().getParameter("returnTo");
if (returnTo) {
	HashChanger.getInstance().setHash(returnTo);
}
```

This is error-prone (encoding/decoding, hash vs route name confusion) and doesn't compose well with complex route parameters.

Ember.js solves this with a **transition object** — a first-class representation of the intercepted navigation that can be stored and retried.

## Proposed API

### NavigationIntent Interface

```typescript
interface NavigationIntent {
	/** Target route name */
	readonly toRoute: string;
	/** Target hash */
	readonly toHash: string;
	/** Parsed route parameters */
	readonly toArguments: Record<string, string>;
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
	 * (e.g., user just logged in).
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

```typescript
interface GuardContext {
	toRoute: string;
	toHash: string;
	toArguments: Record<string, string>;
	fromRoute: string;
	fromHash: string;
	transition: NavigationIntent; // NEW
}
```

## Usage Example

### Auth Guard with Resume

```typescript
// Guard registration (e.g., in Component.ts)
router.addGuard((context) => {
    const auth = component.getModel("auth") as JSONModel;

    if (context.toRoute !== "login" && !auth.getProperty("/isLoggedIn")) {
        // Store the transition for later
        auth.setProperty("/pendingTransition", context.transition);
        return "login";
    }
    return true;
});

// In Login.controller.ts — after successful login
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
// Combined with leave guard (Feature 01)
router.addLeaveGuard("editOrder", (context) => {
	if (!formModel.getProperty("/isDirty")) return true;

	// Could store context.transition for a "Save & Continue" button
	// But for leave guards, the simpler pattern is just returning false
	return new Promise((resolve) => {
		MessageBox.confirm("Discard changes?", {
			onClose: (action) => resolve(action === "OK"),
		});
	});
});
```

## Implementation Sketch

### Creating the NavigationIntent

Created inside `parse()`, with a closure over the router instance and the current generation:

```typescript
parse(this: RouterInstance, newHash: string): void {
    // ... existing checks ...

    const generation = ++this._parseGeneration;

    const context: GuardContext = {
        toRoute,
        toHash: newHash,
        toArguments: routeInfo ? routeInfo.arguments : {},
        fromRoute: this._currentRoute,
        fromHash: this._currentHash ?? "",
        transition: this._createNavigationIntent(newHash, toRoute, routeInfo, generation)
    };

    // ... run guards with context ...
}
```

### NavigationIntent Factory

```typescript
_createNavigationIntent(
    this: RouterInstance,
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

The `isStale()` check uses two conditions:

1. **`used`**: The intent's `retry()` or `retrySkipGuards()` was already called
2. **`generation !== router._parseGeneration`**: A newer navigation has started since this intent was created

This prevents ghost navigations from stored intents that are no longer relevant.

## Design Decisions

### Not Serializable

The `NavigationIntent` holds a closure over the router instance. It cannot be serialized to `sessionStorage` for cross-session resume. This is intentional:

- For cross-session resume (page refresh during login), use `context.toHash` and store it as a string
- The intent is designed for in-memory "redirect and resume" flows within a single session
- Attempting to serialize router references would be fragile and error-prone

### retry() Re-runs Guards

`retry()` navigates through the normal pipeline — guards run again. This is the safe default: if conditions haven't actually changed, the guard will block again rather than allowing unauthorized access.

`retrySkipGuards()` is the escape hatch for when the developer is certain the condition is resolved (e.g., user just completed login). This depends on Feature 02 (Guard Bypass).

### One-Shot Usage

Both `retry()` and `retrySkipGuards()` set `used = true` and are no-ops on subsequent calls. This prevents accidental double-navigation from UI event handlers.

## Types

```typescript
// In types.ts
export interface NavigationIntent {
    readonly toRoute: string;
    readonly toHash: string;
    readonly toArguments: Record<string, string>;
    readonly fromRoute: string;
    readonly fromHash: string;
    retry(): void;
    retrySkipGuards(): void;
    isStale(): boolean;
    readonly id: number;
}

// Updated GuardContext
export interface GuardContext {
    toRoute: string;
    toHash: string;
    toArguments: Record<string, string>;
    fromRoute: string;
    fromHash: string;
    transition: NavigationIntent;
}

// RouterInstance addition
_createNavigationIntent(toHash: string, toRoute: string, routeInfo: RouteInfo | null, generation: number): NavigationIntent;
```

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

- **Feature 02 (Guard Bypass)**: `retrySkipGuards()` requires `skipGuards` support in `navTo()`
- Without Feature 02, only `retry()` is available (guards always re-run)

## Compatibility

- Additive property on `GuardContext` — existing guards that don't use `transition` are unaffected
- No changes to guard return types or execution flow
- The `NavigationIntent` methods are thin wrappers around existing `navTo()`
