# Multi-Guard Modules, Named Guards & Pattern 5 Loading

**Date**: 2026-03-22
**Status**: Implemented
**Branch**: `feat/declarative-manifest-guards`
**Evolves**: `docs/features/08-declarative-manifest-guards.md`

## Summary

Three changes to the declarative manifest guard system:

1. **Pattern 5 loading** — `"lazy"` becomes the default, implemented as preload + lazy wrappers. `initialize()` is always synchronous in this mode.
2. **Multi-guard modules** — a single manifest module can export multiple guards via three shapes: function, array, or plain object.
3. **Named guards** — every guard gets a name for logging, diagnostics, and future extensibility. Cherry-picking individual exports from multi-guard modules via `#` syntax.

## 1. Loading Strategy: Pattern 5 (Preload + Lazy)

### Change

Default `guardLoading` flips from `"block"` to `"lazy"`. The `"lazy"` mode gains a preload optimization.

### How It Works

**Constructor** (after parsing descriptors):

```typescript
// Fire-and-forget preload — no callback, no promise
// Deduplicate module paths (same module may appear in multiple cherry-pick entries)
// Always use base module path without # fragment
const uniquePaths = [...new Set(descriptors.map((d) => d.modulePath))];
sap.ui.require(uniquePaths);
```

**`initialize()`** (lazy mode):

```typescript
// Register lazy wrappers for all descriptors
this._registerLazyGuards(descriptors);
// Always synchronous — no async gap
return super.initialize();
```

**Lazy wrapper — cherry-picked entries** (one wrapper per descriptor, resolves to exactly one guard):

```typescript
function createLazyGuard(modulePath: string, exportKey?: string): GuardFn {
	return (context: GuardContext) => {
		const cached = sap.ui.require(modulePath);
		if (cached) {
			const fn = resolveExport(cached, exportKey);
			return fn(context); // sync — preload won the race
		}
		return new Promise((resolve, reject) => {
			sap.ui.require(
				[modulePath],
				(mod) => {
					const fn = resolveExport(mod, exportKey);
					resolve(fn(context));
				},
				reject,
			);
		});
	};
}
```

**Lazy wrapper — bare-path multi-guard modules** (one "expander" wrapper that, on first invocation, loads the module, detects shape, registers the remaining guards, and executes itself as the first):

A single lazy wrapper cannot expand into N guards at invocation time. Two strategies:

1. **Eager expansion for bare-path entries**: At `initialize()` time, if a descriptor has no `exportKey`, load the module (it may already be cached from preload), detect shape, and expand into individual descriptors before registering. This makes bare-path multi-guard modules behave like mini-block-loads — but only for the shape detection, not for all modules.

2. **Preferred approach**: Cherry-picked entries use lazy wrappers (one guard per wrapper, no expansion needed). Bare-path entries with no `exportKey` are loaded at `initialize()` time to detect their shape and expand. Since the preload fired in the constructor, modules are likely cached — making this expansion effectively synchronous in practice. If not cached, this single module load is awaited before registering its guards.

The implementation uses approach 2: `_registerLazyGuards()` partitions descriptors into cherry-picked (lazy wrapper) and bare-path (expand-on-init). This keeps `initialize()` synchronous in the common case (preload finished) while correctly handling multi-guard expansion.

### Why This Is Better

- `initialize()` is always synchronous in lazy mode — no async gap, no destroy race during init
- The `_destroyed` sentinel check in `initialize()` is only needed for block mode
- Preload fires early (constructor), guard modules are small — by the time the first navigation happens, modules are almost certainly cached
- Worst case (preload not finished): identical to current lazy behavior, module loads on first navigation
- Best case (preload finished): identical to current block behavior, guard is ready immediately
- Mid-navigation destroy is handled by the pipeline's existing generation counter + AbortController in all modes

### Configuration

| Value                  | Behavior                     | `initialize()`                               |
| ---------------------- | ---------------------------- | -------------------------------------------- |
| `"lazy"` (new default) | Preload hint + lazy wrappers | Synchronous                                  |
| `"block"`              | Load all modules, then init  | Asynchronous (deferred `super.initialize()`) |

Both values remain available. Block mode is unchanged — existing destroy-safety logic preserved for consumers who need the hard guarantee.

**Semver note**: The declarative manifest guard feature (`feat/declarative-manifest-guards`) has not shipped to any consumers. This default change is a pre-release decision with no backwards-compatibility impact.

## 2. Multi-Guard Module Export Shapes

### Current Behavior

Each manifest guard module must export a single default function.

### New Behavior

A module picks **one** of three export shapes:

#### Shape 1: Function (unchanged)

Single guard. Name derived from last segment of module path.

```typescript
// guards/auth.ts → guard name: "auth"
export default function (context: GuardContext): GuardResult {
	return checkAuth();
}
```

#### Shape 2: Array of Functions

Ordered guards. Names derived as `"moduleName#0"`, `"moduleName#1"`, etc.

