# Multi-Guard Modules, Named Guards & Pattern 5 Loading — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve declarative manifest guards to support multi-guard modules (function/array/object exports), cherry-pick syntax (`#`), named guards for logging, and Pattern 5 (preload + lazy) as the default loading strategy.

**Architecture:** Guard modules can export one of three shapes. `parseGuardDescriptors()` gains cherry-pick parsing and name derivation. A new `resolveModuleExports()` helper detects shape and extracts guard functions. Both `_loadAndRegisterGuards()` (block) and `_registerLazyGuards()` (lazy) are updated to handle multi-guard expansion. The constructor fires a deduped preload hint, and the default `guardLoading` flips to `"lazy"`.

**Tech Stack:** TypeScript, UI5 `sap.ui.require`, QUnit + Sinon (via WdIO headless Chrome)

**Spec:** `docs/features/08b-multi-guard-modules-and-pattern5-loading.md`

**Test runner:** `npm run wdio:qunit` (or `pnpm wdio:qunit`)

---

## File Structure

### Files to Create

| File                                                          | Responsibility                                          |
| ------------------------------------------------------------- | ------------------------------------------------------- |
| `packages/lib/test/qunit/fixtures/guards/objectGuard.ts`      | Test fixture: object export with named guard functions  |
| `packages/lib/test/qunit/fixtures/guards/arrayGuard.ts`       | Test fixture: array export with ordered guard functions |
| `packages/lib/test/qunit/fixtures/guards/emptyObjectGuard.ts` | Test fixture: empty object export (edge case)           |
| `packages/lib/test/qunit/fixtures/guards/emptyArrayGuard.ts`  | Test fixture: empty array export (edge case)            |
| `packages/lib/test/qunit/fixtures/guards/mixedObjectGuard.ts` | Test fixture: object with some non-function values      |

### Files to Modify

| File                                             | Changes                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/lib/src/Router.ts`                     | `GuardDescriptor` type (add `name`, `exportKey`), `parseGuardDescriptors()` (cherry-pick parsing, name derivation), `resolveModuleExports()` (new helper), `_loadAndRegisterGuards()` (multi-guard expansion), `_registerLazyGuards()` (multi-guard expansion + cherry-pick), `initialize()` (preload hint), `DEFAULT_OPTIONS` (guardLoading → "lazy") |
| `packages/lib/test/qunit/RouterOptions.qunit.ts` | New test modules for multi-guard, cherry-pick, Pattern 5, edge cases                                                                                                                                                                                                                                                                                   |

---

## Task 1: Test Fixture Modules

Create the guard modules that tests will import. No test code yet — just the fixtures.

**Files:**

- Create: `packages/lib/test/qunit/fixtures/guards/objectGuard.ts`
- Create: `packages/lib/test/qunit/fixtures/guards/arrayGuard.ts`
- Create: `packages/lib/test/qunit/fixtures/guards/emptyObjectGuard.ts`
- Create: `packages/lib/test/qunit/fixtures/guards/emptyArrayGuard.ts`
- Create: `packages/lib/test/qunit/fixtures/guards/mixedObjectGuard.ts`

- [ ] **Step 1: Create objectGuard.ts**

```typescript
import type { GuardContext, GuardResult } from "ui5/guard/router/types";

export default {
	checkAuth(_context: GuardContext): GuardResult {
		return true;
	},
	checkRole(_context: GuardContext): GuardResult {
		return false;
	},
};
```

- [ ] **Step 2: Create arrayGuard.ts**

```typescript
import type { GuardContext, GuardResult } from "ui5/guard/router/types";

export default [
	function allowFirst(_context: GuardContext): GuardResult {
		return true;
	},
	function blockSecond(_context: GuardContext): GuardResult {
		return false;
	},
];
```

- [ ] **Step 3: Create emptyObjectGuard.ts**

```typescript
export default {};
```

- [ ] **Step 4: Create emptyArrayGuard.ts**

```typescript
export default [];
```

- [ ] **Step 5: Create mixedObjectGuard.ts**

```typescript
import type { GuardContext, GuardResult } from "ui5/guard/router/types";

