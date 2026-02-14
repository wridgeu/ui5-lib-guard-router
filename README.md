<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License"></a>
  <a href="https://openui5.org/"><img src="https://img.shields.io/badge/OpenUI5-1.144.0-green.svg" alt="UI5"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-blue.svg" alt="TypeScript"></a>
</p>

UI5 Router extension with async navigation guards. Drop-in replacement for `sap.m.routing.Router` that intercepts navigation **before** route matching, target loading, or view creation, preventing unauthorized content flashes.

> Born from [SAP/openui5#3411](https://github.com/SAP/openui5/issues/3411), an open request since 2021 for native navigation guard support in UI5. Track the UI5 team's progress there.
>
> **Related resources**:
>
> - [Stack Overflow: Preventing router from navigating](https://stackoverflow.com/questions/29165700/preventing-router-from-navigating/29167292#29167292) (native NavContainer `navigate` event, sync-only, fires after route match)
> - [Research: Native NavContainer navigate event](docs/research-native-router-navigate-event.md) (detailed comparison with this library)

> [!IMPORTANT]
> **Minimum UI5 version: 1.118**
>
> The library uses [`sap.ui.core.Lib`](https://sdk.openui5.org/api/sap.ui.core.Lib) for library initialization, which was introduced in **UI5 1.118**. The Router itself only depends on APIs available since 1.75 (notably [`getRouteInfoByHash`](https://sdk.openui5.org/api/sap.ui.core.routing.Router%23methods/getRouteInfoByHash)), but the library packaging sets the effective floor. Developed and tested against OpenUI5 1.144.0.

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

> [!WARNING]
> This library is **experimental**. It is not battle-tested in production environments, and the API may change without notice. If you choose to consume it, you do so at your own risk -- make sure to pin your version and review changes before upgrading.

### 1. Install the library

```bash
npm install ui5-lib-guard-router
```

### 2. Configure manifest.json

Add the library dependency and set the router class:

```json
{
	"sap.ui5": {
		"dependencies": {
			"libs": {
				"ui5.guard.router": {}
			}
		},
		"routing": {
			"config": {
				"routerClass": "ui5.guard.router.Router"
			}
		}
	}
}
```

That's it. All your existing routes, targets, and navigation calls continue to work; the extended router is fully backward-compatible.

### 3. Register guards in your Component

```typescript
import UIComponent from "sap/ui/core/UIComponent";
import type { GuardRouter } from "ui5/guard/router/types";

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

## API

The router extends `sap.m.routing.Router` with six methods for guard management. All methods return `this` for chaining.

### Guard registration

| Method                                                     | Description                                               |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| `addGuard(fn)`                                             | Register a global enter guard (runs for every navigation) |
| `addRouteGuard(routeName, fn)`                             | Register an enter guard for a specific route              |
| `addRouteGuard(routeName, { beforeEnter?, beforeLeave? })` | Register enter and/or leave guards via object form        |
| `addLeaveGuard(routeName, fn)`                             | Register a leave guard (runs when leaving the route)      |

### Guard removal

| Method                                                        | Description                                      |
| ------------------------------------------------------------- | ------------------------------------------------ |
| `removeGuard(fn)`                                             | Remove a global enter guard                      |
| `removeRouteGuard(routeName, fn)`                             | Remove an enter guard                            |
| `removeRouteGuard(routeName, { beforeEnter?, beforeLeave? })` | Remove enter and/or leave guards via object form |
| `removeLeaveGuard(routeName, fn)`                             | Remove a leave guard                             |

### Guard context

Every guard receives a `GuardContext` object:

| Property      | Type                                               | Description                                         |
| ------------- | -------------------------------------------------- | --------------------------------------------------- |
| `toRoute`     | `string`                                           | Target route name (empty if no match)               |
| `toHash`      | `string`                                           | Raw hash being navigated to                         |
| `toArguments` | `Record<string, string \| Record<string, string>>` | Parsed route parameters                             |
| `fromRoute`   | `string`                                           | Current route name (empty on first nav)             |
| `fromHash`    | `string`                                           | Current hash                                        |
| `signal`      | `AbortSignal`                                      | Aborted when a newer navigation supersedes this one |

### Guard return values

**Enter guards** (`addGuard`, `addRouteGuard`):

| Return value                                   | Effect                                          |
| ---------------------------------------------- | ----------------------------------------------- |
| `true`                                         | Allow navigation                                |
| `false`                                        | Block (stay on current route, no history entry) |
| `"routeName"`                                  | Redirect to named route (replaces history)      |
| `{ route, parameters?, componentTargetInfo? }` | Redirect with route parameters                  |
| anything else (`null`, `undefined`)            | Treated as block                                |

Only strict `true` allows navigation. This prevents accidental allows from truthy coercion.

**Leave guards** (`addLeaveGuard`):

| Return value                      | Effect                                          |
| --------------------------------- | ----------------------------------------------- |
| `true`                            | Allow leaving the current route                 |
| `false` (or any non-`true` value) | Block (stay on current route, no history entry) |

Leave guards cannot redirect. They answer the binary question "can I leave?". For redirection logic, use enter guards on the target route.

### Guard execution order

1. **Leave guards** for the current route run first, in registration order
2. **Global enter guards** run next, in registration order
3. **Route-specific enter guards** for the target route run last, in registration order
4. The pipeline **short-circuits** at the first non-`true` result

## Usage examples

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

### Guard factories

Extract guards into a separate module for testability and reuse:

```typescript
// guards.ts
import JSONModel from "sap/ui/model/json/JSONModel";
import type { GuardFn, LeaveGuardFn, GuardContext, GuardResult } from "ui5/guard/router/types";

export function createAuthGuard(authModel: JSONModel): GuardFn {
	return (context: GuardContext): GuardResult => {
		return authModel.getProperty("/isLoggedIn") ? true : "home";
	};
}

export function createDirtyFormGuard(formModel: JSONModel): LeaveGuardFn {
	return (context: GuardContext): boolean => {
		return !formModel.getProperty("/isDirty");
	};
}
```

### Object form (enter + leave)

Register both guard types in a single call:

```typescript
router.addRouteGuard("editOrder", {
	beforeEnter: createAuthGuard(authModel),
	beforeLeave: createDirtyFormGuard(formModel),
});
```

### Leave guard with controller lifecycle

Leave guards registered in controllers should be cleaned up on exit:

```typescript
import type { GuardRouter, LeaveGuardFn } from "ui5/guard/router/types";
import { createDirtyFormGuard } from "./guards";

export default class EditOrderController extends Controller {
	private _leaveGuard: LeaveGuardFn;

	onInit(): void {
		const formModel = new JSONModel({ isDirty: false });
		this.getView()!.setModel(formModel, "form");

		const router = (this.getOwnerComponent() as UIComponent).getRouter() as unknown as GuardRouter;
		this._leaveGuard = createDirtyFormGuard(formModel);
		router.addLeaveGuard("editOrder", this._leaveGuard);
	}

	onExit(): void {
		const router = (this.getOwnerComponent() as UIComponent).getRouter() as unknown as GuardRouter;
		router.removeLeaveGuard("editOrder", this._leaveGuard);
	}
}
```

> [!TIP]
> **User feedback on blocked navigation**: When a leave guard blocks, the router silently restores the previous hash. There is no built-in confirmation dialog or toast. In production, show a `sap.m.MessageBox.confirm()` inside your leave guard (returning the user's choice as a `Promise<boolean>`) so the block is visible.

> [!NOTE]
> **Guard cleanup and lifecycle**
>
> **Component level**: The router's `destroy()` method automatically clears all registered guards when the component is destroyed (including during FLP navigation).
>
> **Controller level**: UI5's routing caches views indefinitely, so `onExit` is called only when the component is destroyed, not on every navigation away. Controller-registered guards therefore persist across in-app navigations. This is typically the desired behavior for route-specific guards tied to view state.
>
> In FLP apps with `sap-keep-alive` enabled, the component persists when navigating to other apps. Guards remain registered since the same instance is reused.

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

### Native alternative for leave guards: Fiori Launchpad data loss prevention

If your app runs inside SAP Fiori Launchpad (FLP), the shell provides built-in data loss protection (an alternative to leave guards) through two public APIs on `sap.ushell.Container`:

**`setDirtyFlag(bDirty)`** (since 1.27.0): A simple boolean flag. When set to `true`, FLP shows a browser `confirm()` dialog when the user attempts cross-app navigation (home button, other tiles), browser back/forward out of the app, or page refresh/close:

```typescript
sap.ushell.Container.setDirtyFlag(true); // mark unsaved changes
sap.ushell.Container.setDirtyFlag(false); // clear after save
```

**`registerDirtyStateProvider(fn)`** (since 1.31.0): Registers a callback that FLP calls during navigation to dynamically determine dirty state. The callback receives a `NavigationContext` with `isCrossAppNavigation` (boolean) and `innerAppRoute` (string), allowing the provider to distinguish between cross-app and in-app navigation:

```typescript
const dirtyProvider = (navigationContext) => {
	if (navigationContext?.isCrossAppNavigation) {
		return formModel.getProperty("/isDirty");
	}
	return false; // let in-app routing handle it
};
sap.ushell.Container.registerDirtyStateProvider(dirtyProvider);

// Clean up (since 1.67.0)
sap.ushell.Container.deregisterDirtyStateProvider(dirtyProvider);
```

> **Note**: `getDirtyFlag()` is deprecated since UI5 1.120. FLP internally uses `getDirtyFlagsAsync()` (private) which combines the flag with all registered providers. The synchronous `getDirtyFlag()` still works but should not be relied upon in new code.

**How the two approaches complement each other**: FLP's data loss protection operates at the shell navigation filter level, intercepting navigation _before_ the hash change reaches your app's router. Leave guards operate _inside_ your app's router, intercepting route-to-route navigation. For complete coverage:

- Use **leave guards** for in-app route changes (e.g., navigating from an edit form to a list within your app)
- Use **`setDirtyFlag`** or **`registerDirtyStateProvider`** for FLP-level navigation (cross-app, browser close, home button)

See [FLP Dirty State Research](docs/research-flp-dirty-state.md) for a detailed analysis of the FLP internals.

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

This is intentional. Evaluating guards on redirect targets introduces the risk of infinite loops (`A → B → A → B → ...`). While solvable with a visited-set that detects cycles, the implementation adds significant complexity. This is particularly true when redirect targets have **async** guards, since the redirect chain can no longer be bracketed in a single synchronous call stack. The chain state must then persist across async boundaries and be cleared only by terminal events (commit, block, or loop detection).

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

When a guard returns a Promise (e.g., a `fetch` call to check permissions), the browser's URL bar shows the target hash while the guard is resolving. If the guard ultimately blocks or redirects, the URL reverts. However, there is a brief window where the displayed URL doesn't match the active route.

This does **not** affect sync guards, which resolve in the same tick as the hash change (the URL flicker is imperceptible).

**Why the router doesn't handle this**: UI5's `HashChanger` updates the URL and fires `hashChanged` _before_ `parse()` is called. The router cannot prevent the URL change; it can only react to it. Frameworks like Vue Router and Angular Router avoid this by controlling the URL update themselves (calling `history.pushState` only after guards resolve), but UI5's architecture doesn't allow this without intercepting at the HashChanger level, which is globally scoped and fragile.

```
User clicks link / navTo()
        ↓
HashChanger updates browser URL    ← URL changes HERE
        ↓
HashChanger fires hashChanged
        ↓
Router.parse() called              ← guards run HERE
        ↓
   ┌────┴────┐
allowed    blocked
   ↓          ↓
views      _restoreHash()
load       reverts URL
```

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

This follows the same pattern as [TanStack Router's `pendingComponent`](https://tanstack.com/router/latest/docs/framework/react/guide/navigation-blocking#handling-blocked-navigations): the URL reflects the intent while a loading state signals that the navigation hasn't committed yet.

## Development

### Monorepo structure

```
packages/
  lib/          ui5.guard.router library (Router + types)
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
npm test              # run all tests (QUnit + E2E, sequentially)
npm run test:qunit    # unit tests only
npm run test:e2e      # integration tests only
```

Each test command automatically starts and stops the appropriate server (port 8080).

### Quality checks

```bash
npm run typecheck    # TypeScript strict mode
npm run lint         # oxlint
npm run fmt:check    # oxfmt
npm run check        # all of the above
```

A pre-commit hook (husky + lint-staged) automatically runs `oxlint --fix` and `oxfmt` on staged files before each commit, so formatting and lint issues are fixed before they reach CI.

### Build

```bash
npm run build        # library → packages/lib/dist/
```

### Deployment

Releases are automated via [release-please](https://github.com/googleapis/release-please) and GitHub Actions.

**How it works:**

1. Merge PRs with [Conventional Commits](https://www.conventionalcommits.org/) into `main` (e.g. `feat:`, `fix:`)
2. release-please automatically opens/updates a "Release PR" that bumps the version in `package.json` and `manifest.json`, and maintains a `CHANGELOG.md`
3. Merging the Release PR triggers the publish workflow: build, test (QUnit + E2E), then `npm publish` with provenance

**One-time setup (after first merge):**

1. Create an **Automation** token on [npmjs.com](https://www.npmjs.com) (Access Tokens → Generate New Token → Automation)
2. Add it as `NPM_TOKEN` in the repo's Settings → Secrets and variables → Actions

**Configuration files:**

| File                            | Purpose                                            |
| ------------------------------- | -------------------------------------------------- |
| `.github/workflows/ci.yml`      | CI pipeline (lint, format, typecheck, build, test) |
| `.github/workflows/release.yml` | Release-please + npm publish                       |
| `release-please-config.json`    | Package path, extra version files                  |
| `.release-please-manifest.json` | Current version tracker                            |

## License

[MIT](LICENSE)
