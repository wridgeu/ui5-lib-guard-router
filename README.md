# ui5.ext.routing

UI5 Router extension with async navigation guards. Drop-in replacement for `sap.m.routing.Router` that intercepts navigation **before** route matching, target loading, or view creation -- preventing unauthorized content flashes.

## Why

UI5's native router has no way to block or redirect navigation before views are displayed. Developers resort to scattering guard logic across controller `attachPatternMatched` callbacks, which causes a flash of unauthorized content and pollutes browser history.

## How it works

The router overrides `parse()` -- the single method through which all navigation flows (programmatic `navTo`, browser back/forward, direct URL changes). Guards run before any route matching begins.

The pipeline stays **synchronous when all guards return plain values** and only falls back to async when a guard returns a Promise. A generation counter discards stale async results when navigations overlap.

## Monorepo structure

```
packages/
  lib/          ui5.ext.routing library (Router + types)
  demo-app/     Demo app with auth guards (home, protected, forbidden routes)
```

## Prerequisites

- Node.js >= 18
- npm >= 9 (workspaces support)

## Getting started

```bash
npm install
```

### Run the demo app

```bash
npm start
```

Opens the demo app at `http://localhost:8080/index.html`. Toggle login state and navigate between routes to see guards in action.

### Run tests

Both QUnit and E2E tests require the demo-app server running on port 8080:

```bash
# Terminal 1: start the server
npm start

# Terminal 2: run all tests
npm test

# Or individually
npm run test:qunit    # 76 QUnit tests (Router + NativeRouterCompat)
npm run test:e2e      # 24 E2E tests across 8 spec files
```

### Type checking and linting

```bash
npm run typecheck
npm run lint
```

### Build the library

```bash
npm run build
```

## Usage

### 1. Add the library dependency

In your app's `package.json`:

```json
{
  "dependencies": {
    "ui5-ext-routing": "*"
  }
}
```

### 2. Set the router class in manifest.json

```json
{
  "sap.ui5": {
    "dependencies": {
      "libs": {
        "ui5.ext.routing": {}
      }
    },
    "routing": {
      "config": {
        "routerClass": "ui5.ext.routing.Router"
      }
    }
  }
}
```

### 3. Register guards in your Component

```typescript
import UIComponent from "sap/ui/core/UIComponent";
import type { RouterInstance } from "ui5/ext/routing/types";

export default class Component extends UIComponent {
  static metadata = {
    manifest: "json",
    interfaces: ["sap.ui.core.IAsyncContentCreation"]
  };

  init(): void {
    super.init();
    const router = this.getRouter() as unknown as RouterInstance;

    // Global guard: runs for every navigation
    router.addGuard((context) => {
      if (context.toRoute === "admin" && !isAdmin()) {
        return "home"; // redirect
      }
      return true; // allow
    });

    // Route-specific guard
    router.addRouteGuard("protected", () => {
      return isLoggedIn() ? true : "login";
    });

    // Async guards are supported
    router.addRouteGuard("dashboard", async (context) => {
      const hasAccess = await checkPermissions(context.toRoute);
      return hasAccess ? true : false;
    });

    router.initialize();
  }
}
```

## Guard return values

| Return value | Effect |
|---|---|
| `true` | Allow navigation |
| `false` | Block navigation (stay on current route, no history entry) |
| `"routeName"` | Redirect to named route (replaces history, no extra entry) |
| `{ route: "name", parameters: { id: "42" } }` | Redirect with route parameters |
| anything else (`null`, `undefined`, numbers) | Treated as block |

Only strict `true` allows navigation. This prevents accidental allows from truthy coercion.

## Guard context

Every guard receives a `GuardContext` with navigation details:

| Property | Type | Description |
|---|---|---|
| `toRoute` | `string` | Target route name (empty if no match) |
| `toHash` | `string` | Raw hash being navigated to |
| `toArguments` | `Record<string, string>` | Parsed route parameters |
| `fromRoute` | `string` | Current route name (empty on first nav) |
| `fromHash` | `string` | Current hash |

## Guard execution order

1. **Global guards** run first, in registration order
2. **Route-specific guards** run next, in registration order
3. The pipeline **short-circuits** at the first non-`true` result

## API

| Method | Description |
|---|---|
| `addGuard(fn)` | Register a global guard (runs for every navigation) |
| `removeGuard(fn)` | Remove a global guard |
| `addRouteGuard(routeName, fn)` | Register a guard for a specific route |
| `removeRouteGuard(routeName, fn)` | Remove a route-specific guard |

All methods return `this` for chaining. Guards can be added or removed at any time during the router's lifetime.

## License

Apache-2.0
