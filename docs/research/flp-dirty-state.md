# Research: FLP Data Loss Prevention (Dirty State)

> **Date**: 2026-02-08 (updated 2026-03-15)
> **UI5 versions analyzed**: SAPUI5 1.144.0 and 1.149.0
> **Context**: Understanding how FLP's built-in dirty state protection works, its scope, and how it complements the leave guards in this library. Updated with production FLP vs sandbox preview behavior and the leave guard interaction pattern.

## Summary

SAP Fiori Launchpad provides data loss prevention through a navigation filter in the Shell controller (`_handleDataLoss`). This filter checks dirty state — via `setDirtyFlag`, `registerDirtyStateProvider`, and `setAsyncDirtyStateProvider` — and shows a browser `confirm()` dialog when the user tries to navigate away from an app with unsaved changes.

The filter runs for every hash change, in-app ones included, before the app router sees it. Dirty-state providers receive `isCrossAppNavigation` and decide whether an in-app change counts; `setDirtyFlag(true)` makes every hash change prompt. Page refresh/close is covered separately by `beforeunload`.

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

**Deprecation**: in 1.144.0 the shell uses `getDirtyFlagsAsync()` (private) to include an async provider. In 1.149.0 `getDirtyFlag()` delegates to `sap.ushell.navigation.DirtyState`, its named successor.

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
- In 1.144.0 `_handleDataLoss` uses it when an async provider is set. 1.149.0 no longer has it; the shell reads `DirtyState.getDirtyFlagInternal()`.

### `sap.ushell.Container.setAsyncDirtyStateProvider(fn: Function): void`

- **Since**: 1.98.0
- **Visibility**: Private (appruntime use only)
- Registers an async dirty state provider. Only one can be set at a time.
- The function must return a `Promise<boolean>`.

## Shell Controller Internals

### `_handleDataLoss` Navigation Filter

The Shell controller (`sap.ushell.renderer.Shell.controller`) registers `_handleDataLoss` as a navigation filter on `ShellNavigationInternal`. This is the central mechanism that enforces data loss protection.

**Flow**:

1. A hash change arrives: tile, home button, browser back/forward, or an app's own `navTo()`. The browser hash has already changed.
2. `ShellNavigationHashChanger.treatHashChanged` calls the navigation filters in sequence, for in-app and cross-app changes alike.
3. `_handleDataLoss` reads the dirty state (`Container.getDirtyFlag()` in 1.144.0, `DirtyState.getDirtyFlagInternal()` in 1.149.0). Not dirty: it returns `Continue`.
4. Dirty: it puts the previous hash back (history back/forward, or `replaceHash` after a replaced entry), restarts the app router with `initialize(true)`, and returns `Custom`. `treatHashChanged` stops there; no `hashChanged` event reaches the app router.
5. The hash change that puts the hash back is swallowed the same way. Once the browser shows the previous hash, the shell shows `window.confirm()`.
6. Confirmed: it clears the dirty flag and sets the target hash again, which passes the filter this time. Cancelled: nothing more happens; the app stays on its route with its router running.

