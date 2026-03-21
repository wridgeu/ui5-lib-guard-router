# Alternative 11: Guard Bypass Mechanism (TanStack-Inspired)

## The Idea

TanStack Router provides an `ignoreBlocker` option that allows specific navigations to bypass registered blockers. This is useful for "Save & Navigate" patterns where you want to skip the "unsaved changes" confirmation.

```typescript
// TanStack Router
<Link to="/saved" ignoreBlocker>Save and Navigate</Link>
navigate({ to: '/dashboard', ignoreBlocker: true });
```

Currently, `ui5.guard.router` has no way to bypass guards for a specific navigation. Every `navTo()` call goes through the full guard pipeline (except redirects from guards themselves, which bypass via `_redirecting`).

---

## Use Cases

### 1. Save & Navigate

User has unsaved changes. A "Save" button saves the data and navigates away. The leave guard should not block this navigation.

### 2. Logout

A "Logout" button should navigate to the login page regardless of what guards are registered on the current or target route.

### 3. Emergency Navigation

Admin-triggered redirects (e.g., maintenance mode) should bypass all guards.

### 4. Programmatic Navigation After Guard Resolution

After a guard blocks and the user resolves the condition (e.g., logs in), the retry navigation should not be re-checked by the same guard.

---

## Design Approaches

### Approach A: navTo Option (Recommended)

Extend `navTo()` with a `skipGuards` option.

```typescript
// New API
router.navTo("home", {}, undefined, true, { skipGuards: true });

// Or with a cleaner overload
router.navToSkipGuards("home", {});
```

#### Implementation

```typescript
// In the Router extension
navTo(this: RouterInstance, routeName: string, parameters?: object,
      componentTargetInfo?: object, replace?: boolean,
      options?: { skipGuards?: boolean }): void {
    if (options?.skipGuards) {
        this._skipNextGuards = true;
    }
    return MobileRouter.prototype.navTo.apply(this, [routeName, parameters, componentTargetInfo, replace]);
},

parse(this: RouterInstance, newHash: string): void {
    if (this._skipNextGuards) {
        this._skipNextGuards = false;
        this._commitNavigation(newHash);
        return;
    }
    // ... existing guard pipeline ...
}
```

#### Pros

- **Simple**: One flag, minimal code changes
- **Familiar**: Similar to TanStack's `ignoreBlocker`
- **Targeted**: Only affects the specific navigation, not a global setting

#### Cons

- **Only covers navTo()**: Browser back/forward and URL changes can't use this
- **Flag leak risk**: If `navTo` doesn't trigger `parse` synchronously (edge case), the flag could leak
- **Override of navTo()**: Requires overriding another method beyond `parse()`

---

### Approach B: Temporary Guard Suspension

Temporarily disable all guards, navigate, re-enable.

```typescript
// API
router.suspendGuards();
router.navTo("home");
router.resumeGuards();

// Or with a scoped helper
router.withoutGuards(() => {
	router.navTo("home");
});
```

#### Implementation

```typescript
suspendGuards(this: RouterInstance): void {
    this._guardsSuspended = true;
},

resumeGuards(this: RouterInstance): void {
    this._guardsSuspended = false;
},

withoutGuards(this: RouterInstance, fn: () => void): void {
    this._guardsSuspended = true;
    try {
        fn();
    } finally {
        this._guardsSuspended = false;
    }
},

parse(this: RouterInstance, newHash: string): void {
    if (this._guardsSuspended) {
        this._commitNavigation(newHash);
        return;
    }
    // ... existing guard pipeline ...
}
```

#### Pros

- **Covers all navigation**: Even `HashChanger.setHash()` or URL changes during suspension
- **Clean API**: `withoutGuards()` is self-closing, no flag leak risk
- **No navTo override needed**: Works purely in `parse()`

#### Cons

- **Dangerous**: If `resumeGuards` is forgotten, all guards are permanently disabled
- **Too broad**: Suspends ALL guards, not just specific ones
- **Timing issues**: Async operations between suspend/resume could allow unguarded navigations

---

### Approach C: Guard-Level Bypass via Context

Let guards themselves decide whether to bypass based on context.

```typescript
// Guard checks a "bypass token" in the model
router.addGuard((context) => {
	const auth = component.getModel("auth") as JSONModel;

	// Skip guard if bypass token is set
	if (auth.getProperty("/bypassGuards")) {
		return true;
	}

	if (!auth.getProperty("/isLoggedIn")) {
		return "login";
	}
	return true;
});

// Usage: set token, navigate, clear token
authModel.setProperty("/bypassGuards", true);
router.navTo("home");
authModel.setProperty("/bypassGuards", false);
```

#### Pros

- **No router changes**: Pure application-level pattern
- **Granular**: Each guard independently decides whether to bypass
- **Already possible**: Works with current API

#### Cons

- **Boilerplate**: Every guard needs bypass-checking logic
- **Error-prone**: Forgetting to clear the flag is dangerous
- **Not a library feature**: Just a convention

---

## Recommended Approach

**Approach A** for its simplicity and targeted scope. Combined with the transition object's `retrySkipGuards()` from [Alternative 9](./09-transition-object.md), this covers the major bypass scenarios:

| Scenario          | Solution                                                    |
| ----------------- | ----------------------------------------------------------- |
| Save & Navigate   | `navTo("home", {}, undefined, true, { skipGuards: true })`  |
| Retry after login | `transition.retrySkipGuards()`                              |
| Logout            | `navTo("login", {}, undefined, true, { skipGuards: true })` |
| Guard self-bypass | Guard returns `true` based on application state             |

## References

- [TanStack Router ignoreBlocker](https://tanstack.com/router/v1/docs/framework/react/guide/navigation-blocking)
- [TanStack Router navigate API](https://tanstack.com/router/latest/docs/framework/react/guide/navigation-blocking)
