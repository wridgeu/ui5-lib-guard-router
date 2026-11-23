# Multi-Guard Modules, Named Guards & Pattern 5 Loading

> **Status**: Implemented

**Evolves**: [08](./08-declarative-manifest-guards.md)

## Summary

Three changes to manifest guards:

1. **Pattern 5 loading.** `"lazy"` becomes the default `guardLoading`, implemented as a preload plus lazy wrappers. `initialize()` is synchronous in this mode.
2. **Multi-guard modules.** One module can export several guards: a function, an array or a plain object.
3. **Named guards.** Every manifest guard gets a name for its log messages. `#` picks a single export from a module.

## 1. Pattern 5: preload + lazy

| `guardLoading`     | Behavior                     | `initialize()`                              |
| ------------------ | ---------------------------- | ------------------------------------------- |
| `"lazy"` (default) | Preload hint + lazy wrappers | Synchronous                                 |
| `"block"`          | Load all modules, then start | Asynchronous (the start waits for the load) |

The default flipped from `"block"` to `"lazy"` before manifest guards shipped, so no consumer saw a change.

**Constructor.** In lazy mode, when at least one manifest guard module is declared, it fires `sap.ui.require(uniquePaths, undefined, () => {})` for the deduplicated module paths, without the `#` part. The error callback is empty: a failed load is reported when the guard runs, its lazy load warns, and the navigation settles as `Error`.

**`initialize()`.** Registers the guards from `createLazyGuards()` (`GuardModules.ts`) for each descriptor, then starts the router synchronously. Per descriptor:

- **Cherry-pick (`module#export`):** one wrapper. On first use it takes the module from the cache or loads it, resolves the export once (so a missing export warns once) and caches the resolved guard list for synchronous runs on later navigations. A missing export yields no guard, so the wrapper allows.
- **Bare path, module cached** (the preload finished): the module's guards themselves, registered individually.
- **Bare path, cache miss:** one wrapper that loads the module on first use and runs all of its guards in order. Later navigations run them synchronously.

A module that fails to load rejects the wrapper's Promise, so the navigation settles as `Error`. If the navigation was aborted while the module loaded, the wrapper returns `false`.

Why not expand a bare path into its guards from inside the wrapper on first use: the pipeline already iterates its guard list for the current navigation, so guards registered then would miss it.

Why this beats both earlier modes:

- `initialize()` has no async gap, so there is no destroy race during start. Only block mode needs the `_destroyed` check after its load.
- Guard modules are small and the preload starts in the constructor, so they are usually cached by the first navigation. Then lazy behaves like block.
- If the preload has not finished, the module loads on the first navigation, as in the old lazy mode.
- A destroy during a navigation is handled by the generation counter and the `AbortController` in both modes.

Block mode keeps its behavior for consumers who need every module loaded before the first navigation. A module that fails to load there is warned about and skipped.

## 2. Export shapes

A module picks one shape:

```typescript
// guards/auth.ts: one guard, named "auth" (last path segment)
export default function (context: GuardContext): GuardResult {
	return checkAuth();
}

// guards/checks.ts: ordered guards, named "checks#0", "checks#1". Array order is execution order.
export default [(context: GuardContext) => checkA(), (context: GuardContext) => checkB()];

// guards/security.ts: named guards "checkAuth", "checkRole". Key order is execution order (ES2015+).
export default {
	checkAuth(context: GuardContext): GuardResult { ... },
	checkRole(context: GuardContext): GuardResult { ... },
};
```

`resolveModuleExports()` detects the shape:

```
typeof export === "function"            -> one guard
Array.isArray(export)                   -> ordered guards
plain object (Object or null prototype) -> guards in key order
anything else                           -> warning, module skipped
```

- Non-function entries in an array or object are warned about and skipped one by one.
- An empty array or object logs a warning and registers no guard; it is likely a mistake.
- The module is read as the value it gives the UI5 loader, which has no ES module interop. The UI5 transpiler returns the default export as that value, with named exports beside it as properties. A module with only named exports becomes `{ __esModule: true, ... }`; the `__esModule` key is ignored.
- The router checks only `typeof fn === "function"`. When one module serves both enter and leave guards (for example two cherry-picks), its author must match each function to its use. A leave guard that returns a non-boolean is blocked at runtime with a warning.
- The same module listed twice (`["guards.security", "guards.security#checkAuth"]`) registers its guards for each entry, so `checkAuth` runs twice. There is no deduplication, as with `addRouteGuard()`.