```typescript
// guards/checks.ts → guard names: "checks#0", "checks#1"
export default [
	function (context: GuardContext): GuardResult {
		return checkA();
	},
	function (context: GuardContext): GuardResult {
		return checkB();
	},
];
```

Array order = execution order. Strict, explicit, no ambiguity.

#### Shape 3: Plain Object with Function Values

Named guards. Key = guard name. Key insertion order = execution order (guaranteed in modern JS).

```typescript
// guards/security.ts → guard names: "checkAuth", "checkRole", "checkPermission"
export default {
    checkAuth(context: GuardContext): GuardResult { ... },
    checkRole(context: GuardContext): GuardResult { ... },
    checkPermission(context: GuardContext): GuardResult { ... }
};
```

### Detection Logic

```
typeof export === "function"           → Shape 1 (single guard)
Array.isArray(export)                  → Shape 2 (array)
typeof export === "object" && export   → Shape 3 (object)
anything else                          → Log.warning, skip module
```

Non-function entries within arrays or objects are warned and skipped individually.

Empty arrays (`export default []`) and empty objects (`export default {}`) pass shape detection but produce zero guards. This logs a warning, since an empty export is likely a mistake.

### Type Safety: GuardFn vs LeaveGuardFn

The existing implementation has two guard function types: `GuardFn` (enter guards, returns `GuardResult`) and `LeaveGuardFn` (leave guards, returns `boolean`). When a multi-guard module is used for both enter and leave contexts (e.g., cherry-picking one key for enter and another for leave), the module author is responsible for ensuring function signatures match their usage context. The router performs no runtime type checking beyond `typeof fn === "function"`, consistent with how single-function modules work today.

### Duplicate Module References

When the same module path appears multiple times (with and without cherry-pick), guards are registered for each occurrence independently:

```json
"admin": ["guards.security", "guards.security#checkAuth"]
```

This registers all guards from `security` (including `checkAuth`), then registers `checkAuth` again. Result: `checkAuth` runs twice. This is the consumer's responsibility — no deduplication is performed, consistent with how imperative `addRouteGuard()` allows duplicate registrations.

## 3. Cherry-Pick Syntax

### Manifest Format

```json
{
	"guards": {
		"admin": ["guards.security#checkAuth", "guards.security#checkRole"],
		"dashboard": ["guards.security"],
		"settings": ["guards.checks#1"],
		"*": ["guards.logging"]
	}
}
```

### Rules

| Syntax                        | Behavior                                                                                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"guards.security"`           | Register **all** exports from module (key/array order)                                                                                                                                       |
| `"guards.security#checkAuth"` | Register only the named export (object key)                                                                                                                                                  |
| `"guards.security#1"`         | Register only the indexed export (array index or object key order)                                                                                                                           |
| `"guards.auth#anything"`      | For single-function modules, `#` is ignored — the function is the only export. Logs a debug-level warning since this likely indicates a mistake (wrong module or expected an object export). |

The `#` separator is unambiguous — module paths use dots and slashes, never `#`.

The `module:` prefix and `#` cherry-pick compose naturally. Parsing splits on `#` first, then `resolveGuardModulePath()` handles the `module:` prefix on the base path:
`"module:some.other.lib.guards#checkAuth"` → modulePath: `"some/other/lib/guards"`, exportKey: `"checkAuth"`.

### Parsing

`parseGuardDescriptors()` splits each entry on the first `#`:

```typescript
const [rawModulePath, exportKey] = entry.split("#", 2);
// rawModulePath: "guards.security"
// exportKey: "checkAuth" | "1" | undefined
```

The `exportKey` is stored on the descriptor and used at registration time to select the appropriate export(s) from the loaded module.

### Resolution at Registration Time

When a module is loaded:

1. Determine the export shape (function / array / object)
2. If `exportKey` is defined:
    - For objects: look up `module[exportKey]`
    - For arrays: look up `module[parseInt(exportKey)]`
    - For functions: ignore `exportKey`
    - If the key doesn't exist or the value isn't a function: warn and skip
3. If `exportKey` is undefined: register all exports in order

## 4. Named Guards

### Every Guard Gets a Name

| Export Shape  | Name Derivation                                                     |
| ------------- | ------------------------------------------------------------------- |
| Function      | Last segment of module path: `"guards.auth"` → `"auth"`             |
| Array         | Module name + index: `"guards.checks"` → `"checks#0"`, `"checks#1"` |
| Object        | Object key: `"guards.security"` → `"checkAuth"`, `"checkRole"`      |
| Cherry-picked | Export key: `"guards.security#checkAuth"` → `"checkAuth"`           |

### GuardDescriptor Type Change

```typescript
interface GuardDescriptor {
	readonly route: string;
	readonly type: "enter" | "leave";
	readonly modulePath: string;
	readonly name: string; // NEW — derived or explicit
	readonly exportKey?: string; // NEW — "checkAuth", "1", or undefined (without #)
}
```

