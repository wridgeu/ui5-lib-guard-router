# Research: UI5 View Caching and Controller Lifecycle in Routing

> **Date**: 2026-03-17
> **UI5 version analyzed**: OpenUI5 1.144.0
> **Context**: The guard router's lifecycle guidance (README line 434) states that "UI5's routing caches views indefinitely, so `onExit` is called only when the component is destroyed, not on every navigation away." This document provides the source-level evidence behind that claim, documents what lifecycle hooks exist (and don't exist) for navigation-away scenarios, and clarifies common misconceptions around the `sap-ui-xx-viewCache` flag.

## Summary

UI5's routing framework caches every view instance indefinitely in a plain JavaScript object (`TargetCache._oCache`) with no TTL, no eviction, no size limit, and no configuration to disable it. When a user navigates away from a route, the previous view is not destroyed — it remains in the cache and is reused if the route is visited again. `Controller.onExit()` is wired exclusively to `View.beforeExit`, which fires only during `View.destroy()`. Since routing never destroys cached views during navigation, `onExit()` never fires during normal in-app navigation.

There are **no** controller-level hooks for navigation away (`onBeforeHide`, `onAfterHide`, etc.). The only way to detect that a route is no longer active is to listen to route events (`routeMatched`, `patternMatched`) on the new route, or to the private `switched` event on the old route.

## The Cache: `TargetCache.js`

All routing-created views are stored in `TargetCache`, the base class of `Views`. The cache is a plain nested object:

```js
// TargetCache.js — constructor
this._oCache = {
	view: {},
	component: {},
};
```

The storage structure is `_oCache["view"][viewName][viewId]`. The lookup in `_getObjectWithGlobalId`:

```js
// TargetCache.js — _getObjectWithGlobalId
sName = oOptions.usage || oOptions.name;
oInstanceCache = this._oCache[sType.toLowerCase()][sName];
vPromiseOrObject = oInstanceCache && oInstanceCache[oOptions.id];

if (bNoCreate || vPromiseOrObject) {
	return vPromiseOrObject; // returns cached instance, never re-creates
}
```

**There is no eviction logic.** No TTL, no LRU, no max-size check, no `WeakRef`. The only way to clear the cache is to call `destroy()` on the `TargetCache` instance, which destroys the entire Router (and therefore all cached views):

```js
// TargetCache.js — destroy
TargetCache.prototype.destroy = function () {
	// iterates _oCache and destroys every cached view/component
	EventProvider.prototype.destroy.apply(this, arguments);
};
```

There is no public API to remove a single cached view. The `set()` method can overwrite a cached entry, but this is not commonly used and does not destroy the previous instance.