**Source**: [`Shell-dbg.controller.js` — `_handleDataLoss`](https://ui5.sap.com/1.144.0/resources/sap/ushell/renderer/Shell-dbg.controller.js)

### `_disableSourceAppRouter`

A navigation filter registered before `_handleDataLoss`. For every cross-app hash change it calls `stop()` on the router of the current app, before the dirty check. If the data-loss check then puts the hash back, `_resumeAppRouterIgnoringCurrentHash` restarts the router with `initialize(true)`. The same restart runs after a failed navigation that returns to the previous app and after the target app opened in a new window.

**Source**: [`Shell-dbg.controller.js` — `_disableSourceAppRouter`](https://ui5.sap.com/1.144.0/resources/sap/ushell/renderer/Shell-dbg.controller.js)

### `NavigationFilterStatus` Enum

Used by navigation filters to communicate their decision:

| Value      | Effect                                            |
| ---------- | ------------------------------------------------- |
| `Continue` | Allow navigation to proceed                       |
| `Custom`   | Custom navigation handling (filter provides hash) |
| `Abandon`  | Cancel navigation entirely                        |
| `Keep`     | Pass the full hash to the current app's router    |

**Source**: [`ShellNavigationHashChanger-dbg.js`](https://ui5.sap.com/1.144.0/resources/sap/ushell/services/ShellNavigationHashChanger-dbg.js)

### Inner-App vs Cross-App Navigation

`ShellNavigationHashChanger` distinguishes between:

- **Inner-app navigation**: Same semantic object and action, different app route (e.g., `#Order-display&/list` → `#Order-display&/detail/123`). The `&/...` suffix is the inner-app route.
- **Cross-app navigation**: Different semantic object/action (e.g., `#Order-display` → `#Product-manage`).

Classification happens in `treatHashChanged` using `UrlParsing.compareHashes()`, which returns `{ sameIntent, sameParameters }`. The public `isInnerAppNavigation(newHash, oldHash)` method applies the same comparison; `treatHashChanged` does not call it, but `_disableSourceAppRouter` and the `NavigationContext` passed to dirty-state providers do.

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

From this point on, `HashChanger.getInstance()` returns the `ShellNavigationHashChanger`. `createRouterHashChanger()` creates one `RouterHashChanger` and caches it, so the root router of every app component (the shell passes no `_routerHashChanger`), including apps kept alive in the background, gets the same instance. The shell keeps the routers of inactive apps from reacting by stopping them; see [FLP Integration](../reference/architecture.md#flp-integration).

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
      → navigation filters (_disableSourceAppRouter, _handleDataLoss, ...)
      │    a filter returning Custom or Abandon ends the flow here: no event below fires
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

### In-app navigation

In-app route changes, including an app's own `navTo()`, run the same filter. Whether they prompt depends on the dirty state:

| Dirty state                                                | In-app hash change                     |
| ---------------------------------------------------------- | -------------------------------------- |
| `setDirtyFlag(true)`                                       | Prompts, like a cross-app change       |
| Provider returns `false` for `isCrossAppNavigation: false` | Passes; the app router's guards decide |
| Provider ignores the context and returns `true`            | Prompts, like a cross-app change       |

A prompted in-app change does not reach the app router unless the user confirms. A guard router's `navTo()` whose hash write is held back this way settles as `Blocked`; the confirmed change then arrives as a hash change and runs through the guards. Leave guards plus a provider that returns `false` for in-app navigation keep the two scopes apart.

## Production FLP vs Sandbox Preview

The `ShellNavigationHashChanger` replacement is central to understanding how leave guards behave in each environment.

### Production FLP

In production, the FLP replaces the default `sap.ui.core.routing.HashChanger` with its own `ShellNavigationHashChanger`. This hash changer splits the URL into two parts:

- **Shell hash**: `#SemanticObject-action` — managed by the FLP
- **App hash**: the fragment after `&/` — managed by the app's router

The app's router only receives the app hash portion. The app's `Router.parse()` is never called for cross-app navigation: the `shellHashChanged` event does not fire `hashChanged` on the router's hash changer, and `_disableSourceAppRouter` stops the router.

**Consequence**: Leave guards are never triggered by cross-app navigation in production. The FLP's `_handleDataLoss` filter handles dirty state after the browser hash has changed and before the app reacts to it.

### FLP Sandbox Preview (`fiori-tools-preview`)

The sandbox preview provided by `@sap/ux-ui5-tooling` is a lightweight FLP emulation. It boots `sap.ushell` with a mock container and minimal shell services. While the sandbox does not fully replicate the `ShellNavigationHashChanger` split, cross-app navigation via `toExternal()` (FLP home button, tile clicks) still operates at the shell level and does not pass through the app router's `parse()`.

### Leave guards and cross-app navigation

No bypass logic or FLP detection is needed in leave guards. The setup that combines a leave guard with a dirty-state provider is in the library README, [Combining leave guards with FLP dirty-state protection](../../packages/lib/README.md#combining-leave-guards-with-flp-dirty-state-protection).

| Environment         | Cross-app via `toExternal()` triggers `parse()`? | Leave guard behavior |
| ------------------- | ------------------------------------------------ | -------------------- |
| Production FLP      | No (`ShellNavigationHashChanger` intercepts)     | Never reached        |
| FLP sandbox         | No (`toExternal` operates at shell level)        | Never reached        |
| Standalone (no FLP) | N/A (no ushell)                                  | N/A                  |

## Verification Sources

All findings were verified by reading the unminified debug source files hosted on the public SAPUI5 CDN. Each link below opens directly in the browser. Use the browser's find function (`Ctrl+F`) with the search terms listed.

- [`sap/ushell/Container-dbg.js`](https://ui5.sap.com/1.144.0/resources/sap/ushell/Container-dbg.js)
  Search for: `setDirtyFlag`, `getDirtyFlag`, `registerDirtyStateProvider`, `deregisterDirtyStateProvider`, `getDirtyFlagsAsync`, `setAsyncDirtyStateProvider`, `NavigationContext`
- [`sap/ushell/renderer/Shell-dbg.controller.js`](https://ui5.sap.com/1.144.0/resources/sap/ushell/renderer/Shell-dbg.controller.js)
  Search for: `_handleDataLoss`, `_disableSourceAppRouter`, `NavigationFilterStatus`
- [`sap/ushell/services/ShellNavigationHashChanger-dbg.js`](https://ui5.sap.com/1.144.0/resources/sap/ushell/services/ShellNavigationHashChanger-dbg.js)
  Search for: `isInnerAppNavigation`, `treatHashChanged`, `NavigationFilterStatus`

> **Note**: `sap.ushell` is part of SAPUI5, not OpenUI5. These debug files are publicly accessible on the CDN without authentication. The `-dbg.js` suffix indicates the unminified, readable version of the source.
