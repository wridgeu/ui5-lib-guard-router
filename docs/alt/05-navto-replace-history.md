# Alternative 5: navTo with bReplace (History-Only Fix)

## Approach

For the specific problem of browser back navigation to invalid states (login screen after login), the simplest fix is using `navTo`'s fourth parameter `bReplace: true`.

```typescript
// Before (creates history entry):
oRouter.navTo("dashboard");

// After (replaces history, no back entry):
oRouter.navTo("dashboard", {}, undefined, true);
```

From the [UI5 API docs](https://ui5.sap.com/#/api/sap.ui.core.routing.Router%23methods/navTo):

> If set to `true`, the hash is replaced, and there will be **no entry in the browser history**.

## How It Works

1. Standard `navTo("route")` calls `hashChanger.setHash()`, creating a new history entry
2. `navTo("route", {}, undefined, true)` calls `hashChanger.replaceHash()`, replacing the current entry
3. The browser's back button skips over replaced entries entirely

## Example: Login Flow

```typescript
private _navigateBasedOnState(isLoggedIn: boolean): void {
    const router = this.getRouter();
    if (isLoggedIn) {
        // Replace: user can't "back" to login screen
        router.navTo("dashboard", {}, undefined, true);
    } else {
        // Replace: user can't "back" to dashboard
        router.navTo("notLoggedIn", {}, undefined, true);
    }
}
```

## Pros

- **Minimal change**: Literally changing one argument in existing `navTo()` calls
- **No dependencies**: Uses standard UI5 API
- **No framework extension**: No custom router class needed
- **Immediate result**: Fixes the specific "back to login screen" problem
- **Well-documented API**: `bReplace` is a public, stable parameter

## Cons

- **Only fixes history, not navigation interception**: Users can still type `#/protected` in the URL bar and see the protected view.
- **No guard mechanism**: You still need controller-level checks for permission-based routing.
- **Scattered application**: Every `navTo` call that should not create history must remember to pass `true`.
- **No browser back/forward protection**: If a user bookmarks `#/protected` and opens it directly, no guard prevents the view from loading.
- **Developer discipline required**: Forgetting `bReplace: true` on a single `navTo` call reintroduces the history pollution.

## When to Use

- The ONLY problem is browser back/forward reaching an invalid state
- You don't need per-route permission checks
- You want a 2-minute fix with zero risk
- Combined with other approaches as an immediate stopgap

## Comparison with This Repository's Approach

| Aspect                | `navTo(bReplace)`       | `ui5.ext.routing`                |
| --------------------- | ----------------------- | -------------------------------- |
| History pollution     | Fixed                   | Fixed                            |
| URL bar protection    | No                      | Yes (guards run on hash change)  |
| Browser back/forward  | Fixed (for navTo calls) | Fixed (for all navigation paths) |
| Per-route guards      | No                      | Yes                              |
| Implementation effort | Minutes                 | Hours (initial setup)            |
| Ongoing maintenance   | Remember on every navTo | Centralized                      |
| Async conditions      | No                      | Yes                              |

## Combining with This Repository

This approach is complementary. Even with `ui5.ext.routing`, guards use `navTo(..., true)` internally for redirects. The library's `_redirect` method always passes `bReplace: true`:

```typescript
// Router.ts line 279
this.navTo(result, {}, {}, true);
```

For application code, using `bReplace: true` in explicit `navTo` calls is still good practice alongside router guards, as it ensures clean history even for non-guarded navigations like login state transitions.

## References

- [UI5 API: Router.navTo](https://ui5.sap.com/#/api/sap.ui.core.routing.Router%23methods/navTo)
- [wridgeu/ui5-poc-ewm-one-login#1](https://github.com/wridgeu/ui5-poc-ewm-one-login/issues/1): Approach C1