## 3. Cherry-pick syntax

```json
"guards": {
	"admin": ["guards.security#checkAuth", "guards.security#checkRole"],
	"dashboard": ["guards.security"],
	"settings": ["guards.checks#1"],
	"*": ["guards.logging"]
}
```

| Entry                         | Registers                                                                                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"guards.security"`           | All exports, in key or array order                                                                                                                                                           |
| `"guards.security#checkAuth"` | The object key `checkAuth`                                                                                                                                                                   |
| `"guards.security#1"`         | The array index 1, or for an object the key `"1"` if present, else the entry at position 1 in key order                                                                                      |
| `"guards.auth#name"`          | For a single-function module, a function property `name` of it (a named export beside the default). Without one, `#name` is ignored with a debug log and the default function is registered. |

A missing key, an index out of range or a value that is not a function: warning, nothing registered.

`parseGuardEntry()` in `GuardConfig.ts` splits on the first `#`. `#` never occurs in UI5 module paths (dots and slashes only), so the separator is safe. Then `resolveGuardModulePath()` handles a `module:` prefix on the base path: `"module:some.other.lib.guards#checkAuth"` becomes module path `some/other/lib/guards`, export key `checkAuth`. The descriptor stores `exportKey`:

```typescript
interface GuardDescriptor {
	readonly route: string; // "*" for global
	readonly type: "enter" | "leave";
	readonly modulePath: string;
	readonly exportKey?: string; // "checkAuth", "1", or undefined without #
}
```

## 4. Named guards

Each manifest guard gets a name derived from its module and export, shown in the error log of a guard that throws. The rules: [08, Named guard logging](./08-declarative-manifest-guards.md#named-guard-logging).

Names were added as a base for later features (disable by name, ordering hints, DevTools). None of these exist yet.

## 5. Case sensitivity

All config values are case-sensitive, as UI5 handles `viewType`, `transition` and other manifest enums. `normalizeGuardRouterOptions()` warns per option (`guardRouter.<option> has invalid value, using default`) and uses the default. `logLevel` (1.7.0) has no default: an invalid value is logged as an error and ignored.

## 6. Execution order

The phase order and where manifest guards run are in the library README: [Execution order](../../packages/lib/README.md#execution-order) and [Mixing declarative and programmatic guards](../../packages/lib/README.md#mixing-declarative-and-programmatic-guards).

A bare-path multi-guard module inserts all its guards at the module's position in the manifest array, in their internal order. Each cherry-pick takes its own position:

```json
"admin": ["guards.security#checkAuth", "guards.logging", "guards.security#checkRole"]
```

Runs `checkAuth`, then all of `logging`, then `checkRole`.

Once registered, a cherry-picked or multi-guard guard is an ordinary guard: `skipGuards`, `navToPreflight` and the other features treat it like any other.

## 7. Risks

| Risk                                          | Mitigation                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Object key order                              | Guaranteed since ES2015, which UI5 requires anyway.                                           |
| `#` clashes with a future path syntax         | UI5 module paths use dots and slashes only.                                                   |
| Index cherry-picks depend on order            | Prefer object keys for cherry-picks.                                                          |
| Lazy instead of block by default              | Guards always run before the navigation completes; only the timing differs.                   |
| The preload is not guaranteed                 | It is an optimization. On a miss the wrapper loads the module on the first navigation.        |
| Bare-path modules need their exports at start | Registered individually from the cache, or run from one module wrapper on a miss (section 1). |

## Tests

`packages/lib/test/qunit/router/manifest/MultiGuardModules.qunit.ts` (shapes, block and lazy loading, cached and uncached modules, load failures, empty exports, leave guards from a multi-guard module), `CherryPick.qunit.ts` (by name, by index, from a function module, invalid keys, `"*"`, the `module:` prefix) and `packages/lib/test/qunit/unit/GuardModules.qunit.ts`.

## Out of scope

- Disabling a guard by name in the manifest
- Ordering hints (`before`, `after`)
- DevTools integration for named guards
- Build-time validation of cherry-pick keys
- Class-based guard modules: plain objects cover the same ground without instantiation logic
