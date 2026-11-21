# Migrating from attachPatternMatched Guards

This guide moves guard logic out of `attachPatternMatched` handlers and into guards registered on `ui5.guard.router.Router`. The problems with the old approach are in [Problem Analysis, section 1.6](../reference/analysis.md#16-current-workaround).

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

Every controller repeats the check. The view renders before the redirect. The history keeps entries for routes the user was sent away from.

## After: Centralized guard registration

Register the guard once in `Component.ts`. It runs before any view loads:

```typescript
// Component.ts
import UIComponent from "sap/ui/core/UIComponent";
import type JSONModel from "sap/ui/model/json/JSONModel";
import type { GuardRouter } from "ui5/guard/router/types";

export default class Component extends UIComponent {
	static metadata = {
		manifest: "json",
		interfaces: ["sap.ui.core.IAsyncContentCreation"],
	};

	init(): void {
		super.init();
		const router = this.getRouter() as GuardRouter;

		router.addRouteGuard("protected", () => {
			const authModel = this.getModel("auth") as JSONModel;
			return authModel.getProperty("/isLoggedIn") === true ? true : "home";
		});

		router.initialize();
	}
}
```

The `"protected"` view renders only when the guard returns `true`. A redirect to `"home"` keeps `"protected"` out of the browser history (see [Browser history](../../packages/lib/README.md#browser-history)).

## Step-by-step migration

1. **Add the library.** Follow [Install](../../packages/lib/README.md#install), [Serving the library](../../packages/lib/README.md#serving-the-library) and [Setup](../../packages/lib/README.md#setup) in the library README.

2. **Set `routerClass` in `manifest.json`** from `sap.m.routing.Router` to `ui5.guard.router.Router`. Routes, targets and patterns stay as they are.

3. **Move the checks to `Component.ts`.** Turn each `attachPatternMatched` permission check into a guard and register it with `addRouteGuard()` or `addGuard()`.

4. **Return redirects instead of calling `navTo`.** Return `"home"` or a `GuardRedirect` object from the guard.

5. **Delete the old handlers.** Remove the `attachPatternMatched` / `detachPatternMatched` calls and the `_onRouteMatched` methods that acted as guards.

6. **Convert dirty-state checks to leave guards** with `addLeaveGuard()` or `addRouteGuard(route, { beforeLeave: fn })`. See [Leave guard with controller lifecycle](../../packages/lib/README.md#leave-guard-with-controller-lifecycle).

## What stays the same

- Routes, patterns and targets in `manifest.json`.
- Views, controllers and models, apart from the removed guard logic.
- Native router methods such as `getRoute` and `attachRouteMatched`.
- `navTo()` calls. `navTo()` keeps its native signatures and, with no guards registered, behaves like the native one. With guards it runs them before it changes the hash, so a blocked call never changes it.

## If UI5 ships native guards

UI5 has an open backlog item for native guards (CPOUI5FRAMEWORK-338). If `attachBeforeRouteMatched` gets a `preventDefault()`, moving to it means:

1. Setting `routerClass` back to `sap.m.routing.Router`.
2. Turning `addRouteGuard` / `addGuard` calls into `attachBeforeRouteMatched` handlers.
3. Removing the `ui5-lib-guard-router` dependency.

See [Problem Analysis, section 3.8](../reference/analysis.md#38-migration-path).
