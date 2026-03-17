# Library Loading Order: When Does `library.js` Run Relative to `routerClass`?

## Question

When a manifest.json declares `"routerClass": "ui5.guard.router.Router"`, does UI5 load `ui5/guard/router/library` (which runs `Lib.init()` and `DataType.registerEnum`) before loading the Router module?

## Answer

**Yes.** Library dependencies declared in `sap.ui5/dependencies/libs` are fully loaded (including their `library.js` entry module) before routing classes are resolved. This is guaranteed by the Component loading sequence in `sap/ui/core/Component.js`.

## Source Code Evidence

### Component.js (v1.144, line 2764-2782)

The `componentFactory` function chains library loading before routing class loading:

```js
// Component.js line 2764
return loadDependenciesAndIncludes(oClass.getMetadata()).then(async function () {
    // [1] after evaluating the manifest & loading the necessary dependencies,
    //     we make sure the routing related classes are required before
    //     instantiating the Component
    const aRoutingClassNames = findRoutingClasses(oClassMetadata);
    const aModuleLoadingPromises = aRoutingClassNames.map((vClass) => {
        // ...
        return loadModuleAndLog(vClass, sComponentName);
    });
```

Source: `sap/ui/core/Component.js` lines 2764-2782 in OpenUI5 1.144.0

`loadDependenciesAndIncludes` must resolve (`.then`) before `findRoutingClasses` and `loadModuleAndLog` execute. The `loadDependenciesAndIncludes` call triggers `Manifest.loadDependenciesAndIncludes(true)`, which calls `_loadDependencies`, which calls `Library._load` for each library in `sap.ui5/dependencies/libs`.

### Lib.load API (official documentation)

The [`Lib.load`](https://openui5.org/1.144.0/api/sap.ui.core.Lib/methods/load) API documentation states:

> "For applications that follow the best practices and use components with component descriptors (manifest.json), the framework will load all declared mandatory libraries and their dependencies automatically before instantiating the application component."

> "Only then the library entry module (named `your/lib/library.js`) will be required and executed."

### What `Library._load` does

When `Library._load("ui5.guard.router")` is called (from `_loadDependencies`), it:

1. Loads the library preload bundle (`library-preload.js`)
2. Evaluates dependency information from the bundle
3. Requires the library entry module: `sap.ui.require("ui5/guard/router/library")`
4. The library entry module executes `Lib.init()` and `DataType.registerEnum()`

Source: `sap/ui/core/Lib.js`, `_load` and `requireLibrariesAsync` methods

### UIComponent.init (v1.144, line 343-345)

By the time the Component constructor runs and `UIComponent.init` creates the Router, all library modules and routing classes are already in the module registry:

```js
// UIComponent.js line 343
const mRoutingClasses = this.getMetadata().collectRoutingClasses(this) || {};
if (mRoutingClasses.routerClass) {
    var fnRouterConstructor = mRoutingClasses.routerClass;
```

`collectRoutingClasses` calls `getConstructorFunctionFor(sClassName)` (line 954), which does a synchronous `sap.ui.require` lookup. This works because the module was already loaded in the earlier async step.

Source: `sap/ui/core/UIComponent.js` lines 343-345 and 900-959 in OpenUI5 1.144.0

## Loading Timeline

```
Component.create("demo.app")
  |
  +-- loadDependenciesAndIncludes()           // STEP 1: libraries
  |     |
  |     +-- _loadDependencies()
  |     |     +-- Library._load("sap.m")
  |     |     +-- Library._load("sap.ui.core")
  |     |     +-- Library._load("ui5.guard.router")
  |     |           |
  |     |           +-- load library-preload.js
  |     |           +-- sap.ui.require("ui5/guard/router/library")
  |     |                 |
  |     |                 +-- Lib.init()
  |     |                 +-- DataType.registerEnum("ui5.guard.router.NavigationOutcome", ...)
  |     |
  |     +-- resolve Promise
  |
  +-- .then(async function () {               // STEP 2: routing classes
  |     |
  |     +-- findRoutingClasses()
  |     |     +-- reads "routerClass": "ui5.guard.router.Router"
  |     |     +-- converts to "ui5/guard/router/Router"
  |     |
  |     +-- loadModuleAndLog("ui5/guard/router/Router")
  |           +-- sap.ui.require("ui5/guard/router/Router")
  |                 +-- Router module loaded (its AMD dep on ./library already satisfied)
  |
  +-- createInstance()                        // STEP 3: instantiation
        +-- new Component()
              +-- UIComponent.prototype.init()
                    +-- new Router(routes, config)
```

## Implications for `import "./library"` in Router.ts

The `import "./library"` in `Router.ts` is a **redundant safeguard** for the normal manifest-based flow. Library dependencies are always loaded first. However, it protects against an edge case: a consumer doing a bare `sap.ui.require("ui5/guard/router/Router")` without declaring the library in `sap.ui5/dependencies/libs`. In that scenario, `library.js` would never execute, and `DataType.registerEnum` would not run.

Note that `sap.m.routing.Router` does **not** import `sap/m/library`. Its AMD dependencies are only `sap/ui/core/routing/Router`, `./TargetHandler`, and `./Targets`. SAP's own router relies entirely on the manifest-based library loading guarantee.

## The module loader has no library awareness

The core module loader (`ui5loader.js`) is a plain AMD-style system with no concept of UI5 libraries. Requiring `ui5/guard/router/Router` does NOT automatically trigger `ui5/guard/router/library`. Library loading is a framework-level concern managed by `Lib.js` and `Component.js`, not the module loader.

## References

- [Lib.load API](https://openui5.org/1.144.0/api/sap.ui.core.Lib/methods/load)
- [Component.create API](https://openui5.org/1.144.0/api/sap.ui.core.Component/methods/create)
- [Descriptor Dependencies to Libraries](https://ui5.sap.com/docs/topics/28fcd55b04654977b63dacbee0552712.html)
- Source: `sap/ui/core/Component.js` lines 2752-2782 (OpenUI5 1.144.0)
- Source: `sap/ui/core/UIComponent.js` lines 343-345, 900-959 (OpenUI5 1.144.0)
- Source: `sap/ui/core/Lib.js` `_load` and `requireLibrariesAsync` methods (OpenUI5 1.144.0)