export default {
	validGuard(_context: GuardContext): GuardResult {
		return true;
	},
	notAFunction: 42,
	alsoNotAFunction: "hello",
};
```

- [ ] **Step 6: Commit**

```bash
git add packages/lib/test/qunit/fixtures/guards/objectGuard.ts \
       packages/lib/test/qunit/fixtures/guards/arrayGuard.ts \
       packages/lib/test/qunit/fixtures/guards/emptyObjectGuard.ts \
       packages/lib/test/qunit/fixtures/guards/emptyArrayGuard.ts \
       packages/lib/test/qunit/fixtures/guards/mixedObjectGuard.ts
git commit -m "test: add multi-guard module fixtures (object, array, empty, mixed)"
```

---

## Task 2: GuardDescriptor Type Enhancement + Cherry-Pick Parsing

Enhance the `GuardDescriptor` type and update `parseGuardDescriptors()` to split on `#` and derive guard names.

**Files:**

- Modify: `packages/lib/src/Router.ts:132-136` (GuardDescriptor)
- Modify: `packages/lib/src/Router.ts:166-261` (parseGuardDescriptors)
- Test: `packages/lib/test/qunit/RouterOptions.qunit.ts`

- [ ] **Step 1: Write failing tests for cherry-pick parsing and name derivation**

Add a new QUnit module at the end of `RouterOptions.qunit.ts`. These tests use block mode with the actual module paths to verify descriptors are parsed correctly. The observable behavior is: cherry-picked guard registers and functions, bare path registers all.

```typescript
// ============================================================
// Module: Cherry-pick syntax
// ============================================================
QUnit.module("Router - Cherry-pick syntax", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("cherry-pick by name from object module registers only that guard", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					// checkAuth returns true, so navigation should succeed
					protected: ["ui5/guard/router/qunit/fixtures/guards/objectGuard#checkAuth"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Committed,
		"cherry-picked checkAuth (returns true) allows navigation",
	);
});

QUnit.test("cherry-pick by name selects blocking guard", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					// checkRole returns false, so navigation should be blocked
					protected: ["ui5/guard/router/qunit/fixtures/guards/objectGuard#checkRole"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"cherry-picked checkRole (returns false) blocks navigation",
	);
});

QUnit.test("cherry-pick by index from array module", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					// index 1 is blockSecond (returns false)
					protected: ["ui5/guard/router/qunit/fixtures/guards/arrayGuard#1"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"cherry-picked index 1 (blockSecond) blocks navigation",
	);
});

QUnit.test("cherry-pick from single-function module ignores # and still works", async function (assert: Assert) {
	// blockGuard exports a single function. Using #nonexistent should log a
	// debug message but still register the function (# ignored for functions).
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					protected: ["ui5/guard/router/qunit/fixtures/guards/blockGuard#nonexistent"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "function module still blocks despite #");
});

QUnit.test("invalid cherry-pick key warns and skips", async function (assert: Assert) {
	const warnings = await captureWarningsAsync(async () => {
		router = new GuardRouterClass(
			[
				{ name: "home", pattern: "" },
				{ name: "protected", pattern: "protected" },
			],
			{
				async: true,
				guardRouter: {
					guardLoading: "block",
					unknownRouteGuardRegistration: "ignore",
					guards: {
						protected: ["ui5/guard/router/qunit/fixtures/guards/objectGuard#doesNotExist"],
					},
				},
			} as object,
		);

		router.initialize();
		await waitForRoute(router, "home", 5000);
	});

	assert.ok(
		warnings.some((w) => w.message.includes("doesNotExist")),
		"warning logged for nonexistent export key",
	);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm wdio:qunit`
Expected: new tests FAIL — cherry-pick `#` is not parsed, `objectGuard` is treated as function export (fails type check).

- [ ] **Step 3: Enhance GuardDescriptor type**

In `Router.ts:132-136`, update:

```typescript
/** Parsed guard declaration from the manifest `guards` block. */
interface GuardDescriptor {
	readonly route: string;
	readonly type: "enter" | "leave";
	readonly modulePath: string;
	readonly name: string;
	readonly exportKey?: string;
}
```

- [ ] **Step 4: Update parseGuardDescriptors to split on `#` and derive names**

In `Router.ts:166-261`, update the entry parsing logic. Every place that creates a descriptor now splits on `#` and derives a name. Extract a helper:

```typescript
/**
 * Split a manifest guard entry on the first `#` to separate the module path
 * from an optional export key, then derive a human-readable guard name.
 */