### Usage

Names are used for **logging only** in this iteration:

- `"guard 'checkAuth' (guards/security) blocked navigation to 'admin'"`
- Pipeline trace in debug: `"checkAuth → checkRole → [blocked by checkRole]"`

Future extensibility (not implemented now): disable by name, ordering hints, DevTools integration. The naming foundation makes these possible without retrofit.

## 5. Case Sensitivity

No change. All config values are case-sensitive, consistent with how UI5 handles `viewType`, `transition`, and other manifest enum values. Invalid values produce per-option warnings listing valid choices and fall back to defaults. This is how `normalizeGuardRouterOptions()` already works.

## 6. Execution Order

Within a single navigation pipeline:

1. **Leave guards** (current route) — manifest-declared first (in declaration order), then imperative
2. **Global enter guards** (`"*"`) — manifest-declared first, then imperative
3. **Route-specific enter guards** — manifest-declared first, then imperative

For multi-guard modules registered via bare path (no cherry-pick), all guards from the module are inserted at the position where the module appears in the manifest array, in their internal order (array index / object key order).

For cherry-picked guards, each pick occupies its own position in the manifest array, in the order declared:

```json
"admin": ["guards.security#checkAuth", "guards.logging", "guards.security#checkRole"]
```

Execution: `checkAuth` → all of logging → `checkRole`.

## 7. Documentation Deliverables

The PR includes:

- Updated `docs/features/08-declarative-manifest-guards.md` with multi-guard modules, cherry-pick syntax, and Pattern 5 loading
- Guard module authoring guide: function vs array vs object, when to use which
- Migration note: default `guardLoading` changed from `"block"` to `"lazy"`
- Named guard logging examples

## 8. Testing Scope

### New tests needed

- **Multi-guard object module**: module exports object → all guards registered in key order
- **Multi-guard array module**: module exports array → all guards registered in index order
- **Cherry-pick by name**: `"module#key"` → only that export registered
- **Cherry-pick by index**: `"module#0"` → only that export registered
- **Cherry-pick from function module**: `#` ignored, function registered
- **Invalid cherry-pick key**: nonexistent key → warning, skip
- **Non-function entries in object/array**: warned and skipped individually
- **Mixed shapes across routes**: one route uses object module, another uses function module
- **Pattern 5 preload**: lazy mode with preload hint — guard available synchronously on first navigation (requires module to be pre-cached)
- **Pattern 5 fallback**: lazy mode where preload hasn't finished — guard loads async on first navigation
- **Default guardLoading is lazy**: no config → lazy behavior
- **Named guard in log output**: verify guard name appears in warning/error logs
- **Execution order with multi-guard modules**: bare path registers all in order, cherry-picks respect manifest position
- **Cherry-pick with `module:` prefix**: verify `"module:some.lib#key"` parsing order
- **Same module from multiple routes**: module loaded once, guards registered per-route correctly
- **Lazy mode with bare-path multi-guard module**: expand-on-init behavior
- **`"*"` key with cherry-pick**: `"*": ["guards.logging#verbose"]`
- **Leave guard from multi-guard module**: verify type safety is consumer's responsibility
- **Empty array/object export**: warning logged, no guards registered
- **Duplicate module references**: same module with and without cherry-pick, guards registered independently

### Existing tests to update

- Default `guardLoading` value assertions: `"block"` → `"lazy"`
- Guard module format validation messages: update to mention object/array shapes
- GuardDescriptor type usage: add `name` and `exportKey` fields

### Interaction with Existing Features

Cherry-picked and multi-guard module guards behave identically to single-function guards with respect to `skipGuards`, `navToPreflight`, and all other existing features. No special handling is needed — once registered, a guard is a guard regardless of how it was declared.

## 9. Risks and Mitigations

| Risk                                                        | Mitigation                                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Object key order assumed stable                             | Guaranteed by ES2015+ spec. Document requirement for modern runtime (already a UI5 requirement).                                      |
| Cherry-pick `#` conflicts with future path syntax           | `#` never appears in UI5 module paths (dots and slashes only). Safe separator.                                                        |
| Array index cherry-pick is fragile                          | Document that object form is preferred for cherry-picking. Index-based is available but order-dependent.                              |
| Default change from block to lazy                           | No functional difference for guards — they always run before navigation completes. Only timing changes. Document in migration guide.  |
| Preload hint has no guarantee                               | By design — it's an optimization, not a contract. Lazy wrapper handles the miss case identically to current lazy mode.                |
| Bare-path multi-guard + lazy mode needs module load at init | Partitioned: cherry-picked entries use lazy wrappers; bare-path entries expand at init (usually from cache). Documented in Section 1. |

## 10. Out of Scope

- Guard disable-by-name in manifest
- Ordering hints (`before`, `after`)
- DevTools integration for named guards
- Build-time validation of cherry-pick keys
- Class-based guard modules (no instantiation logic needed — plain objects cover the same ground)
