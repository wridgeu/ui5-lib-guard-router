<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License"></a>
  <a href="https://openui5.org/"><img src="https://img.shields.io/badge/OpenUI5-1.144.0-green.svg" alt="UI5"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-blue.svg" alt="TypeScript"></a>
</p>

UI5 Router extension with async navigation guards. Drop-in replacement for `sap.m.routing.Router` that intercepts navigation **before** route matching, target loading, or view creation, preventing unauthorized content flashes.

> Born from [SAP/openui5#3411](https://github.com/SAP/openui5/issues/3411), an open request since 2021 for native navigation guard support in UI5. Track the UI5 team's progress there.

## Why

UI5's native router has no way to block or redirect navigation before views are displayed. Developers resort to scattering guard logic across `attachPatternMatched` callbacks, which:

- Causes a **flash of unauthorized content** while the check runs
- **Pollutes browser history** with entries the user shouldn't have visited
- Leads to **duplicated guard logic** across controllers

This library solves all three by intercepting at the router level, before any route matching or view creation begins.

## How it works

The library extends [`sap.m.routing.Router`](https://sdk.openui5.org/api/sap.m.routing.Router) (the standard router for `sap.m` applications) and overrides `parse()`, the single method through which all navigation flows (programmatic `navTo`, browser back/forward, direct URL changes). Guards run before any route matching, target loading, or view creation begins.

Because it extends the mobile router directly, all existing `sap.m.routing.Router` behavior (Targets, route events, `navTo`, back navigation) works unchanged.

The guard pipeline stays **synchronous when all guards return plain values** and only falls back to async when a guard returns a Promise. A generation counter discards stale async results when navigations overlap, and an `AbortSignal` is passed to each guard so async work (like `fetch`) can be cancelled early.

## Setup

> [!NOTE]
> This repository is a **proof of concept**, not a published npm package. It demonstrates that async navigation guards are feasible in UI5 today, but it is not actively maintained as a consumable library. Feel free to use the source as a reference or starting point for your own implementation.

### 1. Install the library

```bash
npm install ui5-ext-routing
```

### 2. Configure manifest.json

Add the library dependency and set the router class:

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

That's it. All your existing routes, targets, and navigation calls continue to work; the extended router is fully backward-compatible.

### 3. Register guards in your Component

```typescript
import UIComponent from "sap/ui/core/UIComponent";
import type { GuardRouter } from "ui5/ext/routing/types";

export default class Component extends UIComponent {
  static metadata = {
    manifest: "json",
    interfaces: ["sap.ui.core.IAsyncContentCreation"],
  };

  init(): void {
    super.init();
    const router = this.getRouter() as unknown as GuardRouter;

    // Route-specific guard -- redirects to "home" when not logged in
    router.addRouteGuard("protected", (context) => {
      return isLoggedIn() ? true : "home";
    });

    // Global guard -- runs for every navigation
    router.addGuard((context) => {
      if (context.toRoute === "admin" && !isAdmin()) {
        return "home";
      }
      return true;
    });

    router.initialize();
  }
}
```

## Usage examples

### Guard factory with model dependency

Extract guards into a separate module for testability and reuse:

```typescript
// guards.ts
import JSONModel from "sap/ui/model/json/JSONModel";
import type { GuardFn, GuardContext, GuardResult } from "ui5/ext/routing/types";

export function createAuthGuard(authModel: JSONModel): GuardFn {
  return (context: GuardContext): GuardResult => {
    const isLoggedIn = authModel.getProperty("/isLoggedIn");
    return isLoggedIn ? true : "home";
  };
}

export const forbiddenGuard: GuardFn = () => "home";
```

```typescript
// Component.ts
import { createAuthGuard, forbiddenGuard } from "./guards";

// in init():
const authModel = this.getModel("auth") as JSONModel;
router.addRouteGuard("protected", createAuthGuard(authModel));
router.addRouteGuard("forbidden", forbiddenGuard);
```

### Async guard with AbortSignal

```typescript
router.addRouteGuard("dashboard", async (context) => {
  const res = await fetch(`/api/access/${context.toRoute}`, {
    signal: context.signal, // cancelled automatically on newer navigation
  });
  const { allowed } = await res.json();
  return allowed ? true : "forbidden";
});
```

### Redirect with route parameters

```typescript
router.addGuard((context) => {
  if (context.toRoute === "old-detail") {
    return {
      route: "detail",
      parameters: { id: context.toArguments.id },
    };
  }
  return true;
});
```

### Dynamic guard registration

Guards can be added or removed at any point during the router's lifetime:

```typescript
const logGuard: GuardFn = (ctx) => {
  console.log(`Navigation: ${ctx.fromRoute} → ${ctx.toRoute}`);
  return true;
};

router.addGuard(logGuard);
// later...
router.removeGuard(logGuard);
```

## Guard return values

| Return value | Effect |
| --- | --- |
| `true` | Allow navigation |
| `false` | Block (stay on current route, no history entry) |
| `"routeName"` | Redirect to named route (replaces history, no extra entry) |
| `{ route, parameters }` | Redirect with route parameters |
| anything else (`null`, `undefined`) | Treated as block |

Only strict `true` allows navigation. This prevents accidental allows from truthy coercion.

## Guard context

Every guard receives a `GuardContext`:

| Property | Type | Description |
| --- | --- | --- |
| `toRoute` | `string` | Target route name (empty if no match) |
| `toHash` | `string` | Raw hash being navigated to |
| `toArguments` | `Record<string, string>` | Parsed route parameters |
| `fromRoute` | `string` | Current route name (empty on first nav) |
| `fromHash` | `string` | Current hash |
| `signal` | `AbortSignal` | Aborted when a newer navigation supersedes this one |

## Guard execution order

1. **Global guards** run first, in registration order
2. **Route-specific guards** run next, in registration order
3. The pipeline **short-circuits** at the first non-`true` result

## API

| Method | Description |
| --- | --- |
| `addGuard(fn)` | Register a global guard (runs for every navigation) |
| `removeGuard(fn)` | Remove a global guard |
| `addRouteGuard(routeName, fn)` | Register a guard for a specific route |
| `removeRouteGuard(routeName, fn)` | Remove a route-specific guard |

All methods return `this` for chaining.

## Limitations

### Redirect targets bypass guards

When a guard redirects navigation from route A to route B, route B's guards are **not** evaluated. The redirect commits immediately.

This matters when the redirect target has its own guards. For example:

```
User navigates to "dashboard"
  → dashboard guard checks permissions, returns "profile"
  → profile guard checks onboarding status ← this guard is SKIPPED
  → profile view renders
```

This is intentional. Evaluating guards on redirect targets introduces the risk of infinite loops (`A → B → A → B → ...`). While solvable with a visited-set that detects cycles, the implementation adds significant complexity — particularly when redirect targets have **async** guards, since the redirect chain can no longer be bracketed in a single synchronous call stack. The chain state must then persist across async boundaries and be cleared only by terminal events (commit, block, or loop detection).

In practice, redirect targets are typically "safe" routes like `home` or `login` that don't have guards of their own. If you need guard logic on a redirect target, run the check inline before returning the redirect:

```typescript
router.addRouteGuard("dashboard", (context) => {
  if (!hasPermission()) {
    // Instead of redirecting to "profile" and relying on its guard,
    // check the profile condition here
    return isOnboarded() ? "profile" : "onboarding";
  }
  return true;
});
```

### URL bar shows target hash during async guards

When a guard returns a Promise (e.g., a `fetch` call to check permissions), the browser's URL bar shows the target hash while the guard is resolving. If the guard ultimately blocks or redirects, the URL reverts — but there is a brief window where the displayed URL doesn't match the active route.

This does **not** affect sync guards, which resolve in the same tick as the hash change (the URL flicker is imperceptible).

**Why the router doesn't handle this**: UI5's `HashChanger` updates the URL and fires `hashChanged` *before* `parse()` is called. The router cannot prevent the URL change — it can only react to it. Frameworks like Vue Router and Angular Router avoid this by controlling the URL update themselves (calling `history.pushState` only after guards resolve), but UI5's architecture doesn't allow this without intercepting at the HashChanger level, which is globally scoped and fragile.

**Application-level solutions**:

Show a busy indicator while async guards resolve. This communicates to the user that navigation is in progress, making the URL bar state a non-issue:

```typescript
router.addRouteGuard("dashboard", async (context) => {
  const app = rootView.byId("app") as App;
  app.setBusy(true);
  try {
    const res = await fetch(`/api/access/${context.toRoute}`, {
      signal: context.signal,
    });
    const { allowed } = await res.json();
    return allowed ? true : "home";
  } finally {
    app.setBusy(false);
  }
});
```

This follows the same pattern as [TanStack Router's `pendingComponent`](https://tanstack.com/router/latest/docs/framework/react/guide/navigation-blocking#handling-blocked-navigations) — the URL reflects the intent while a loading state signals that the navigation hasn't committed yet.

## Development

### Monorepo structure

```
packages/
  lib/          ui5.ext.routing library (Router + types)
  demo-app/     Demo app with auth guards (home, protected, forbidden routes)
```

### Prerequisites

- Node.js >= 22
- npm >= 9 (workspaces)

### Install and run

```bash
npm install       # install all dependencies
npm start         # demo app at http://localhost:8080/index.html
```

### Tests

```bash
# QUnit (66 unit tests) -- needs the library server
npm run start:lib          # Terminal 1
npm run test:qunit         # Terminal 2

# E2E (18 integration tests) -- needs the demo-app server
npm start                  # Terminal 1
npm run test:e2e           # Terminal 2

# Or run all (with demo-app server running)
npm test
```

### Quality checks

```bash
npm run typecheck    # TypeScript strict mode
npm run lint         # oxlint
npm run fmt:check    # oxfmt
npm run check        # all of the above
```

### Build

```bash
npm run build        # library → packages/lib/dist/
```

## License

[MIT](LICENSE)