function parseGuardEntry(
	entry: string,
	componentNamespace: string,
): { modulePath: string; name: string; exportKey?: string } {
	const hashIndex = entry.indexOf("#");
	const rawPath = hashIndex === -1 ? entry : entry.slice(0, hashIndex);
	const exportKey = hashIndex === -1 ? undefined : entry.slice(hashIndex + 1);

	const modulePath = resolveGuardModulePath(rawPath, componentNamespace);

	// Name: export key if present, otherwise last segment of the dot path
	const lastSegment = rawPath.split(".").pop() ?? rawPath;
	const name = exportKey ?? lastSegment;

	return { modulePath, name, exportKey };
}
```

Then update every `descriptors.push(...)` call to use this helper and include `name` and `exportKey`:

```typescript
// Before:
descriptors.push({
	route: key,
	type: "enter",
	modulePath: resolveGuardModulePath(entry, componentNamespace),
});

// After:
const parsed = parseGuardEntry(entry, componentNamespace);
descriptors.push({
	route: key,
	type: "enter",
	modulePath: parsed.modulePath,
	name: parsed.name,
	exportKey: parsed.exportKey,
});
```

Apply this pattern to all 4 push sites (shorthand enter, object enter, object leave, and the same for `"*"`).

- [ ] **Step 5: Run tests to verify cherry-pick parsing works**

At this point, parsing works but module loading still expects a single function. The cherry-pick tests will still fail because `_loadAndRegisterGuards` doesn't handle export keys yet. That's expected — we need Task 3 first.

Run: `pnpm wdio:qunit`
Expected: existing tests PASS (they don't use `#`), new cherry-pick tests still FAIL.

- [ ] **Step 6: Commit**

```bash
git add packages/lib/src/Router.ts packages/lib/test/qunit/RouterOptions.qunit.ts
git commit -m "feat: add GuardDescriptor name/exportKey fields, cherry-pick parsing in parseGuardDescriptors"
```

---

## Task 3: Module Export Resolution Helper

A pure function that takes a loaded module export, an optional export key, and the module path — then returns an array of `{ name, fn }` pairs ready for registration.

**Files:**

- Modify: `packages/lib/src/Router.ts` (add `resolveModuleExports()` near line 146)

- [ ] **Step 1: Implement resolveModuleExports()**

Add after `resolveGuardModulePath()` (~line 152):

