# Module loading and destroy safety in UI5

## The problem

`sap.ui.require` loads modules asynchronously and cannot be cancelled. Once a load has started, its callback fires, also when the object that requested the load has been destroyed in the meantime. The closure keeps the destroyed object alive, so its methods still run: without a check, the callback re-registers listeners or re-initializes state on a dead object.

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

## Why it can't be aborted

`sap.ui.require(vDependencies, fnCallback, fnErrCallback)` takes no options and returns `undefined`. The loader (`ui5loader-dbg.js`, `loadScript()`) appends a `<script>` element to the document, and the browser loads and executes it. There is no `AbortController`, no `fetch()` and no handle to cancel.

## The "check-then-discard" pattern

The load is allowed to complete, and the callback checks whether the requester is still alive before it acts on the result.

### How UI5 does it: `TargetCache`

Source: [`sap/ui/core/routing/TargetCache.js`][targetcache-src] (OpenUI5 1.144.0, Apache-2.0)

A view or component loaded asynchronously goes through `afterLoaded`:

```javascript
// TargetCache.js, _getObjectWithGlobalId(): simplified
function afterLoaded(oObject) {
	if (that._oCache) {
		// ◄── is the TargetCache still alive?
		aWrittenIds.forEach(function (sId) {
			oInstanceCache[sId] = oObject;
		});
		that.fireCreated({ object: oObject, type: sType, options: oOptions });
	}
	// If _oCache is undefined: skip silently, the object is discarded.
	return oObject;
}
```

The sentinel is `this._oCache`, `{ view: {}, component: {} }` from the constructor on. `destroy()` has two layers:

1. For each cached entry that is still a Promise, it chains `.then(destroyObject)`, so an object that arrives later is destroyed on arrival. Loaded objects are destroyed at once.
2. It sets `_oCache = undefined`, then `bIsDestroyed = true`. `afterLoaded` sees the falsy sentinel and skips all work.

### How the guard router does it: `_destroyed`

`initialize()` in block mode (`guardLoading: "block"`) loads the guard modules with `loadGuardModules()` and registers their guards in the `.then()` callback. The callback returns at once if `_destroyed` is set, before any guard is registered and before `_start()` calls `super.initialize()`. `destroy()` sets `_destroyed` first, before it clears the pipeline, the descriptors and the metadata and cancels the pending navigation, so every callback that fires after `destroy()` sees it. `loadGuardModules()` never rejects: a module that fails to load is logged and skipped, so no `.catch()` is needed.

The callback holds `this` until the Promise resolves; after that the router can be garbage collected.

### stop() and initialize() while modules load

UI5's router stays stopped after `stop()` until `initialize()` is called again, and treats a second `initialize()` as a no-op. Block mode keeps both rules while modules load. `_blockLoad` is set for the duration of the load, and its `start` flag decides whether the load callback calls `super.initialize()`:

- `stop()` clears `start`. The guards are still registered when loading finishes, but the router does not start.
- `initialize()` sets `start` and returns. A second call while loading therefore does not start the router before its manifest guards exist, and a call after `stop()` restores the pending start. The call that sets `start` also decides `bIgnoreInitialHash` for the deferred `super.initialize()`.
- `navTo()` while loading is not intercepted (see the library README, [Lifecycle](../../packages/lib/README.md#lifecycle)). The load callback starts the router, which parses that hash through all guards.

### destroy() twice

`sap.ui.core.routing.Router#destroy` returns early when the router is already destroyed, but `sap.m.routing.Router#destroy` does not and fails on its cleared target handler. The guard router returns early on `_destroyed`, so destroying it twice (e.g. by the app and later by its component) is safe.

## Lazy mode and destroy safety

In lazy mode (`guardLoading: "lazy"`, the default), `initialize()` calls `super.initialize()` synchronously, so there is no load to race with `destroy()`. `initialize()`, `navTo()`, `parse()` and `destroy()` read `_destroyed` in every mode: `initialize()` and `navTo()` warn and return `this`, `parse()` hands a hash change that reaches a destroyed router to the base router, and `destroy()` returns early on a second call.

A navigation in progress when `destroy()` is called ends the same way in all modes:

1. The guard pipeline is cleared, so later navigations run no guards. The in-flight run iterates a snapshot of the guard arrays, so the aborted signal is what stops it: the pipeline checks the signal after each sync guard, before each remaining guard of a phase in which a guard returned a Promise, and before starting the next phase. A lazy wrapper whose module was not cached checks it once the module has loaded and returns `false` instead of running the guards. A lazily loaded multi-guard module also checks it after each guard (sync or async).
2. The generation counter increments, so the in-flight pipeline discards its result.
3. The `AbortController` aborts, which tells guards to cancel async work (e.g. `fetch`).

## Summary

| Concern              | UI5 TargetCache                              | Guard Router                                                                                                 |
| -------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Sentinel field       | `_oCache` (nulled to `undefined`)            | `_destroyed` (set to `true`)                                                                                 |
| Check location       | `afterLoaded` callback                       | `.then()` in `initialize()` (block mode); `initialize()`, `navTo()`, `parse()` and `destroy()` in every mode |
| Cleanup on arrival   | `.then(destroyObject)` on cached promises    | Not needed (guards are stateless functions)                                                                  |
| Set order in destroy | After iterating cache, before `bIsDestroyed` | Before any cleanup (clearing guards etc.)                                                                    |

[targetcache-src]: https://github.com/UI5/openui5/blob/1.144.0/src/sap.ui.core/src/sap/ui/core/routing/TargetCache.js
