# Migrating from attachPatternMatched Guards

This guide covers converting an existing UI5 application from scattered `attachPatternMatched` guard logic to centralized guard registration with `ui5.guard.router.Router`.

For a full description of the problems with the `attachPatternMatched` approach, see [Problem Analysis, section 1.6](../reference/analysis.md#16-current-workaround).

## Before: The patternMatched workaround

Guard logic is duplicated in every protected controller:

```typescript
// ProtectedController.ts
onInit() {
    this.getRouter().getRoute("protected")
        .attachPatternMatched(this._onRouteMatched, this);
}

_onRouteMatched() {
    if (!this.isLoggedIn()) {
        this.getRouter().navTo("home");
        // The protected view already rendered (flash of unauthorized content).
        // A history entry was created for "protected".
    }
}
```

Each controller independently implements the same check. The target view renders before the redirect fires. Browser history accumulates entries for routes the user never committed to.

## After: Centralized guard registration

Guards are registered once in `Component.ts`. The router intercepts navigation before any view loads:

```typescript
// Component.ts
import type { GuardRouter } from "ui5/guard/router/types";

init() {
    super.init();
    const router = this.getRouter() as GuardRouter;

    router.addRouteGuard("protected", (context) => {
        const authModel = this.getModel("auth") as JSONModel;
        return authModel.getProperty("/isLoggedIn") === true ? true : "home";
    });

    router.initialize();
}
```

No view renders for `"protected"` unless the guard returns `true`. A redirect to `"home"` replaces the hash without polluting browser history.

## Step-by-step migration

1. **Add the library dependency.** Install `ui5-lib-guard-router` and configure `manifest.json` and `ui5.yaml` as described in the [library README setup section](../../packages/lib/README.md#setup).

2. **Set `routerClass` in `manifest.json`.** Change the router class from `sap.m.routing.Router` to `ui5.guard.router.Router`. All existing routes, targets, and patterns remain unchanged.

3. **Move guard logic from controllers to `Component.ts`.** For each controller that uses `attachPatternMatched` to check permissions, extract the condition into a guard function and register it with `addRouteGuard()` or `addGuard()`.

4. **Replace `navTo` redirects with guard return values.** Instead of calling `this.getRouter().navTo("home")` inside a controller callback, return `"home"` (or a `GuardRedirect` object) from the guard function.

5. **Remove `attachPatternMatched` guard handlers from controllers.** Delete the `attachPatternMatched` / `detachPatternMatched` calls and the `_onRouteMatched` methods that were serving as guards. Controllers that only existed for guard logic can be simplified or removed.

6. **Add leave guards if applicable.** If any controllers use `beforeunload` or manual dirty-state checks before navigation, convert these to `addLeaveGuard()` or `addRouteGuard()` with `{ beforeLeave: fn }`. See the [leave guard section](../../packages/lib/README.md#leave-guard-with-controller-lifecycle) in the library README.

## What stays the same

- All route definitions, patterns, and targets in `manifest.json` are unchanged.
- `navTo()` calls throughout the application continue to work. The guard pipeline intercepts at the router level, not the `navTo` call site.
- Views, controllers, and models require no changes beyond removing the old guard logic.
- The router is a drop-in replacement for `sap.m.routing.Router`. All native router methods (`navTo`, `getRoute`, `attachRouteMatched`, etc.) are inherited and behave identically.

## If UI5 ships native guards

The UI5 team has an open backlog item (CPOUI5FRAMEWORK-338) for native guard support. If a native `preventDefault()` mechanism ships on `attachBeforeRouteMatched`, the migration path from this library to the native API involves:

1. Replacing `routerClass` in `manifest.json` back to `sap.m.routing.Router`.
2. Converting `addRouteGuard` / `addGuard` calls to `attachBeforeRouteMatched` handlers.
3. Removing the `ui5-lib-guard-router` dependency.

See [Problem Analysis, section 3.8](../reference/analysis.md#38-migration-path) for the full rationale.