```typescript
interface ResolvedGuardExport {
	readonly name: string;
	readonly fn: GuardFn;
}

/**
 * Detect the export shape of a loaded guard module and extract guard functions.
 *
 * Shapes:
 * - function        → single guard
 * - Array           → ordered guards (non-functions warned and skipped)
 * - plain object    → named guards in key order (non-functions warned and skipped)
 *
 * When `exportKey` is set, only the matching export is returned.
 * When `exportKey` is set on a function export, the key is ignored with a debug warning.
 */
function resolveModuleExports(
	moduleExport: unknown,
	modulePath: string,
	descriptorName: string,
	exportKey?: string,
): ResolvedGuardExport[] {
	const moduleName = modulePath.split("/").pop() ?? modulePath;

	// Shape 1: function
	if (typeof moduleExport === "function") {
		if (exportKey !== undefined) {
			Log.debug(
				`guardRouter.guards: "${modulePath}#${exportKey}" exports a single function, ignoring export key`,
				undefined,
				LOG_COMPONENT,
			);
		}
		return [{ name: descriptorName, fn: moduleExport as GuardFn }];
	}

	// Shape 2: array
	if (Array.isArray(moduleExport)) {
		if (moduleExport.length === 0) {
			Log.warning(
				`guardRouter.guards: module "${modulePath}" exported an empty array, skipping`,
				undefined,
				LOG_COMPONENT,
			);
			return [];
		}

		if (exportKey !== undefined) {
			const index = parseInt(exportKey, 10);
			if (Number.isNaN(index) || index < 0 || index >= moduleExport.length) {
				Log.warning(
					`guardRouter.guards: "${modulePath}#${exportKey}" — index out of range or invalid, skipping`,
					undefined,
					LOG_COMPONENT,
				);
				return [];
			}
			const entry = moduleExport[index];
			if (typeof entry !== "function") {
				Log.warning(
					`guardRouter.guards: "${modulePath}#${exportKey}" is not a function, skipping`,
					undefined,
					LOG_COMPONENT,
				);
				return [];
			}
			return [{ name: `${moduleName}#${exportKey}`, fn: entry as GuardFn }];
		}

		const results: ResolvedGuardExport[] = [];
		for (let i = 0; i < moduleExport.length; i++) {
			if (typeof moduleExport[i] !== "function") {
				Log.warning(
					`guardRouter.guards: "${modulePath}"[${i}] is not a function, skipping`,
					undefined,
					LOG_COMPONENT,
				);
				continue;
			}
			results.push({ name: `${moduleName}#${i}`, fn: moduleExport[i] as GuardFn });
		}
		return results;
	}

	// Shape 3: plain object (use isRecord to exclude non-plain objects like Map, Date, etc.)
	if (isRecord(moduleExport)) {
		const entries = Object.entries(moduleExport as Record<string, unknown>);
		if (entries.length === 0) {
			Log.warning(
				`guardRouter.guards: module "${modulePath}" exported an empty object, skipping`,
				undefined,
				LOG_COMPONENT,
			);
			return [];
		}

		if (exportKey !== undefined) {
			// Try direct key lookup first, then fall back to positional index
			let value = (moduleExport as Record<string, unknown>)[exportKey];
			let resolvedName = exportKey;
			if (value === undefined) {
				const index = parseInt(exportKey, 10);
				if (!Number.isNaN(index) && index >= 0 && index < entries.length) {
					const [key, val] = entries[index];
					value = val;
					resolvedName = key;
				}
			}
			if (value === undefined) {
				Log.warning(
					`guardRouter.guards: "${modulePath}#${exportKey}" — key not found, skipping`,
					undefined,
					LOG_COMPONENT,
				);
				return [];
			}
			if (typeof value !== "function") {
				Log.warning(
					`guardRouter.guards: "${modulePath}#${exportKey}" is not a function, skipping`,
					undefined,
					LOG_COMPONENT,
				);
				return [];
			}
			return [{ name: resolvedName, fn: value as GuardFn }];
		}

		const results: ResolvedGuardExport[] = [];
		for (const [key, value] of entries) {
			if (typeof value !== "function") {
				Log.warning(
					`guardRouter.guards: "${modulePath}".${key} is not a function, skipping`,
					undefined,
					LOG_COMPONENT,
				);
				continue;
			}
			results.push({ name: key, fn: value as GuardFn });
		}
		return results;
	}

	// Unknown shape
	Log.warning(
		`guardRouter.guards: module "${modulePath}" did not export a function, array, or plain object, skipping`,
		undefined,
		LOG_COMPONENT,
	);
	return [];
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/lib/src/Router.ts
git commit -m "feat: add resolveModuleExports helper for multi-guard shape detection"
```

---

## Task 4: Multi-Guard Registration in Block Mode

Update `_loadAndRegisterGuards()` to use `resolveModuleExports()` for multi-guard expansion.

**Files:**

- Modify: `packages/lib/src/Router.ts:1404-1447` (\_loadAndRegisterGuards)
- Test: `packages/lib/test/qunit/RouterOptions.qunit.ts`

- [ ] **Step 1: Write failing tests for multi-guard block loading**

Add a new QUnit module:

```typescript
// ============================================================
// Module: Multi-guard module exports (block loading)
// ============================================================
QUnit.module("Router - Multi-guard module exports (block loading)", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("object module: bare path registers all guards in key order", async function (assert: Assert) {
	// objectGuard has checkAuth (true) and checkRole (false)
	// Bare path registers both → checkRole blocks
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					protected: ["ui5/guard/router/qunit/fixtures/guards/objectGuard"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"second guard (checkRole=false) blocks when all object guards registered",
	);
});

QUnit.test("array module: bare path registers all guards in index order", async function (assert: Assert) {
	// arrayGuard has [allowFirst (true), blockSecond (false)]
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					protected: ["ui5/guard/router/qunit/fixtures/guards/arrayGuard"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"second guard (blockSecond=false) blocks when all array guards registered",
	);
});

QUnit.test("empty object module warns and registers no guards", async function (assert: Assert) {
	const warnings = await captureWarningsAsync(async () => {
		router = new GuardRouterClass(
			[
				{ name: "home", pattern: "" },
				{ name: "protected", pattern: "protected" },
			],
			{
				async: true,
				guardRouter: {
					guardLoading: "block",
					unknownRouteGuardRegistration: "ignore",
					guards: {
						protected: ["ui5/guard/router/qunit/fixtures/guards/emptyObjectGuard"],
					},
				},
			} as object,
		);

		router.initialize();
		await waitForRoute(router, "home", 5000);
	});

	assert.ok(
		warnings.some((w) => w.message.includes("empty object")),
		"warning about empty object export",
	);

	// No guards registered → navigation succeeds
	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "no guards → navigation allowed");
});

