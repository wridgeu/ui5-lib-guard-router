# Research: FLP Data Loss Prevention (Dirty State)

> **Date**: 2026-02-08 (updated 2026-03-15)
> **UI5 version analyzed**: SAPUI5 1.144.0
> **Context**: Understanding how FLP's built-in dirty state protection works, its scope, and how it complements the leave guards in this library. Updated with production FLP vs sandbox preview behavior and the leave guard interaction pattern.

## Summary

SAP Fiori Launchpad provides data loss prevention through a navigation filter in the Shell controller (`_handleDataLoss`). This filter checks dirty state — via `setDirtyFlag`, `registerDirtyStateProvider`, and `setAsyncDirtyStateProvider` — and shows a browser `confirm()` dialog when the user tries to navigate away from an app with unsaved changes.

The FLP mechanism operates at the **shell navigation level**, meaning it intercepts cross-app navigation, browser back/forward, home button clicks, and page refresh/close. It does **not** intercept hash changes that stay within the same app (in-app routing), because those are handled by the app's own router before the shell navigation filter runs.

## Public API

### `sap.ushell.Container.setDirtyFlag(bDirty: boolean): void`

- **Since**: 1.27.0
- **Visibility**: Public
- Sets a simple boolean flag indicating whether there are unsaved changes.
- When `true`, the Shell's `_handleDataLoss` filter will prompt the user on navigation.

```typescript
sap.ushell.Container.setDirtyFlag(true);
sap.ushell.Container.setDirtyFlag(false);
```

