# Alternative 1: Event-Based Guard (attachPatternMatched / attachBeforeRouteMatched)

## Approach

Use UI5's existing routing events to detect navigation and redirect when unauthorized.

```typescript
// BaseController.ts
onInit(): void {
    this.getRouter().getRoute(this.getRouteName())
        .attachPatternMatched(this._onPatternMatched, this);
}

_onPatternMatched(): void {
    if (!this.isAuthorized()) {
        this.getRouter().navTo("login");
    }
}
```

Or at the component level using `attachBeforeRouteMatched`:

```typescript
// Component.ts
init(): void {
    super.init();
    this.getRouter().attachBeforeRouteMatched((event) => {
        const routeName = event.getParameter("name");
        if (routeName === "protected" && !this.isLoggedIn()) {
            // Too late -- can't prevent, only redirect after
            this.getRouter().navTo("login");
        }
    });
    this.getRouter().initialize();
}
```

## How It Works

1. Router matches the route and fires events
2. Event handler checks conditions
3. If unauthorized, calls `navTo()` to redirect

## Pros

- Uses only public, documented UI5 APIs
- No framework extension or override needed
- Works with any UI5 version
- Easy to understand for developers familiar with UI5 events

## Cons

- **Flash of unauthorized content**: The target view is already instantiated and rendered by the time the event fires. Users see the protected page for a split second before being redirected.
- **Polluted browser history**: Both the original navigation and the redirect create history entries. The back button becomes unpredictable.
- **Scattered logic**: Every protected controller needs its own guard check. Easy to miss one.
- **`attachBeforeRouteMatched` has no `preventDefault()`**: Despite the name, you cannot actually prevent the route from matching. The event is informational only.
- **`onInit` only fires once**: If using `onInit` for checks, returning to the same view instance won't re-trigger the check (must use `attachPatternMatched` instead).

## When to Use

- Quick prototype or MVP where a brief flash is acceptable
- When you cannot add library dependencies
- When guard conditions are always synchronous and fast

## Comparison with This Repository's Approach

| Aspect                 | Event-Based                  | `ui5.guard.router`         |
| ---------------------- | ---------------------------- | -------------------------- |
| View creation on block | Yes (flash)                  | No                         |
| History entry on block | Yes                          | No                         |
| Guard location         | Each controller or component | Centralized in Component   |
| Async support          | No (event is sync)           | Yes                        |
| Browser back coverage  | Must handle separately       | Automatic (parse override) |
| Direct URL coverage    | Must handle separately       | Automatic                  |

## References

- [SAP/openui5#3411 comment](https://github.com/SAP/openui5/issues/3411#issuecomment-999067048): UI5 team recommends this as current workaround
- [SAP/openui5#1326](https://github.com/SAP/openui5/issues/1326): Original "protect a route" request with `attachPatternMatched` solution
- [DSAG UI5 Best Practice: Routing](https://1dsag.github.io/UI5-Best-Practice/routing/)
