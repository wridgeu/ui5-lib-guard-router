# Alternative 9: Transition Object (Ember-Inspired)

## The Idea

Ember.js has a unique concept among SPA frameworks: the **transition object**. When a navigation occurs, Ember creates a transition that can be:

- **Aborted**: `transition.abort()` cancels the navigation
- **Retried**: `transition.retry()` re-attempts the navigation later
- **Stored**: Save the transition in a variable, redirect elsewhere, then retry it

This enables powerful patterns that no other framework supports natively:

```javascript
// Ember: redirect to login, then resume original navigation after login
beforeModel(transition) {
    if (!this.authService.isLoggedIn) {
        this.loginController.previousTransition = transition;
        this.router.transitionTo('login');
    }
}

// After login succeeds:
login() {
    this.previousTransition.retry();  // Go to the originally requested page
}
```

This document explores how to bring this concept to UI5.

---

## Current State vs. Desired State

### Current: Guard Returns

```typescript
// Current: guards return a static result
router.addGuard((context) => {
	if (!isLoggedIn()) {
		return "login"; // redirect -- but the original destination is lost
	}
	return true;
});
```

**Problem**: When a guard redirects to "login", the original destination (`context.toRoute`, `context.toHash`) is available inside the guard but not easily passed to the login page. Developers must manually encode it (e.g., via query parameters or a global variable).

### Desired: Transition Object

```typescript
// Desired: guards receive a transition they can store and retry
router.addGuard((context) => {
	if (!isLoggedIn()) {
		// Store the transition for later
		authModel.setProperty("/pendingTransition", context.transition);
		return "login";
	}
	return true;
});

// In the login controller, after successful login:
const transition = authModel.getProperty("/pendingTransition");
if (transition && !transition.isStale()) {
	transition.retry();
	authModel.setProperty("/pendingTransition", null);
} else {
	router.navTo("home");
}
```

---

## API Design

### The NavigationIntent Interface

```typescript
interface NavigationIntent {
	/** The destination route name */
	readonly toRoute: string;

	/** The destination hash */
	readonly toHash: string;

	/** Parsed route arguments */
	readonly toArguments: Record<string, string>;

	/** The route being left */
	readonly fromRoute: string;

	/** The hash being left */
	readonly fromHash: string;

	/**
	 * Re-attempt this navigation. The navigation will go through
	 * the normal guard pipeline again (guards may block it again).
	 *
	 * No-op if the transition is stale.
	 */
	retry(): void;

	/**
	 * Re-attempt this navigation, bypassing all guards.
	 * Use with caution -- only after the guard condition has been resolved
	 * (e.g., user is now authenticated).
	 *
	 * No-op if the transition is stale.
	 */
	retrySkipGuards(): void;

	/**
	 * Whether this transition is outdated. A transition becomes stale when:
	 * - Another navigation has occurred since this transition was created
	 * - The router has been destroyed
	 * - retry() or retrySkipGuards() was already called
	 */
	isStale(): boolean;

	/**
	 * Monotonic ID for this transition. Can be used to compare
	 * which transition is newer.
	 */
	readonly id: number;
}
```

### Integration with GuardContext

```typescript
// Extended guard context
interface GuardContext {
	toRoute: string;
	toHash: string;
	toArguments: Record<string, string>;
	fromRoute: string;
	fromHash: string;
	transition: NavigationIntent; // ← NEW
}
```

### Backward Compatibility

Guards that don't use `context.transition` continue to work exactly as before. The transition object is simply an additional property on the context.

---

## Implementation

### Creating NavigationIntent in parse()

```typescript
parse(this: RouterInstance, newHash: string): void {
    // ... existing checks ...

    const generation = ++this._parseGeneration;
    const routeInfo = this.getRouteInfoByHash(newHash);
    const toRoute = routeInfo ? routeInfo.name : "";

    // Create a NavigationIntent for this parse
    const transition = this._createTransition(newHash, toRoute, routeInfo, generation);

    const context: GuardContext = {
        toRoute,
        toHash: newHash,
        toArguments: (routeInfo ? routeInfo.arguments : {}) as Record<string, string>,
        fromRoute: this._currentRoute,
        fromHash: this._currentHash ?? "",
        transition,  // ← attach to context
    };

    // ... rest of guard pipeline (unchanged) ...
}
```

### NavigationIntent Implementation

```typescript
_createTransition(
    this: RouterInstance,
    hash: string,
    route: string,
    routeInfo: RouteInfo | undefined,
    generation: number
): NavigationIntent {
    let used = false;
    const router = this;

    return {
        toRoute: route,
        toHash: hash,
        toArguments: (routeInfo ? routeInfo.arguments : {}) as Record<string, string>,
        fromRoute: this._currentRoute,
        fromHash: this._currentHash ?? "",
        id: generation,

        isStale(): boolean {
            return used || router._parseGeneration !== generation;
        },

        retry(): void {
            if (this.isStale()) {
                Log.warning("Stale transition retry ignored", hash, LOG_COMPONENT);
                return;
            }
            used = true;
            // Navigate to the original destination (guards will run again)
            router.navTo(route, (routeInfo ? routeInfo.arguments : {}), undefined, true);
        },

        retrySkipGuards(): void {
            if (this.isStale()) {
                Log.warning("Stale transition retry ignored", hash, LOG_COMPONENT);
                return;
            }
            used = true;
            // Directly commit the navigation, bypassing guards
            router._redirecting = true;
            try {
                router.navTo(route, (routeInfo ? routeInfo.arguments : {}), undefined, true);
            } finally {
                router._redirecting = false;
            }
        }
    };
}
```