QUnit.test("mixed object module: non-function values warned and skipped", async function (assert: Assert) {
	const warnings = await captureWarningsAsync(async () => {
		router = new GuardRouterClass(
			[
				{ name: "home", pattern: "" },
				{ name: "protected", pattern: "protected" },
			],
			{
				async: true,
				guardRouter: {
					guardLoading: "block",
					unknownRouteGuardRegistration: "ignore",
					guards: {
						protected: ["ui5/guard/router/qunit/fixtures/guards/mixedObjectGuard"],
					},
				},
			} as object,
		);

		router.initialize();
		await waitForRoute(router, "home", 5000);
	});

	assert.ok(
		warnings.some((w) => w.message.includes("notAFunction")),
		"warning for non-function entry",
	);

	// validGuard returns true → navigation allowed (non-functions skipped)
	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "valid guard allows, invalid entries skipped");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm wdio:qunit`
Expected: new multi-guard tests FAIL — `_loadAndRegisterGuards` still expects single function.

- [ ] **Step 3: Update \_loadAndRegisterGuards to use resolveModuleExports**

Replace the body of `_loadAndRegisterGuards()` at `Router.ts:1404-1447`:

```typescript
private _loadAndRegisterGuards(descriptors: GuardDescriptor[]): Promise<void> {
	const promises = descriptors.map((descriptor) => {
		return new Promise<{ descriptor: GuardDescriptor; moduleExport: unknown }>((resolve) => {
			sap.ui.require(
				[descriptor.modulePath],
				(moduleExport: unknown) => {
					resolve({ descriptor, moduleExport });
				},
				(err: Error) => {
					Log.warning(
						`guardRouter.guards: failed to load module "${descriptor.modulePath}", skipping`,
						String(err),
						LOG_COMPONENT,
					);
					resolve({ descriptor, moduleExport: null });
				},
			);
		});
	});
	return Promise.all(promises).then((results) => {
		for (const { descriptor, moduleExport } of results) {
			if (moduleExport === null) continue;
			const exports = resolveModuleExports(
				moduleExport,
				descriptor.modulePath,
				descriptor.name,
				descriptor.exportKey,
			);
			for (const { fn } of exports) {
				try {
					this._registerGuardFromDescriptor(descriptor, fn);
				} catch (err: unknown) {
					Log.error(
						`guardRouter.guards: failed to register "${descriptor.modulePath}"`,
						String(err),
						LOG_COMPONENT,
					);
				}
			}
		}
	});
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm wdio:qunit`
Expected: ALL tests pass — existing single-function tests + new multi-guard + cherry-pick tests.

- [ ] **Step 5: Commit**

```bash
git add packages/lib/src/Router.ts packages/lib/test/qunit/RouterOptions.qunit.ts
git commit -m "feat: multi-guard module expansion in block mode via resolveModuleExports"
```

---

## Task 5: Pattern 5 — Preload Hint + Default Change to Lazy

Add the preload in the constructor and flip the default.

**Files:**

- Modify: `packages/lib/src/Router.ts:269-273` (DEFAULT_OPTIONS)
- Modify: `packages/lib/src/Router.ts:363-380` (constructor)
- Test: `packages/lib/test/qunit/RouterOptions.qunit.ts`

- [ ] **Step 1: Write failing test for new default and preload**

```typescript
// ============================================================
// Module: Pattern 5 loading (preload + lazy default)
// ============================================================
QUnit.module("Router - Pattern 5 loading", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("default guardLoading is lazy", function (assert: Assert) {
	router = new GuardRouterClass([{ name: "home", pattern: "" }], {
		async: true,
		guardRouter: {
			unknownRouteGuardRegistration: "ignore",
			guards: {
				home: ["ui5/guard/router/qunit/fixtures/guards/allowGuard"],
			},
		},
	} as object);

	// In lazy mode, initialize() is synchronous and returns immediately
	const result = router.initialize();
	assert.strictEqual(result, router, "initialize() returns synchronously in default lazy mode");
});

QUnit.test("lazy mode guard works on first navigation (preload or async fallback)", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "lazy",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					protected: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "lazy guard blocks on first navigation");
});
```

- [ ] **Step 2: Run tests to verify the default test fails**

Run: `pnpm wdio:qunit`
Expected: "default guardLoading is lazy" FAILS because current default is `"block"`. Lazy navigation test may already pass since lazy mode exists.

- [ ] **Step 3: Flip the default**

In `Router.ts:269-273`:

```typescript
const DEFAULT_OPTIONS: ResolvedGuardRouterOptions = {
	unknownRouteGuardRegistration: "warn",
	navToPreflight: "guard",
	guardLoading: "lazy",
};
```

- [ ] **Step 4: Add preload hint in constructor**

In `Router.ts:363-380`, after `parseGuardDescriptors()`:

```typescript
if (isRecord(guardRouter) && guardRouter.guards !== undefined) {
	let componentNamespace = "";
	if (owner) {
		const appConfig = owner.getManifestEntry("sap.app") as Record<string, unknown> | undefined;
		if (isRecord(appConfig) && typeof appConfig.id === "string") {
			componentNamespace = appConfig.id;
		}
	}
	this._pendingGuardDescriptors = parseGuardDescriptors(guardRouter.guards, componentNamespace);

	// Pattern 5: fire-and-forget preload hint (lazy mode only — block mode
	// loads modules itself in initialize(), making a preload redundant)
	if (this._pendingGuardDescriptors.length > 0 && this._options.guardLoading === "lazy") {
		const uniquePaths = [...new Set(this._pendingGuardDescriptors.map((d) => d.modulePath))];
		sap.ui.require(uniquePaths);
	}
}
```

- [ ] **Step 5: Update existing tests that hardcode guardLoading: "block"**

Existing block-mode tests already specify `guardLoading: "block"` explicitly, so they're unaffected by the default change. But the constructor test at ~line 55 that checks defaults needs updating if it asserts the default value. Check and update any assertion that expects `"block"` as default.

- [ ] **Step 6: Run all tests**

Run: `pnpm wdio:qunit`
Expected: ALL tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/lib/src/Router.ts packages/lib/test/qunit/RouterOptions.qunit.ts
git commit -m "feat: Pattern 5 — preload hint in constructor, default guardLoading flipped to lazy"
```

---

## Task 6: Multi-Guard Expansion in Lazy Mode

Update `_registerLazyGuards()` to handle multi-guard modules. Cherry-picked entries get one lazy wrapper each. Bare-path entries try sync cache probe for shape detection; if not cached, load async to expand.

**Files:**

- Modify: `packages/lib/src/Router.ts:1467-1504` (\_registerLazyGuards)
- Test: `packages/lib/test/qunit/RouterOptions.qunit.ts`

- [ ] **Step 1: Write failing tests for lazy multi-guard**

```typescript
// ============================================================
// Module: Multi-guard module exports (lazy loading)
// ============================================================
QUnit.module("Router - Multi-guard module exports (lazy loading)", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("lazy mode: object module bare path registers all guards", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "lazy",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					protected: ["ui5/guard/router/qunit/fixtures/guards/objectGuard"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"lazy object module: checkRole (false) blocks after expansion",
	);
});

QUnit.test("lazy mode: cherry-pick from object module", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "lazy",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					// cherry-pick only checkAuth (returns true)
					protected: ["ui5/guard/router/qunit/fixtures/guards/objectGuard#checkAuth"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Committed,
		"lazy cherry-pick: only checkAuth registered, navigation allowed",
	);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm wdio:qunit`
Expected: lazy multi-guard tests FAIL — `_registerLazyGuards` still treats each descriptor as single-function.

- [ ] **Step 3: Rewrite \_registerLazyGuards for multi-guard support**

The key design: split descriptors into two groups:

1. **Cherry-picked** (`exportKey` defined) → one lazy wrapper per descriptor
2. **Bare-path** (`exportKey` undefined) → probe cache; if cached, expand immediately; if not, async load then expand

```typescript
private _registerLazyGuards(descriptors: GuardDescriptor[]): void {
	for (const descriptor of descriptors) {
		const { modulePath, exportKey, name } = descriptor;

		if (exportKey !== undefined) {
			// Cherry-picked: one lazy wrapper, resolves to exactly one guard
			const lazyGuard = (context: GuardContext): GuardResult | PromiseLike<GuardResult> => {
				const cached = sap.ui.require(modulePath);
				if (cached) {
					const exports = resolveModuleExports(cached, modulePath, name, exportKey);
					if (exports.length === 0) return true; // warned and skipped
					return exports[0].fn(context);
				}
				return new Promise<GuardResult>((resolve, reject) => {
					sap.ui.require(
						[modulePath],
						(mod: unknown) => {
							const exports = resolveModuleExports(mod, modulePath, name, exportKey);
							if (exports.length === 0) {
								resolve(true);
								return;
							}
							resolve(exports[0].fn(context));
						},
						reject,
					);
				});
			};
			this._registerGuardFromDescriptor(descriptor, lazyGuard);
			continue;
		}

		// Bare-path: try sync expansion from cache (preload likely finished)
		const cached = sap.ui.require(modulePath);
		if (cached) {
			const exports = resolveModuleExports(cached, modulePath, name);
			for (const exp of exports) {
				this._registerGuardFromDescriptor(descriptor, exp.fn);
			}
			continue;
		}

		// Cache miss: register a placeholder that loads, expands, and executes guard[0].
		// Remaining guards are registered on first call only (guarded by `expanded` flag).
		let expanded = false;
		const lazyExpander = (context: GuardContext): GuardResult | PromiseLike<GuardResult> => {
			return new Promise<GuardResult>((resolve, reject) => {
				sap.ui.require(
					[modulePath],
					(mod: unknown) => {
						const exports = resolveModuleExports(mod, modulePath, name);
						if (exports.length === 0) {
							resolve(true);
							return;
						}
						// Register remaining guards only on first invocation
						if (!expanded) {
							expanded = true;
							for (let i = 1; i < exports.length; i++) {
								this._registerGuardFromDescriptor(descriptor, exports[i].fn);
							}
						}
						// Execute the first guard
						resolve(exports[0].fn(context));
					},
					reject,
				);
			});
		};
		this._registerGuardFromDescriptor(descriptor, lazyExpander);
	}
}
```

**Note for the implementer:** After the first navigation, the expander wrapper stays at position 0 but now hits the cache (sync path via `resolveModuleExports`). The `expanded` flag ensures guards 1..N are only registered once, preventing accumulation on repeated navigations.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm wdio:qunit`
Expected: ALL tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/lib/src/Router.ts packages/lib/test/qunit/RouterOptions.qunit.ts
git commit -m "feat: multi-guard expansion in lazy mode with cache-first bare-path handling"
```

---

## Task 7: Named Guard Logging

Update log messages to include guard names where available.

**Files:**

- Modify: `packages/lib/src/Router.ts` (log messages in `_loadAndRegisterGuards`, `_registerLazyGuards`, `resolveModuleExports`)
- Test: `packages/lib/test/qunit/RouterOptions.qunit.ts`

- [ ] **Step 1: Write test verifying guard name appears in warning**

```typescript
// ============================================================
// Module: Named guard logging
// ============================================================
QUnit.module("Router - Named guard logging", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("warning for non-function object entry includes property name", async function (assert: Assert) {
	const warnings = await captureWarningsAsync(async () => {
		router = new GuardRouterClass(
			[
				{ name: "home", pattern: "" },
				{ name: "protected", pattern: "protected" },
			],
			{
				async: true,
				guardRouter: {
					guardLoading: "block",
					unknownRouteGuardRegistration: "ignore",
					guards: {
						protected: ["ui5/guard/router/qunit/fixtures/guards/mixedObjectGuard"],
					},
				},
			} as object,
		);

		router.initialize();
		await waitForRoute(router, "home", 5000);
	});

	assert.ok(
		warnings.some((w) => w.message.includes("notAFunction")),
		"warning includes the property name 'notAFunction'",
	);
	assert.ok(
		warnings.some((w) => w.message.includes("alsoNotAFunction")),
		"warning includes the property name 'alsoNotAFunction'",
	);
});
```

- [ ] **Step 2: Run test — should already pass**

The `resolveModuleExports()` from Task 3 already includes property names in warnings. Run to verify.

Run: `pnpm wdio:qunit`
Expected: PASS (logging was built into `resolveModuleExports` from the start).

- [ ] **Step 3: Commit**

```bash
git add packages/lib/test/qunit/RouterOptions.qunit.ts
git commit -m "test: verify named guard logging includes property names"
```

---

## Task 8: Edge Case Tests

Cover the remaining spec edge cases.

**Files:**

- Test: `packages/lib/test/qunit/RouterOptions.qunit.ts`

- [ ] **Step 1: Write edge case tests**

```typescript
// ============================================================
// Module: Multi-guard edge cases
// ============================================================
QUnit.module("Router - Multi-guard edge cases", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("empty array module warns and registers no guards", async function (assert: Assert) {
	const warnings = await captureWarningsAsync(async () => {
		router = new GuardRouterClass(
			[
				{ name: "home", pattern: "" },
				{ name: "protected", pattern: "protected" },
			],
			{
				async: true,
				guardRouter: {
					guardLoading: "block",
					unknownRouteGuardRegistration: "ignore",
					guards: {
						protected: ["ui5/guard/router/qunit/fixtures/guards/emptyArrayGuard"],
					},
				},
			} as object,
		);

		router.initialize();
		await waitForRoute(router, "home", 5000);
	});

	assert.ok(
		warnings.some((w) => w.message.includes("empty array")),
		"warning about empty array export",
	);
});

QUnit.test("global '*' with cherry-pick works", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "other", pattern: "other" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					"*": ["ui5/guard/router/qunit/fixtures/guards/objectGuard#checkRole"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("other");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"global cherry-picked guard (checkRole=false) blocks all routes",
	);
});

QUnit.test("module: prefix with cherry-pick composes correctly", async function (assert: Assert) {
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
		],
		{
			async: true,
			guardRouter: {
				guardLoading: "block",
				unknownRouteGuardRegistration: "ignore",
				guards: {
					protected: ["module:ui5.guard.router.qunit.fixtures.guards.objectGuard#checkAuth"],
				},
			},
		} as object,
	);

	router.initialize();
	await waitForRoute(router, "home", 5000);

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Committed, "module: prefix + #checkAuth works together");
});
```

- [ ] **Step 2: Run all tests**

Run: `pnpm wdio:qunit`
Expected: ALL pass.

- [ ] **Step 3: Commit**

```bash
git add packages/lib/test/qunit/RouterOptions.qunit.ts
git commit -m "test: add edge case tests for empty exports, global cherry-pick, module: prefix"
```

---

## Task 9: Update Existing Feature Documentation

Update the main feature doc to reflect all changes.

**Files:**

- Modify: `docs/features/08-declarative-manifest-guards.md`

- [ ] **Step 1: Update the Guard Module Format section**

Replace the single-function-only documentation with the three export shapes (function, array, object), cherry-pick syntax, and named guards. Update the `guardLoading` default from `"block"` to `"lazy"`. Add Pattern 5 explanation to the Guard Loading Strategies section. Reference the spec doc `08b-multi-guard-modules-and-pattern5-loading.md` for full design rationale.

Key sections to update:

- Manifest Schema → `guardLoading` default value in table (line 53)
- Guards Block → mention cherry-pick syntax with `#`
- Guard Module Format → add array and object shape examples
- Guard Loading Strategies → add Pattern 5 description under `"lazy"`
- Testing Scope → add new test categories

- [ ] **Step 2: Commit**

```bash
git add docs/features/08-declarative-manifest-guards.md
git commit -m "docs: update feature doc with multi-guard modules, cherry-pick, Pattern 5 defaults"
```

---

## Summary of Commits (expected 9)

1. `test: add multi-guard module fixtures`
2. `feat: add GuardDescriptor name/exportKey fields, cherry-pick parsing`
3. `feat: add resolveModuleExports helper for multi-guard shape detection`
4. `feat: multi-guard module expansion in block mode`
5. `feat: Pattern 5 — preload hint, default guardLoading flipped to lazy`
6. `feat: multi-guard expansion in lazy mode`
7. `test: verify named guard logging includes property names`
8. `test: add edge case tests`
9. `docs: update feature doc`