**Source**: [`sap/ui/core/routing/TargetCache.js`](https://github.com/UI5/openui5/blob/main/src/sap.ui.core/src/sap/ui/core/routing/TargetCache.js)

## No Cache Configuration on Targets

The target configuration type (`sap.ui.core.routing.$TargetSettings`) has no property to control caching behavior. The available target config properties are: `type`, `name`, `usage`, `id`, `path`, `viewType`, `controlId`, `controlAggregation`, `clearControlAggregation`, `parent`, `title`, `level`, `transition`, `transitionParameters`, `options`, `containerOptions`.

**There is no `keepAlive`, `cache`, `cacheable`, or similar property.** Caching is always on, unconditionally, for every target.

The instance uniqueness rule from the `Target.js` JSDoc: _"Instance of View or Component will only be created once per `name` or `usage` combined with `id`."_ Two targets pointing to the same `name` without different `id` values will share the **exact same view instance**. To get separate instances, you must provide different `id` values in target config.

## The `Views` Class: Thin Wrapper

`sap.ui.core.routing.Views` extends `TargetCache` with a minimal wrapper:

```js
// Views.js
getView: function(oOptions) {
    return this.get(oOptions, "View");
},
setView: function(sViewName, oView) {
    return this.set(sViewName, "View", oView);
}
```

All actual caching logic lives in `TargetCache`. The `created` event fires only when a **new** view is created. From the source: _"It will not be fired, if a view or component was read from the cache."_

**Source**: [`sap/ui/core/routing/Views.js`](https://github.com/UI5/openui5/blob/main/src/sap.ui.core/src/sap/ui/core/routing/Views.js)

## Controller Lifecycle: When `onExit()` Fires

The four controller lifecycle hooks and their triggers:

| Hook                  | Wired to                | When it fires                                |
| --------------------- | ----------------------- | -------------------------------------------- |
| `onInit()`            | `View.afterInit` event  | Once, when the view is first created         |
| `onExit()`            | `View.beforeExit` event | Once, when the view is **destroyed**         |
| `onBeforeRendering()` | `View.beforeRendering`  | Every time before the view is rendered       |
| `onAfterRendering()`  | `View.afterRendering`   | Every time after the view is rendered to DOM |

The wiring happens in `Controller.connectToView()`:

```js
// Controller.js — connectToView
if (this.onExit) {
    const fnExit = function() {
        _enforceNoReturnValue(this.onExit.apply(this, arguments), ...);
    };
    oView.attachBeforeExit(fnExit, this);
}
```

The `beforeExit` event fires from `View.exit()`, which is called during `View.destroy()`:

```js
// View.js — exit (called by ManagedObject.destroy)
View.prototype.exit = function () {
	this.fireBeforeExit();
	if (this.oController && this.bControllerIsViewManaged) {
		this.oController.destroy();
		delete this.oController;
	}
};
```

The chain is: **`View.destroy()` → `View.exit()` → `fireBeforeExit()` → `Controller.onExit()`**

The JSDoc in `Controller.js` confirms: _"This method is called upon destruction of the View. The controller should perform its internal destruction in this hook. It is only called once per View instance."_

**Since routing caches views indefinitely, `onExit()` is effectively never called during normal in-app navigation.** It only fires when:

1. The **Router is destroyed** (which destroys the `TargetCache`, which destroys all cached views) — typically because the owning Component was destroyed.
2. The view is **explicitly destroyed** via application code.

**Source**: [`sap/ui/core/mvc/Controller.js`](https://github.com/UI5/openui5/blob/main/src/sap.ui.core/src/sap/ui/core/mvc/Controller.js), [`sap/ui/core/mvc/View.js`](https://github.com/UI5/openui5/blob/main/src/sap.ui.core/src/sap/ui/core/mvc/View.js)

## No Navigation-Away Controller Hooks

There are **no `onBeforeHide`, `onAfterHide`, `onBeforeShow`, or `onAfterShow` controller lifecycle hooks** in UI5. These sometimes appear in developer expectations by analogy with mobile frameworks or `sap.m.NavContainer` events, but they do not exist on `sap.ui.core.mvc.Controller`.

`sap.m.NavContainer` does fire `beforeHide`, `afterHide`, `beforeShow`, and `afterShow` events on the container control itself during page transitions. However, these are control-level events, not controller lifecycle hooks. A controller would need to explicitly listen to them on the parent `NavContainer`, and the events carry the page control (the view) as a parameter — they are not automatically dispatched to the controller.

## What Happens When Navigating Away

When a different route matches, the following sequence occurs:

### 1. Old route: `_routeSwitched` → `suspend()`

The `crossroads.js` library (embedded in `sap.ui.core.routing`) fires a `switched` signal on the previous route:

```js
// Route.js — _routeSwitched
_routeSwitched: function() {
    this._suspend();
    this.fireEvent("switched", { name: this._oConfig.name });
}
```

The `_suspend` method calls `Targets.suspend()` for the route's targets.

### 2. `Target.suspend()` — a no-op for views

```js
// Target.js — suspend
suspend: function() {
    if (this._oParent) {
        this._oParent.suspend();
    }
    if (this._isLoaded()) {
        var oObject = this._get(), oRouter;
        if (oObject.isA("sap.ui.core.UIComponent") &&
            (oRouter = oObject.getRouter()) &&
            oObject.hasNativeRouter()) {
            oRouter.stop();
        }
    }
    return this;
};
```

**For View targets, `suspend()` does nothing meaningful.** It recurses to parent targets and checks if the loaded object is a `UIComponent` (which a View is not). No event is fired, no state is changed, and the view remains in the DOM aggregation of its container control until the new route's target replaces it.

**Source**: [`sap/ui/core/routing/Target.js`](https://github.com/UI5/openui5/blob/main/src/sap.ui.core/src/sap/ui/core/routing/Target.js)

### 3. New route: display targets

The new route's `_routeMatched` handler calls `Targets.display()`, which places the target view(s) into the container control's aggregation (e.g., `NavContainer.pages`). If the target config has `clearControlAggregation: true`, the previous content is removed from the aggregation first. The old view is not destroyed — just removed from the visible aggregation. It remains in the `TargetCache`.

### 4. Events fired (in order)

| Event                        | Fires on  | When                                              |
| ---------------------------- | --------- | ------------------------------------------------- |
| `Route.switched`             | Old route | Before new route processes (private/internal)     |
| `Route.beforeMatched`        | New route | Before targets display                            |
| `Router.beforeRouteMatched`  | Router    | Before targets display                            |
| Target `display` events      | Target(s) | As each target view is placed                     |
| `Route.matched`              | New route | After targets displayed                           |
| `Router.routeMatched`        | Router    | After any route matches                           |
| `Route.patternMatched`       | New route | Only for the directly matched route (not parents) |
| `Router.routePatternMatched` | Router    | Only for the directly matched route               |

The common developer pattern for detecting "my route became active" is to attach a handler to `routeMatched` or `patternMatched` on the target route. There is **no built-in event for "my route is being navigated away from"** at the controller level. The `Route.switched` event is internal and not part of the public API.

## Clarification: `sap-ui-xx-viewCache` Is Unrelated

The `sap-ui-xx-viewCache` (or `sap-ui-xx-view-cache`) URL parameter controls **XML View preprocessing cache**, a completely separate mechanism from the routing instance cache.

From `XMLView.js`:

```js
// XMLView.js — static init
XMLView._bUseCache =
	BaseConfig.get({
		name: "sapUiXxViewCache",
		type: BaseConfig.Type.Boolean,
		defaultValue: true,
		external: true,
	}) && Cache._isSupportedEnvironment();
```

Usage in `XMLView.initViewSettings`:

```js
if (mSettings.cache && XMLView._bUseCache) {
	return processCache(sResourceName, mSettings.cache).then(processView);
} else {
	return loadResourceAsync(sResourceName).then(runPreprocessorsAsync).then(processView);
}
```

**What it does**: When set to `false` (`?sap-ui-xx-viewCache=false`), it disables the browser-side cache of **preprocessed XML view definitions**. This cache stores the result of XML preprocessing (template processing, binding resolution) so that repeated creation of the same XML view doesn't re-run preprocessors. It uses the browser's Cache API.

**What it does NOT do**: It has zero effect on the routing `TargetCache` (the in-memory instance cache of view objects). Setting `sap-ui-xx-viewCache=false` will not cause the router to create new view instances on each navigation.

The `xx` prefix indicates it is an experimental feature. Both camelCase (`sap-ui-xx-viewCache`) and kebab-case (`sap-ui-xx-view-cache`) forms work identically.

**Source**: [`sap/ui/core/mvc/XMLView.js`](https://github.com/UI5/openui5/blob/main/src/sap.ui.core/src/sap/ui/core/mvc/XMLView.js)

## FLP `sap-keep-alive` Interaction

`sap-keep-alive` is a **Fiori Launchpad feature**, not a UI5 core feature. It operates at the Component level, above the routing layer.

| Scenario                                           | Component destroyed? | Views destroyed? | `onExit` fires? |
| -------------------------------------------------- | -------------------- | ---------------- | --------------- |
| In-app navigation (route A → route B)              | No                   | No (cached)      | **No**          |
| Cross-app navigation, no `sap-keep-alive`          | Yes                  | Yes              | **Yes**         |
| Cross-app navigation, `sap-keep-alive=true`        | No                   | No               | **No**          |
| Cross-app navigation, `sap-keep-alive=restricted`  | No (with limits)     | No               | **No**          |
| Navigate to FLP home page (even with `keep-alive`) | Yes                  | Yes              | **Yes**         |

When `sap-keep-alive` is active and the user navigates back to the app, **no `onInit()` fires** (the view was never destroyed and recreated). The state from the previous session is fully preserved: model data, scroll positions, controller instance variables, and registered guards.

The FLP destroys the persisted Component when navigating to the **home page** or any other launchpad page that is not a cross-app navigation target.

## Implications for Guard Registration

### Component-level guards (recommended default)

Guards registered in `Component.init()` persist for the Component's lifetime. The router's `destroy()` method automatically clears all registered guards when the Component is destroyed. No manual cleanup needed.

### Controller-level guards

Guards registered in a controller's `onInit()` persist across in-app navigations because the view (and therefore the controller) is never destroyed during routing. Cleanup in `onExit()` is correct — it fires when the Component is destroyed, which is the same moment the Router is destroyed and guards become meaningless.

This persistence is typically the desired behavior:

- A leave guard protecting "editOrder" should always be present when the route is visited, not re-registered on every visit.
- An enter guard checking authentication should persist to protect against repeated navigation attempts.

The one case where this matters: if a guard captures mutable state in its closure, the captured reference remains the same across navigations. This is why the guard router provides `GuardContext.signal` (AbortSignal) for cancellation, and why guards should read state from models or services at invocation time rather than capturing values in the closure at registration time.

### The "view destroyed without onExit" edge case

Exploration 08 mentions: _"If a view is destroyed without `onExit` (edge case), the guard function references a dead controller."_ This is a theoretical concern. In practice, `View.destroy()` always calls `View.exit()`, which always fires `beforeExit`, which triggers `onExit()`. The only scenario where a guard could reference a dead controller is if the guard is registered on a different router instance than the one that owns the view — an application-level bug, not a framework limitation.

## Verification Sources

All findings were verified by reading the OpenUI5 source on GitHub and the unminified SAPUI5 CDN debug files.

### OpenUI5 GitHub (MIT-licensed, authoritative)

- [`sap/ui/core/routing/TargetCache.js`](https://github.com/UI5/openui5/blob/main/src/sap.ui.core/src/sap/ui/core/routing/TargetCache.js) — `_oCache` structure, `_getObjectWithGlobalId`, `destroy`
- [`sap/ui/core/routing/Views.js`](https://github.com/UI5/openui5/blob/main/src/sap.ui.core/src/sap/ui/core/routing/Views.js) — thin wrapper over `TargetCache`
- [`sap/ui/core/routing/Target.js`](https://github.com/UI5/openui5/blob/main/src/sap.ui.core/src/sap/ui/core/routing/Target.js) — `suspend()`, `_place()`, `display()`
- [`sap/ui/core/routing/Targets.js`](https://github.com/UI5/openui5/blob/main/src/sap.ui.core/src/sap/ui/core/routing/Targets.js) — `suspend()` delegation
- [`sap/ui/core/routing/Route.js`](https://github.com/UI5/openui5/blob/main/src/sap.ui.core/src/sap/ui/core/routing/Route.js) — `_routeMatched`, `_routeSwitched`, event sequence
- [`sap/ui/core/routing/Router.js`](https://github.com/UI5/openui5/blob/main/src/sap.ui.core/src/sap/ui/core/routing/Router.js) — `destroy`, view lifecycle orchestration
- [`sap/ui/core/mvc/Controller.js`](https://github.com/UI5/openui5/blob/main/src/sap.ui.core/src/sap/ui/core/mvc/Controller.js) — `connectToView`, `onExit` wiring
- [`sap/ui/core/mvc/View.js`](https://github.com/UI5/openui5/blob/main/src/sap.ui.core/src/sap/ui/core/mvc/View.js) — `exit()`, `fireBeforeExit`, destroy chain
- [`sap/ui/core/mvc/XMLView.js`](https://github.com/UI5/openui5/blob/main/src/sap.ui.core/src/sap/ui/core/mvc/XMLView.js) — `_bUseCache`, `sapUiXxViewCache` preprocessing cache

### SAP Community and Documentation

- [Controller Lifecycle Methods Explained (SAP Blog)](https://community.sap.com/t5/technology-blog-posts-by-sap/sapui5-controller-lifecycle-methods-explained/ba-p/13364874)
- [When onExit() will be executed? (SAP Community Q&A)](https://community.sap.com/t5/technology-q-a/when-onexit-will-be-executed/qaq-p/372607)
- [SAPUI5 Routing Configuration](https://ui5.sap.com/sdk/docs/topics/902313063d6f45aeaa3388cc4c13c34e.html)
- [Methods and Events for Navigation](https://ui5.sap.com/sdk/docs/topics/516e477e7e0b4e188b19a406e7528c1e.html)
- [Keep Alive Mode for SAP Fiori Apps](https://help.sap.com/doc/34796706f38646f68d51a0fa0d4636e4/100/en-US/d6d3f3ed187f47799712cc88d7bb548f.html)
- [Refresh Entity Sets in sap-keep-alive Mode](https://ui5.sap.com/sdk/#/topic/3c65f2cc630c472da8328a6f3c193683.html)
