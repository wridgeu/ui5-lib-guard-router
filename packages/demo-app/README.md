# ui5-lib-guard-router Demo App

Demo application showcasing `ui5.guard.router.Router` with authentication-based navigation guards.

The demo supports both standalone preview and a local FLP sandbox preview served from a virtual endpoint.

## Routes

| Route       | Pattern       | Guard behavior                                                      |
| ----------- | ------------- | ------------------------------------------------------------------- |
| `home`      | `""`          | Open -- no guard                                                    |
| `protected` | `"protected"` | Enter: requires login (redirects to `home`). Leave: blocks if dirty |
| `forbidden` | `"forbidden"` | Always blocked -- redirects to `home`                               |
| (bypassed)  | no match      | Shows the Not Found page with a button to return home               |

## Guards

Guard registration happens in two places:

**Component level** (`Component.ts`): Registers guards during `init()` and tears them down in `destroy()`.

| Guard                          | Type         | Route       | Description                                  |
| ------------------------------ | ------------ | ----------- | -------------------------------------------- |
| `createNavigationLogger()`     | Global enter | all         | Logs every navigation (always allows)        |
| `createAsyncPermissionGuard()` | Route enter  | `protected` | Async login check with `AbortSignal` support |
| `createDirtyFormGuard()`       | Route leave  | `protected` | Blocks leaving when form has unsaved changes |
| `forbiddenGuard`               | Route enter  | `forbidden` | Always redirects to `home`                   |

**Controller level** (`Home.controller.ts`): Demonstrates per-controller guard lifecycle.

| Guard                     | Type        | Route  | Description                       |
| ------------------------- | ----------- | ------ | --------------------------------- |
| `createHomeLeaveLogger()` | Route leave | `home` | Logs leaving home (always allows) |

**Reference implementations** in `guards.ts` (exported but not registered in the demo):

| Function                          | Purpose                                                             |
| --------------------------------- | ------------------------------------------------------------------- |
| `createAuthGuard()`               | Synchronous auth guard (sync variant of the async permission guard) |
| `createRedirectWithParamsGuard()` | Redirect preserving route parameters                                |
| `createErrorDemoGuard()`          | Sync error handling behavior                                        |
| `createAsyncErrorDemoGuard()`     | Async error handling behavior                                       |

## Architecture

### Controllers

All controllers extend `BaseController`, which provides shared helpers (`getRouter()`, `getModel()`, `createScenarioRunner()`).

| File                                 | Purpose                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `controller/BaseController.ts`       | Abstract base with typed helpers for router, model, and scenario runner |
| `controller/App.controller.ts`       | Root view controller (empty, reserved for future shell-level logic)     |
| `controller/Home.controller.ts`      | Home view: auth toggle, navTo buttons, hash scenarios, leave guard      |
| `controller/Protected.controller.ts` | Protected view: dirty form toggle, clear-and-go-home, nav back          |
| `controller/Forbidden.controller.ts` | Forbidden view (never rendered -- guard always redirects)               |
| `controller/NotFound.controller.ts`  | Not Found page shown for unmatched routes, with a "Go to Home" button   |

### Demo-only helpers

These files power the runtime inspector panels and hash-driven scenario buttons in the UI. They are isolated from the library and exist solely to make the demo interactive.

| File                         | Purpose                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `demo/RuntimeCoordinator.ts` | Orchestrator: listens to hash changes, syncs the runtime model, and lazily registers the FLP dirty-state provider                     |
| `demo/ScenarioRunner.ts`     | Drives hash-based scenarios (direct navigation, rapid sequence) and records last-action messages to the runtime model                 |
| `routing/hashNavigation.ts`  | Thin wrapper around `HashChanger` for `getCurrentHash()`, `setHash()`, `runHashSequence()`, and `attachHashChanged()`                 |
| `model/runtime.ts`           | Creates and syncs the `runtime` JSONModel (`currentHash`, `launchMode`, `hasUshellContainer`, `flpDirtyProviderActive`, `lastAction`) |
| `flp/ContainerAdapter.ts`    | Adapter for `sap.ushell.Container`: detects FLP presence and registers/deregisters the dirty-state provider                           |

### Models

