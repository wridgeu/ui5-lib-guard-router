# Module loading and destroy safety in UI5

## The problem

In UI5, module loading via `sap.ui.require` is asynchronous and **non-cancellable**. Once a load is initiated, the browser fetches the script and the callback will fire — even if the object that requested the load has been destroyed.

This creates a window where a destroyed object receives a callback with a freshly loaded module and acts on it: re-registering listeners, re-initializing state, or calling methods on a dead object.

```
Time ──────────────────────────────────────────────────────►

  router.initialize()
     │
     ├── sap.ui.require(["guards/auth"], callback)
     │        │
     │        │  ◄── HTTP request in flight ──►
     │        │
     ├── router.destroy()          callback fires here
     │    ╰── clears guards         ╰── registers guards on dead router
     │    ╰── detaches listeners    ╰── calls super.initialize() again
     │    ╰── object is "dead"      ╰── attaches new listeners on zombie
```

JavaScript is single-threaded, so the callback fires on a later microtask/macrotask. The object's memory is not freed (the closure holds a reference to `this`), so method calls succeed — they just shouldn't happen.

## Why it can't be aborted

`sap.ui.require` uses `<script>` tag injection to load modules:

```javascript
// ui5loader-dbg.js, loadScript()
function loadScript(oModule) {
	const oScript = document.createElement("SCRIPT");
	oScript.src = oModule.url;
	document.head.appendChild(oScript); // browser starts fetching
}
```

There is no `AbortController`, no `fetch()` call, no cancel handle. The function returns `undefined`. Once the `<script>` tag is in the DOM, the browser will load and execute it.

The `sap.ui.require` function signature:

```javascript
// ui5loader-dbg.js, createContextualRequire()
sap.ui.require = function (vDependencies, fnCallback, fnErrCallback) {
	// ...
	// return undefined;  <-- explicit in source
};
```

Three parameters, no options object, no signal, no return value.

## The "check-then-discard" pattern

Since the load can't be stopped, the standard approach is: let it complete, but check whether the requester is still alive before acting on the result.

### How UI5 does it: `TargetCache`

Source: [`sap/ui/core/routing/TargetCache.js`][targetcache-src] (OpenUI5 1.144.0, Apache-2.0)

When a view or component is loaded asynchronously, the result is chained through `afterLoaded`:

```javascript
// TargetCache.js, _getObjectWithGlobalId(): simplified
function afterLoaded(oObject) {
	if (that._oCache) {
		// ◄── is the TargetCache still alive?
		// Cache the loaded object
		aWrittenIds.forEach(function (sId) {
			oInstanceCache[sId] = oObject;
		});
		// Fire lifecycle event
		that.fireCreated({ object: oObject, type: sType, options: oOptions });
	}
	// If _oCache is undefined → skip silently. Object is discarded.
	return oObject;
}
```

The sentinel is `this._oCache`. It starts as `{ view: {}, component: {} }` in the constructor. On destroy:

```javascript
// TargetCache.js, destroy(): simplified
destroy: function () {
    // For each cached promise: chain .then(destroyObject)
    // so loaded-but-uncached objects are destroyed on arrival
    Object.keys(this._oCache).forEach(function(sType) {
        var oTypeCache = this._oCache[sType];
        Object.keys(oTypeCache).forEach(function(sKey) {
            Object.keys(oTypeCache[sKey]).forEach(function(sId) {
                var vObject = oTypeCache[sKey][sId];
                if (vObject instanceof Promise) {
                    vObject.then(destroyObject);  // ◄── destroy on arrival
                } else {
                    destroyObject(vObject);
                }
            });
        });
    }.bind(this));

    this._oCache = undefined;  // ◄── null the sentinel
    this.bIsDestroyed = true;
};
```

Two layers of safety:

1. **Sentinel nulled** (`_oCache = undefined`) — `afterLoaded` sees it's falsy and skips all work.
2. **Destroy chained** (`.then(destroyObject)`) — the loaded object is cleaned up once it arrives.

### How we do it: guard router `_destroyed` flag

Same pattern, adapted for our use case:

```typescript
// Router.ts — initialize() in "block" mode
const blockLoad = { start: true, ignoreInitialHash: bIgnoreInitialHash };
this._blockLoad = blockLoad;
loadGuardModules(expandedDescriptors).then((results) => {
    this._blockLoad = null;
    if (this._destroyed) return;  // ◄── sentinel check
    // register each module's guards, then:
    if (blockLoad.start) this._start(blockLoad.ignoreInitialHash); // calls super.initialize()
});

// Router.ts — destroy()
override destroy(): this {
    if (this._destroyed) return this;  // a second destroy() does nothing
    this._destroyed = true;  // ◄── set sentinel before any cleanup
    this._pipeline.clear();
    this._pendingGuardDescriptors = [];
    this._sourceDescriptors = [];
    this._cancelPendingNavigation();
    // ...
    super.destroy();
    return this;
}
```