---

## Usage Patterns

### Pattern 1: Auth Guard with Retry (The "Ember Pattern")

```typescript
// In Component.ts
const router = this.getRouter() as RouterInstance;

router.addGuard((context) => {
	const auth = this.getModel("auth") as JSONModel;
	if (context.toRoute !== "login" && !auth.getProperty("/isLoggedIn")) {
		// Store the transition for post-login retry
		auth.setProperty("/pendingTransition", context.transition);
		return "login";
	}
	return true;
});
```

```typescript
// In Login.controller.ts
onLoginSuccess() {
    const auth = this.getOwnerComponent().getModel("auth") as JSONModel;
    const transition = auth.getProperty("/pendingTransition") as NavigationIntent | null;
    auth.setProperty("/pendingTransition", null);

    if (transition && !transition.isStale()) {
        transition.retrySkipGuards();  // User is now logged in, skip guard re-check
    } else {
        (this.getOwnerComponent().getRouter() as RouterInstance).navTo("home");
    }
}
```

### Pattern 2: Unsaved Changes with "Save First"

```typescript
// Leave guard that offers to save first
router.addLeaveGuard("editOrder", async (context) => {
	if (!formIsDirty()) return true;

	return new Promise((resolve) => {
		MessageBox.show("You have unsaved changes.", {
			actions: ["Save & Leave", "Discard", "Cancel"],
			onClose: async (action) => {
				if (action === "Save & Leave") {
					await saveForm();
					resolve(true); // Allow navigation
				} else if (action === "Discard") {
					resolve(true); // Allow navigation
				} else {
					resolve(false); // Block navigation
				}
			},
		});
	});
});
```

### Pattern 3: Deep Link Resume After Login

```typescript
// User bookmarks #/orders/12345/edit
// They're not logged in → guard redirects to login
// After login → they land on the edit page they originally wanted

router.addGuard((context) => {
	if (!isLoggedIn() && context.toRoute !== "login") {
		// Store in sessionStorage so it survives page refresh
		sessionStorage.setItem("pendingNavHash", context.toHash);
		return "login";
	}
	return true;
});

// After login:
const pendingHash = sessionStorage.getItem("pendingNavHash");
if (pendingHash) {
	sessionStorage.removeItem("pendingNavHash");
	window.location.hash = "#/" + pendingHash;
} else {
	router.navTo("home");
}
```

Note: This last pattern doesn't even need the transition object; it uses the hash string directly. The transition object is most valuable for in-memory retry within the same page session.

---

## Staleness Handling

The transition's `isStale()` check is critical for correctness:

```
1. User navigates to #/admin → guard stores transition, redirects to #/login
2. User navigates to #/settings (from login page, not logging in)
3. _parseGeneration is now incremented
4. User logs in and code calls transition.retry()
5. isStale() returns true → retry is a no-op
   (The user navigated away from login; retrying #/admin would be surprising)
```

Without staleness checks, stored transitions could cause ghost navigations.

---

## Design Decisions

### Should retry() re-run guards?

**`retry()` runs guards again.** The user's auth state may have changed, or the guard condition may have evolved. Running guards ensures safety.

**`retrySkipGuards()` bypasses guards.** For the common case where the guard condition has just been resolved (e.g., user just logged in), re-running guards would be redundant. This is an intentional escape hatch.

### Should the transition be serializable?

**No.** The transition holds a closure over the router instance. It's designed for in-memory use within a single page session. For cross-session resume (e.g., page refresh), use the hash string from `context.toHash` and store it in `sessionStorage`.

### How does this interact with async guards?

The transition is created at the start of `parse()` and attached to the context. If an async guard stores the transition and later calls `retry()`, the staleness check via `_parseGeneration` ensures safety.

---

## Comparison with Ember

| Aspect               | Ember                         | Proposed UI5 Design                               |
| -------------------- | ----------------------------- | ------------------------------------------------- |
| Object name          | `Transition`                  | `NavigationIntent`                                |
| Abort                | `transition.abort()`          | Return `false` from guard                         |
| Retry                | `transition.retry()`          | `transition.retry()`                              |
| Skip guards on retry | Not supported                 | `transition.retrySkipGuards()`                    |
| Staleness check      | Manual (developer must track) | Built-in `isStale()`                              |
| Storage              | In controller property        | In model, variable, or sessionStorage (hash only) |
| Created by           | Framework on every transition | Router on every `parse()`                         |

## Impact on Existing Code

- **GuardContext** gains a `transition` property (additive, non-breaking)
- **No changes** to guard return value semantics
- **No changes** to `parse()` control flow
- Existing guards that ignore `context.transition` work identically

## References

- [Ember.js Preventing and Retrying Transitions](https://guides.emberjs.com/release/routing/preventing-and-retrying-transitions/)
- [Ember Route Hooks - A Complete Look](https://alexdiliberto.com/posts/ember-route-hooks-a-complete-look/)
