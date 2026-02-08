# Feature: Guard Bypass

## Problem

Every `navTo()` call goes through the full guard pipeline (except redirects via `_redirecting`). There is no way to programmatically skip guards for a specific navigation. This becomes critical when leave guards (Feature 01) are added:

- **Save & Navigate**: User saves a form, then navigates away. The leave guard shouldn't fire because the data is already saved.
- **Logout**: Navigate to login regardless of any guards. The user explicitly wants to leave.
- **Admin redirects**: System-initiated navigation that shouldn't be subject to user-facing guards.
- **Transition retry**: After resolving a guard condition (e.g., logging in), retry the original navigation without re-evaluating guards (Feature 03).

## Proposed API

### Option A: navTo Options Parameter (Recommended)

```typescript
// Extend navTo with an options parameter
router.navTo("home", {}, undefined, true, { skipGuards: true });
```

### Option B: Dedicated Method

```typescript
// Convenience method that sets skipGuards internally
router.navToSkipGuards("home", {});
// Equivalent to: router.navTo("home", {}, undefined, false, { skipGuards: true })
```

**Recommendation**: Implement Option A (navTo options) as the mechanism. Option B can be added as sugar if the verbose signature is a pain point.

## Usage Examples

### Save & Navigate

```typescript
// In controller
async onSave() {
    await this.saveFormData();
    // Form is saved — skip the leave guard that checks for dirty state
    router.navTo("orderList", {}, undefined, false, { skipGuards: true });
}
```

### Logout

```typescript
onLogout() {
    authModel.setProperty("/isLoggedIn", false);
    // Skip all guards — user explicitly wants to leave
    router.navTo("login", {}, undefined, true, { skipGuards: true });
}
```

### With Transition Object (Feature 03)

```typescript
// After login, resume the original navigation
const transition = authModel.getProperty("/pendingTransition");
if (transition && !transition.isStale()) {
	transition.retrySkipGuards(); // Uses skipGuards internally
}
```

## Implementation Sketch

### navTo Override

```typescript
navTo(
    this: RouterInstance,
    routeName: string,
    parameters?: Record<string, string>,
    componentTargetInfo?: Record<string, ComponentTargetParameters>,
    replace?: boolean,
    options?: NavToOptions
): void {
    if (options?.skipGuards) {
        this._skipNextGuards = true;
    }
    MobileRouter.prototype.navTo.apply(this, [routeName, parameters, componentTargetInfo, replace]);
}
```

### parse() Check

```typescript
parse(this: RouterInstance, newHash: string): void {
    if (this._suppressNextParse) { /* ... existing ... */ }

    // Skip guards when explicitly requested (e.g., Save & Navigate)
    if (this._skipNextGuards) {
        this._skipNextGuards = false;
        this._commitNavigation(newHash);
        return;
    }

    if (this._redirecting) { /* ... existing ... */ }
    // ... rest of guard pipeline ...
}
```

### Flag Safety

The `_skipNextGuards` flag follows the same pattern as `_suppressNextParse`:

- Set immediately before the call that triggers `parse()`
- Consumed (reset to `false`) at the start of `parse()`
- `navTo()` triggers `parse()` synchronously via HashChanger, so the flag doesn't leak

**Edge case**: If `navTo()` doesn't change the hash (navigating to the same route), `parse()` may not fire. But `_skipNextGuards` is reset at the top of `parse()`, and same-hash navigations are already deduped. The flag would leak to the _next_ navigation. Mitigation: reset the flag after `navTo()` returns, similar to `_suppressNextParse`:

```typescript
navTo(this: RouterInstance, ..., options?: NavToOptions): void {
    if (options?.skipGuards) {
        this._skipNextGuards = true;
    }
    MobileRouter.prototype.navTo.apply(this, [routeName, parameters, componentTargetInfo, replace]);
    // Reset if navTo didn't trigger parse (same hash, no-op)
    if (this._skipNextGuards) {
        this._skipNextGuards = false;
    }
}
```

## Types

```typescript
interface NavToOptions {
    skipGuards?: boolean;
}

// RouterInstance additions
_skipNextGuards: boolean;
navTo(
    routeName: string,
    parameters?: Record<string, string>,
    componentTargetInfo?: Record<string, ComponentTargetParameters>,
    replace?: boolean,
    options?: NavToOptions
): void;
```

## Scope & Limitations

- **Only affects `navTo()` navigations**: Browser back/forward and direct URL entry always run guards. This is intentional — `skipGuards` is for programmatic navigation where the developer has already validated the transition.
- **Does not affect leave guards and enter guards separately**: `skipGuards` skips the entire pipeline. A more granular `{ skipLeaveGuards: true, skipEnterGuards: false }` could be added later if needed.
- **Single navigation**: The flag is consumed immediately. It doesn't persist across navigations.

## Test Cases

1. `navTo` with `skipGuards: true` bypasses global guards
2. `navTo` with `skipGuards: true` bypasses route-specific guards
3. `navTo` with `skipGuards: true` bypasses leave guards (Feature 01)
4. `navTo` without `skipGuards` still runs guards (no regression)
5. Flag doesn't leak to subsequent navigations
6. Flag is cleaned up if `navTo` doesn't trigger `parse()` (same hash)
7. `skipGuards` works with `replace: true`
8. `skipGuards` works with route parameters

## Compatibility

- Backward compatible: existing `navTo()` calls without the options parameter behave identically
- The `options` parameter is the last argument, so existing positional args are unaffected
- No changes to hash change or direct URL navigation behavior