The sentinel is `_destroyed` (a boolean). `destroy()` sets it before any cleanup so that any callback firing after destroy — on the same tick or later — sees it immediately.

## Why the object isn't garbage collected

JavaScript closures keep the enclosing scope alive:

```
┌─ Promise .then() callback (queued on microtask) ─────────┐
│                                                           │
│  Closure captures `this` (the Router instance)            │
│  ╰── this._destroyed                                     │
│  ╰── this._pipeline                                      │
│  ╰── super.initialize (bound to MobileRouter prototype)  │
│                                                           │
│  The Router object CANNOT be garbage collected            │
│  until this Promise resolves and the closure is released. │
└───────────────────────────────────────────────────────────┘
```

`destroy()` clears the router's internal state (pipeline, descriptors, metadata, settlement resolvers) but the JavaScript object stays in memory. It has no event listeners and `_destroyed === true` but it's still a valid object with callable methods. Without the sentinel check, `super.initialize()` would succeed and re-attach hash listeners on a "zombie" router that nobody holds a reference to (except the closure).

The sentinel check runs before any guard is registered, so modules that arrive after `destroy()` register no guards and `super.initialize()` never runs. `loadGuardModules()` never rejects: a module that fails to load is logged and skipped, so no `.catch()` is needed.

Once the Promise resolves, the closure releases `this`, and the router becomes eligible for garbage collection.

### stop() and initialize() while modules load

UI5's router stays stopped after `stop()` until `initialize()` is called again, and treats a second `initialize()` as a no-op. Block mode keeps both rules while modules load. `_blockLoad` is set for the duration of the load, and its `start` flag decides whether the load callback calls `super.initialize()`:

- `stop()` clears `start`. The guards are still registered when loading finishes, but the router does not start.
- `initialize()` sets `start` and returns. A second call while loading therefore does not start the router before its manifest guards exist, and a call after `stop()` restores the pending start. The call that sets `start` also decides `bIgnoreInitialHash` for the deferred `super.initialize()`.
- `navTo()` while loading is not intercepted (see the library README, [Lifecycle](../../packages/lib/README.md#lifecycle)). The load callback starts the router, which parses that hash through all guards.

### destroy() twice

`sap.ui.core.routing.Router#destroy` returns early when the router is already destroyed, but `sap.m.routing.Router#destroy` does not and fails on its cleared target handler. The guard router returns early on `_destroyed`, so destroying it twice (e.g. by the app and later by its component) is safe.

## Lazy mode and destroy safety

In lazy mode (`guardLoading: "lazy"`, the default), `initialize()` is synchronous -- there is no async module load before `super.initialize()`, so the destroy-during-init race window does not exist. The module-load check of `_destroyed` in `initialize()` is only needed for block mode, where `initialize()` defers `super.initialize()` until modules have loaded. `parse()` and `destroy()` read `_destroyed` in every mode: `parse()` hands a hash change that reaches a destroyed router to the base router, and `destroy()` returns early on a second call.

Mid-navigation destroy is handled in all modes by the generation counter and `AbortController`. When `destroy()` is called during a navigation:

1. The generation counter increments, causing the in-flight pipeline to discard its result.
2. The `AbortController` fires, signalling guards to cancel async work (e.g. `fetch`).
3. The guard pipeline is cleared, so later navigations run no guards. The in-flight run iterates a snapshot of the guard arrays, so the aborted signal is what stops it: the pipeline checks the signal before each remaining guard of a phase in which a guard returned a Promise, and before starting the next phase. A lazy wrapper whose module was not cached checks it once the module has loaded and returns `false` instead of running the guards. A lazily loaded multi-guard module also checks it after each of its guards that returns a Promise.

## Summary

| Concern              | UI5 TargetCache                              | Guard Router                                                                      |
| -------------------- | -------------------------------------------- | --------------------------------------------------------------------------------- |
| Sentinel field       | `_oCache` (nulled to `undefined`)            | `_destroyed` (set to `true`)                                                      |
| Check location       | `afterLoaded` callback                       | `.then()` in `initialize()` (block mode); `parse()` and `destroy()` in every mode |
| Cleanup on arrival   | `.then(destroyObject)` on cached promises    | Not needed (guards are stateless functions)                                       |
| Set order in destroy | After iterating cache, before `bIsDestroyed` | Before any cleanup (clearing guards etc.)                                         |

[targetcache-src]: https://github.com/UI5/openui5/blob/1.144.0/src/sap.ui.core/src/sap/ui/core/routing/TargetCache.js