**Source**: [`Container-dbg.js` — `setDirtyFlag`](https://ui5.sap.com/1.144.0/resources/sap/ushell/Container-dbg.js)

### `sap.ushell.Container.getDirtyFlag(): boolean`

- **Since**: 1.27.0
- **Visibility**: Public
- **Deprecated since**: 1.120.0
- Returns `true` if the dirty flag is set OR if any registered dirty state provider returns `true`.
- Calls each registered provider with a `NavigationContext` object.

```typescript
const isDirty = sap.ushell.Container.getDirtyFlag();
```

**Deprecation reason**: FLP internally migrated to `getDirtyFlagsAsync()` (private) to support async dirty state providers. The synchronous `getDirtyFlag()` still works but cannot incorporate async providers.

**Source**: [`Container-dbg.js` — `getDirtyFlag`](https://ui5.sap.com/1.144.0/resources/sap/ushell/Container-dbg.js)

### `sap.ushell.Container.registerDirtyStateProvider(fnDirty: Function): void`

- **Since**: 1.31.0
- **Visibility**: Public
- Registers a callback that FLP calls to determine dirty state during navigation.
- The callback receives a `NavigationContext` parameter:

```typescript
interface NavigationContext {
	isCrossAppNavigation: boolean; // true for cross-app, false for inner-app
	innerAppRoute: string; // the target inner-app route hash fragment
}
```

```typescript
const dirtyProvider = (navigationContext) => {
	// Can differentiate between cross-app and inner-app navigation
	if (navigationContext?.isCrossAppNavigation) {
		return myModel.getProperty("/isDirty");
	}
	return false;
};
sap.ushell.Container.registerDirtyStateProvider(dirtyProvider);
```

**Source**: [`Container-dbg.js` — `registerDirtyStateProvider`](https://ui5.sap.com/1.144.0/resources/sap/ushell/Container-dbg.js)

### `sap.ushell.Container.deregisterDirtyStateProvider(fnDirty: Function): void`

- **Since**: 1.67.0
- **Visibility**: Public
- Removes the last registered instance of the given callback from the list of dirty state providers.
- Uses `lastIndexOf` to find and remove the callback (matches by reference).

```typescript
sap.ushell.Container.deregisterDirtyStateProvider(dirtyProvider);
```

**Source**: [`Container-dbg.js` — `deregisterDirtyStateProvider`](https://ui5.sap.com/1.144.0/resources/sap/ushell/Container-dbg.js)

## Private/Internal API (not for application use)

### `sap.ushell.Container.getDirtyFlagsAsync(): Promise<boolean>`

- **Since**: 1.98.0
- **Visibility**: Private
- Returns a Promise resolving to `true` if any sync or async dirty state provider returns `true`, or if the dirty flag is set.
- This is what the Shell controller's `_handleDataLoss` actually uses (in newer versions).

### `sap.ushell.Container.setAsyncDirtyStateProvider(fn: Function): void`

- **Since**: 1.98.0
- **Visibility**: Private (appruntime use only)
- Registers an async dirty state provider. Only one can be set at a time.
- The function must return a `Promise<boolean>`.

## Shell Controller Internals

### `_handleDataLoss` Navigation Filter

The Shell controller (`sap.ushell.renderer.Shell.controller`) registers `_handleDataLoss` as a navigation filter on `ShellNavigationInternal`. This is the central mechanism that enforces data loss protection.

**Flow**:

1. User triggers navigation (click tile, browser back, home button, etc.)
2. `ShellNavigationHashChanger.treatHashChanged` processes the hash change
3. Navigation filters (including `_handleDataLoss`) are called in sequence
4. `_handleDataLoss` calls `Container.getDirtyFlag()` (or `getDirtyFlagsAsync()`)
5. If dirty, shows `window.confirm("Your unsaved changes will be lost...")` dialog
6. Returns `NavigationFilterStatus.Continue` (allow) or `NavigationFilterStatus.Keep` (block)

**Source**: [`Shell-dbg.controller.js` — `_handleDataLoss`](https://ui5.sap.com/1.144.0/resources/sap/ushell/renderer/Shell-dbg.controller.js)

### `_disableSourceAppRouter`

When navigation proceeds after a dirty state confirmation, the Shell controller calls `_disableSourceAppRouter` to prevent the source app's router from reacting to the navigation. This avoids conflicts between the FLP shell navigation and the app's internal router during cross-app transitions.

**Source**: [`Shell-dbg.controller.js` — `_disableSourceAppRouter`](https://ui5.sap.com/1.144.0/resources/sap/ushell/renderer/Shell-dbg.controller.js)

### `NavigationFilterStatus` Enum

Used by navigation filters to communicate their decision:

| Value      | Effect                                            |
| ---------- | ------------------------------------------------- |
| `Continue` | Allow navigation to proceed                       |
| `Custom`   | Custom navigation handling (filter provides hash) |
| `Abandon`  | Cancel navigation entirely                        |
| `Keep`     | Stay on current page (used by `_handleDataLoss`)  |

**Source**: [`ShellNavigationHashChanger-dbg.js`](https://ui5.sap.com/1.144.0/resources/sap/ushell/services/ShellNavigationHashChanger-dbg.js)

### Inner-App vs Cross-App Navigation

`ShellNavigationHashChanger` distinguishes between:

- **Inner-app navigation**: Same semantic object and action, different app route (e.g., `#Order-display&/list` → `#Order-display&/detail/123`). The `&/...` suffix is the inner-app route.
- **Cross-app navigation**: Different semantic object/action (e.g., `#Order-display` → `#Product-manage`).

Classification happens in `treatHashChanged` using `UrlParsing.compareHashes()`, which returns `{ sameIntent, sameParameters }`. The public `isInnerAppNavigation(newHash, oldHash)` method provides the same logic as a utility but is not used internally by `treatHashChanged`.

## Hash Changer Architecture

The browser URL always contains a single hash fragment. The FLP uses the `&/` convention to pack two logical hashes into one physical hash:

```
#Order-display&/detail/42
 └── shell hash ──┘└─ app hash ─┘
```

The browser sees one `hashchange` event. The FLP's hash changer infrastructure splits this into separate concerns, so the app's router only ever sees the app hash portion (`detail/42`).

### How the FLP replaces the default HashChanger

During FLP boot, `ShellNavigationInternal.init()` calls:

```js
HashChanger.replaceHashChanger(shellNavigationHashChanger);
```

This static method on [`HashChanger`](https://ui5.sap.com/1.144.0/resources/sap/ui/core/routing/HashChanger-dbg.js) replaces the global singleton. It transfers the existing `RouterHashChanger` from the old instance to the new one and re-parents it:

```js
oHashChanger._oRouterHashChanger = _oHashChanger._oRouterHashChanger;
oHashChanger._oRouterHashChanger.parent = oHashChanger;
```

From this point on, `HashChanger.getInstance()` returns the `ShellNavigationHashChanger`. Every `Router` that later calls `createRouterHashChanger()` gets a child whose parent is the shell hash changer.

The replacement also overrides `getHash()`:

```js
ShellNavigationHashChanger.prototype.getHash = function () {
	return this.getAppHash(); // returns ONLY the inner-app portion
};
```

Any code calling `hashChanger.getHash()` — including `Router.initialize()` — sees only the app-specific route, never the shell prefix.

### Event chain: browser hashchange → Router.parse()

```
Browser hashchange (one event for the full fragment)
  → hasher library captures it
    → ShellNavigationHashChanger.treatHashChanged(newHash, oldHash)
      → _splitHash() decomposes at &/
      → UrlParsing.compareHashes() classifies the change
        │
        ├─ Inner-app (sameIntent && sameParameters, different appSpecificRoute)
        │    → fireEvent("hashChanged", {newHash: "detail/42", ...})
        │      → HashChanger._onHashChangedForRouterHashChanger(eventInfo, event)
        │        → paramMapping resolves "newHash" → "detail/42"
        │        → RouterHashChanger.fireHashChanged("detail/42", subHashMap, false)
        │          → fireEvent("hashChanged", {newHash: "detail/42"})
        │            → Router.fnHashChanged → Router.parse("detail/42")
        │
        └─ Cross-app (different intent)
             → fireEvent("shellHashChanged", {..., updateHashOnly: true})
             │  → HashChanger._onHashChangedForRouterHashChanger(eventInfo, event)
             │    → paramMapping resolves "newHash" from "newAppSpecificRouteNoSeparator"
             │    → RouterHashChanger.fireHashChanged(appHash, subHashMap, true)
             │      → if (!bUpdateHashOnly && sHash !== sOldHash) — CONDITION FAILS
             │      → fireEvent is SKIPPED — Router.parse() is never called
             │
             → _fnShellCallback(newShellHash, newAppRoute, oldShellHash, oldAppRoute)
               → FLP shell destroys old component, loads new app
```

The `updateHashOnly: true` flag in the `shellHashChanged` event definition is the mechanism that prevents the old app's router from reacting to cross-app navigation. The [`RouterHashChanger.fireHashChanged`](https://ui5.sap.com/1.144.0/resources/sap/ui/core/routing/RouterHashChanger-dbg.js) method silently updates the stored hash without firing the `"hashChanged"` event:

```js
RouterHashChanger.prototype.fireHashChanged = function (sHash, oSubHashMap, bUpdateHashOnly) {
	var sOldHash = this.hash;
	this.hash = sHash;
	if (!bUpdateHashOnly && sHash !== sOldHash) {
		this.fireEvent("hashChanged", { newHash: sHash, oldHash: sOldHash });
	}
};
```

### Event chain: Router.navTo() → browser URL

When the app calls `router.navTo("detail", {id: "42"})`:

```
Router.navTo("detail", {id: "42"})
  → resolves route pattern → hash string "detail/42"
  → RouterHashChanger.setHash("detail/42")
    → fires "hashSet" event upward
      → ShellNavigationHashChanger._onHashModified catches it
        → _reconstructHash() joins sub-hashes with &/
        → setHash(fullHash) → toAppHash("detail/42", true)
          → _constructHash(appHashPrefix + "detail/42")
            → _getCurrentShellHash() returns "Order-display"
            → result: "Order-display&/detail/42"
          → hasher.setHash("Order-display&/detail/42")
            → browser URL updates to #Order-display&/detail/42
```

The app's router only knows about `"detail/42"`. The `ShellNavigationHashChanger` transparently handles prefixing it with the shell hash and the `&/` separator.

### Layer summary

| Layer    | Component                    | Sees                                     | Responsibility                            |
| -------- | ---------------------------- | ---------------------------------------- | ----------------------------------------- |
| Browser  | `window.onhashchange`        | `#Order-display&/detail/42`              | Raw hash change event                     |
| Library  | `hasher`                     | `Order-display&/detail/42`               | Normalizes, fires `changed` signal        |
| FLP      | `ShellNavigationHashChanger` | Shell: `Order-display`, App: `detail/42` | Splits at `&/`, classifies, routes events |
| UI5 Core | `RouterHashChanger`          | `detail/42`                              | Receives app hash only, fires to Router   |
| App      | `Router`                     | `detail/42`                              | Matches routes, calls `parse()`           |

### Source references

All method signatures and event definitions verified against the unminified SAPUI5 1.144.0 source files:

- [`ShellNavigationHashChanger-dbg.js`](https://ui5.sap.com/1.144.0/resources/sap/ushell/services/ShellNavigationHashChanger-dbg.js) — `treatHashChanged`, `_splitHash`, `getHash`/`getAppHash`, `setHash`/`toAppHash`/`_constructHash`, `getRelevantEventsInfo` (defines `O_EVENT` with `updateHashOnly`), `_fnShellCallback`, `isInnerAppNavigation`
- [`HashChanger-dbg.js`](https://ui5.sap.com/1.144.0/resources/sap/ui/core/routing/HashChanger-dbg.js) — `replaceHashChanger` (re-parents `_oRouterHashChanger`), `_onHashChangedForRouterHashChanger` (uses `paramMapping`), `_registerListenerToRelevantEvents`
- [`RouterHashChanger-dbg.js`](https://ui5.sap.com/1.144.0/resources/sap/ui/core/routing/RouterHashChanger-dbg.js) — `fireHashChanged` (`bUpdateHashOnly` check), `setHash` (fires `"hashSet"` upward)
- [`Router-dbg.js`](https://ui5.sap.com/1.144.0/resources/sap/ui/core/routing/Router-dbg.js) — `initialize` (attaches `"hashChanged"` handler that calls `parse()`)

## Scope and Limitations

### What FLP dirty state covers

| Trigger                          | Covered | Mechanism                       |
| -------------------------------- | ------- | ------------------------------- |
| Cross-app navigation (tiles)     | Yes     | Shell navigation filter         |
| FLP home button                  | Yes     | Shell navigation filter         |
| Browser back/forward (cross-app) | Yes     | Shell navigation filter         |
| Browser refresh / close          | Yes     | `beforeunload` event (separate) |

### What FLP dirty state does NOT cover

| Trigger                             | Covered | Why                                                    |
| ----------------------------------- | ------- | ------------------------------------------------------ |
| In-app route changes (same app)     | No      | Inner-app hash changes bypass shell navigation filters |
| Programmatic `router.navTo()` calls | No      | These are app-internal, below the FLP shell level      |

### Why inner-app navigation is not covered

When the hash changes but the intent stays the same (inner-app navigation), the `ShellNavigationHashChanger` treats it as an inner-app route change and does not run the full navigation filter pipeline. The dirty state check (`_handleDataLoss`) only runs for shell-level navigation events.

This is by design — FLP assumes apps handle their own internal routing. This is exactly the gap that leave guards fill.

## Production FLP vs Sandbox Preview

The `ShellNavigationHashChanger` replacement is central to understanding how leave guards behave in each environment.

### Production FLP

In production, the FLP replaces the default `sap.ui.core.routing.HashChanger` with its own `ShellNavigationHashChanger`. This hash changer splits the URL into two parts:

- **Shell hash**: `#SemanticObject-action` — managed by the FLP
- **App hash**: the fragment after `&/` — managed by the app's router

The app's router only receives the app hash portion. When the user clicks the FLP home button or a different app tile, the shell hash changes but the app hash does not. The app's `Router.parse()` is never called for cross-app navigation. The FLP's `_disableSourceAppRouter` explicitly prevents the source app's router from reacting.

**Consequence**: Leave guards are never triggered by cross-app navigation in production. The FLP's `_handleDataLoss` filter handles dirty state before the hash changes.

### FLP Sandbox Preview (`fiori-tools-preview`)

The sandbox preview provided by `@sap/ux-ui5-tooling` is a lightweight FLP emulation. It boots `sap.ushell` with a mock container and minimal shell services. While the sandbox does not fully replicate the `ShellNavigationHashChanger` split, cross-app navigation via `toExternal()` (FLP home button, tile clicks) still operates at the shell level and does not pass through the app router's `parse()`.

### Leave guards and cross-app navigation

No bypass logic or FLP detection is needed in leave guards. In both production and sandbox, `toExternal()` navigates at the shell level, so the leave guard never runs for cross-app hashes. The leave guard and dirty-state provider handle different scopes and never overlap:

```typescript
// Leave guard: blocks in-app navigation when dirty
const leaveGuard: LeaveGuardFn = (context) => {
	return !formModel.getProperty("/isDirty");
};

// Dirty-state provider: tells FLP about unsaved changes for cross-app
const dirtyProvider = (navigationContext) => {
	if (navigationContext?.isCrossAppNavigation === false) return false;
	return formModel.getProperty("/isDirty") === true;
};
sap.ushell.Container.registerDirtyStateProvider(dirtyProvider);
```

No `toRoute` check, no flags, no FLP detection in the leave guard.

| Environment         | Cross-app via `toExternal()` triggers `parse()`? | Leave guard behavior |
| ------------------- | ------------------------------------------------ | -------------------- |
| Production FLP      | No (`ShellNavigationHashChanger` intercepts)     | Never reached        |
| FLP sandbox         | No (`toExternal` operates at shell level)        | Never reached        |
| Standalone (no FLP) | N/A (no ushell)                                  | N/A                  |

In both production and sandbox, `toExternal()` navigates at the shell level, bypassing the app router's `parse()`. The leave guard never interferes with cross-app navigation. The dirty-state provider handles the confirmation UX independently.

## Complementary Usage Pattern

For complete data loss prevention in a Fiori Launchpad app:

```typescript
// Component.ts
init(): void {
    super.init();
    const router = this.getRouter() as GuardRouter;

    const formModel = new JSONModel({ isDirty: false });
    this.setModel(formModel, "form");

    // 1. Leave guard: protects in-app navigation
    router.addRouteGuard("editOrder", {
        beforeLeave: () => !formModel.getProperty("/isDirty"),
    });

    // 2. FLP dirty state provider: protects cross-app navigation
    //    In production FLP, ShellNavigationHashChanger ensures cross-app
    //    hashes never reach the app router, so the two never conflict.
    if (sap.ushell?.Container) {
        this._dirtyProvider = (navigationContext) => {
            if (navigationContext?.isCrossAppNavigation === false) {
                return false;
            }
            return formModel.getProperty("/isDirty") === true;
        };
        sap.ushell.Container.registerDirtyStateProvider(this._dirtyProvider);
    }

    router.initialize();
}

destroy(): void {
    // Clean up FLP provider
    if (sap.ushell?.Container && this._dirtyProvider) {
        sap.ushell.Container.deregisterDirtyStateProvider(this._dirtyProvider);
    }
    super.destroy();
}
```

## Verification Sources

All findings were verified by reading the unminified debug source files hosted on the public SAPUI5 CDN. Each link below opens directly in the browser. Use the browser's find function (`Ctrl+F`) with the search terms listed.

- [`sap/ushell/Container-dbg.js`](https://ui5.sap.com/1.144.0/resources/sap/ushell/Container-dbg.js)
  Search for: `setDirtyFlag`, `getDirtyFlag`, `registerDirtyStateProvider`, `deregisterDirtyStateProvider`, `getDirtyFlagsAsync`, `setAsyncDirtyStateProvider`, `NavigationContext`
- [`sap/ushell/renderer/Shell-dbg.controller.js`](https://ui5.sap.com/1.144.0/resources/sap/ushell/renderer/Shell-dbg.controller.js)
  Search for: `_handleDataLoss`, `_disableSourceAppRouter`, `NavigationFilterStatus`
- [`sap/ushell/services/ShellNavigationHashChanger-dbg.js`](https://ui5.sap.com/1.144.0/resources/sap/ushell/services/ShellNavigationHashChanger-dbg.js)
  Search for: `isInnerAppNavigation`, `treatHashChanged`, `NavigationFilterStatus`

> **Note**: `sap.ushell` is part of SAPUI5, not OpenUI5. These debug files are publicly accessible on the CDN without authentication. The `-dbg.js` suffix indicates the unminified, readable version of the source.