| Name      | Source                 | Contents                                                      |
| --------- | ---------------------- | ------------------------------------------------------------- |
| `auth`    | `model/auth.json`      | `{ isLoggedIn: false }` -- toggled by the UI                  |
| `form`    | Created in `Component` | `{ isDirty: false }` -- used by the leave guard               |
| `runtime` | `model/runtime.ts`     | Hash, launch mode, ushell status, dirty provider, last action |

## FLP preview

The `start:flp` script launches a local FLP sandbox at `/test/flp.html#app-preview`. This endpoint is virtual -- generated by the `fiori-tools-preview` middleware, not a physical file.

**Why SAPUI5?** The FLP sandbox requires `sap.ushell`, which is not available in OpenUI5. The FLP config (`ui5-flp.yaml`) uses SAPUI5 while the standalone config (`ui5.yaml`) uses OpenUI5. Both pin version 1.144.0.

**What's different in FLP mode:**

- The runtime inspector shows "FLP Preview" as launch mode and "Available" for ushell container
- The dirty-state provider is registered via `sap.ushell.Container.registerDirtyStateProvider`
- Cross-app navigation (hash changes to routes outside the app) triggers the FLP dirty-state popup instead of the router's leave guard, avoiding a conflict where both would fire

The `crossNavigation.inbounds` configuration in `manifest.json` defines the semantic object (`guarddemo`, action `display`) used by the FLP tile.

## Running

From the monorepo root:

```bash
npm start         # standalone
npm run start:flp # FLP sandbox preview
```

Or from this directory:

```bash
npm start
# => opens http://localhost:8080/index.html

npm run start:flp
# => opens http://localhost:8080/test/flp.html#app-preview
```

## Scripts

```bash
# Start dev server with livereload and open the standalone app
npm start

# Start dev server with livereload and open the FLP sandbox preview
npm run start:flp

# Dev server without auto-open (used by E2E test runner)
npm run serve

# FLP preview server without auto-open (used by FLP E2E smoke tests)
npm run serve:flp

# Build
npm run build

# Type check
npm run typecheck

# Remove dist and .ui5 cache
npm run clean
```

## E2E tests

From the monorepo root:

```bash
npm run test:e2e
npm run test:e2e:flp
```

The command starts and stops the demo server on port 8080 for you.

Test files are in `test/e2e/`:

| File                    | Coverage                                                       |
| ----------------------- | -------------------------------------------------------------- |
| `routing-basic.e2e.ts`  | Basic navigation, login flow, nav-back                         |
| `guard-allow.e2e.ts`    | Navigation allowed after login                                 |
| `guard-block.e2e.ts`    | Navigation blocked when logged out                             |
| `guard-redirect.e2e.ts` | Forbidden route redirects to Home                              |
| `nav-button.e2e.ts`     | UI5 Page nav-back button, re-navigation                        |
| `multi-route.e2e.ts`    | Multi-step sequences, mid-session logout                       |
| `browser-back.e2e.ts`   | Browser back/forward with guard state changes                  |
| `direct-url.e2e.ts`     | Direct URL entry, nonexistent routes, rapid hash changes       |
| `leave-guard.e2e.ts`    | Dirty form leave guard: allow clean, block dirty, browser back |

Shared utilities (`helpers.ts`) provide `waitForPage`, `resetAuth`, `expectHashToBe`, `setDirtyState`, and `fireEvent` helpers.

FLP-specific coverage is split across three spec files in `test/flp/`:

| File                         | Purpose                                                                     |
| ---------------------------- | --------------------------------------------------------------------------- |
| `flp-preview.e2e.ts`         | Runtime state, in-app navigation, dirty prompt (cancel), in-app dirty block |
| `flp-cross-app.e2e.ts`       | Non-dirty cross-app navigation (FLP home button, tile click)                |
| `flp-cross-app-dirty.e2e.ts` | Dirty cross-app navigation with user confirmation                           |

The cross-app spec files are isolated because `toExternal()` (triggered by the FLP home button, tile clicks, etc.) navigates to Shell-home, leaving the sandbox unrecoverable. wdio creates a fresh browser session per spec file, so no ordering constraints exist.

## Framework

- OpenUI5 1.144.0 (standalone) / SAPUI5 1.144.0 (FLP preview)
- TypeScript via `ui5-tooling-transpile`
- `ui5-middleware-livereload` for dev server
- `fiori-tools-preview` for local FLP sandbox (`@sap/ux-ui5-tooling`)
- wdio v9 + wdi5 v3 for E2E tests
