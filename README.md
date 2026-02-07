# ui5-ext-routing

UI5 Router extension with async navigation guards. Drop-in replacement for `sap.m.routing.Router` that intercepts navigation **before** route matching, target loading, or view creation -- preventing unauthorized content flashes.

## Why

UI5's native router has no way to block or redirect navigation before views are displayed. Developers resort to scattering guard logic across controller `attachPatternMatched` callbacks, which causes a flash of unauthorized content and pollutes browser history. See [docs/problem-statement.md](docs/problem-statement.md) for the full background.

## How it works

The router overrides `parse()` -- the single method through which all navigation flows (programmatic `navTo`, browser back/forward, direct URL changes). Guards run before any route matching begins. See [docs/implementation-approaches.md](docs/implementation-approaches.md) for the design rationale.

## Monorepo structure

```
packages/
  lib/          ui5.ext.routing library (the router + types)
  demo-app/     Demo app with auth guards (home, protected, forbidden routes)
docs/           Design documents
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

### Type checking

```bash
npm run typecheck
```

### Linting

```bash
npm run lint
```

### Run tests

```bash
# All tests (QUnit + E2E)
npm test

# QUnit unit tests only (lib)
npm run test:qunit

# E2E tests only (demo-app, requires demo-app server running)
npm run test:e2e
```

**Note:** E2E tests require the demo-app to be running on port 8080. Start it with `npm start` in a separate terminal before running `npm run test:e2e`.

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

export default class Component extends UIComponent {
  init(): void {
    super.init();
    const router = this.getRouter() as any;

    // Global guard: runs for every navigation
    router.addGuard((context) => {
      if (context.toRoute === "admin" && !isAdmin()) {
        return "home"; // redirect to home
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
      return hasAccess ? true : false; // false = block (stay on current route)
    });

    router.initialize();
  }
}
```

### Guard return values

| Return value | Effect |
|---|---|
| `true` | Allow navigation |
| `false` | Block navigation (stay on current route, no history entry) |
| `"routeName"` | Redirect to named route (replaces history, no extra entry) |
| `{ route: "name", parameters: { id: "42" } }` | Redirect with route parameters |

## API

- `addGuard(fn)` -- Register a global guard (runs for every navigation)
- `removeGuard(fn)` -- Remove a global guard
- `addRouteGuard(routeName, fn)` -- Register a guard for a specific route
- `removeRouteGuard(routeName, fn)` -- Remove a route-specific guard

All methods return `this` for chaining.

## License

Apache-2.0
