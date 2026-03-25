# Lazy Metadata Resolution + Option Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge `guardInheritance`/`metaInheritance` into a single `inheritance` option, unify `unknownRouteGuardRegistration` into `unknownRouteRegistration`, and implement lazy metadata resolution so runtime `setRouteMeta` participates in inheritance.

**Architecture:** Replace eager metadata expansion (`_expandManifestMeta`) with a lazy ancestor walk in `getRouteMeta()`, backed by a resolved-metadata cache that invalidates on `setRouteMeta()`. Guard expansion stays eager in `initialize()`. Two option pairs are collapsed into single options. The `_manifestMeta` map becomes a flat store of declared values only — inheritance is resolved at read time.

**Tech Stack:** TypeScript, UI5 `sap.m.routing.Router`, QUnit

**Closes:** #62

---

## File Structure

| File                                                 | Action | Responsibility                                                                                                                                                                                                    |
| ---------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/lib/src/types.ts`                          | Modify | Replace `GuardInheritance` + `MetaInheritance` with `Inheritance`, rename `UnknownRouteGuardRegistrationPolicy` to `UnknownRouteRegistrationPolicy`, update `GuardRouterOptions`                                  |
| `packages/lib/src/Router.ts`                         | Modify | Merge option validators/defaults, remove `_expandManifestMeta`, rewrite `getRouteMeta` with lazy walk + cache, add validation to `setRouteMeta`, add cache invalidation, update `_handleUnknownRouteRegistration` |
| `packages/lib/test/qunit/RouterOptions.qunit.ts`     | Modify | Rename all option references, flip runtime-meta-inheritance test, add lazy resolution + cache invalidation tests                                                                                                  |
| `packages/lib/README.md`                             | Modify | Update options table, inheritance docs, manifest examples                                                                                                                                                         |
| `docs/features/12-lazy-resolution-error-handling.md` | Modify | Update to reflect unified `unknownRouteRegistration` and single `inheritance` option                                                                                                                              |

---

### Task 1: Merge `guardInheritance` + `metaInheritance` → `inheritance` in types

**Files:**

- Modify: `packages/lib/src/types.ts`

- [ ] **Step 1: Replace the two type aliases with one**

Replace `GuardInheritance` (line 158-167) and `MetaInheritance` (line 169-178) with:

```typescript
/**
 * Strategy for inheriting guards and metadata down the URL pattern tree.
 *
 * - `"none"` -- guards and metadata apply only to their declared route (default).
 * - `"pattern-tree"` -- guards propagate to all routes whose URL pattern extends
 *   the declared route's pattern; metadata propagates via shallow merge (child
 *   values override ancestor values on conflict).
 *
 * @since 1.6.0
 */
export type Inheritance = "none" | "pattern-tree";
```

- [ ] **Step 2: Update `GuardRouterOptions`**

Replace the two fields `guardInheritance?` (line 226-227) and `metaInheritance?` (line 228-229) with:

```typescript
/** Strategy for inheriting guards and metadata down the URL pattern tree. Defaults to `"none"`. @since 1.6.0 */
inheritance?: Inheritance;
```

Update the interface JSDoc defaults line (line 207) to replace `guardInheritance: "none"`, `metaInheritance: "none"` with `inheritance: "none"`.

- [ ] **Step 3: Type-check**

Run: `cd packages/lib && npx tsc --noEmit`
Expected: Errors in Router.ts about `GuardInheritance`, `MetaInheritance`, `guardInheritance`, `metaInheritance` not existing. This is expected — we fix them in Task 2.

---

### Task 2: Merge inheritance options in Router.ts

**Files:**

- Modify: `packages/lib/src/Router.ts`

- [ ] **Step 1: Update imports**

Replace `GuardInheritance, MetaInheritance` in the import from `types` with `Inheritance`.

- [ ] **Step 2: Replace the two validator functions with one**

Replace `isGuardInheritance` (line 81-83) and `isMetaInheritance` (line 85-87) with:

```typescript
function isInheritance(v: unknown): v is Inheritance {
	return v === "none" || v === "pattern-tree";
}
```

- [ ] **Step 3: Update `ResolvedGuardRouterOptions`**

Replace `guardInheritance: GuardInheritance` and `metaInheritance: MetaInheritance` (lines 393-394) with:

```typescript
readonly inheritance: Inheritance;
```

- [ ] **Step 4: Update `DEFAULT_OPTIONS`**

Replace `guardInheritance: "none"` and `metaInheritance: "none"` (lines 401-402) with:

```typescript
inheritance: "none",
```

- [ ] **Step 5: Update `normalizeGuardRouterOptions`**

Replace the two `applyOption` calls (lines 432-433) with:

```typescript
applyOption(raw, "inheritance", isInheritance, result);
```

- [ ] **Step 6: Update constructor metadata expansion call**

Change line 539:

```typescript
// Before:
if (this._options.metaInheritance === "pattern-tree" && this._manifestMeta.size > 0) {
// After:
if (this._options.inheritance === "pattern-tree" && this._manifestMeta.size > 0) {
```

- [ ] **Step 7: Update `initialize()` guard expansion call**

Change line 581:

```typescript
// Before:
this._options.guardInheritance === "pattern-tree" ? this._expandGuardDescriptors(descriptors) : descriptors;
// After:
this._options.inheritance === "pattern-tree" ? this._expandGuardDescriptors(descriptors) : descriptors;
```

- [ ] **Step 8: Type-check**

Run: `cd packages/lib && npx tsc --noEmit`
Expected: Errors in test files about old option names. No errors in src/.

---

### Task 3: Update all tests for merged inheritance option

**Files:**

- Modify: `packages/lib/test/qunit/RouterOptions.qunit.ts`

- [ ] **Step 1: Replace all `guardInheritance` and `metaInheritance` with `inheritance`**

Use find-and-replace across the file:

- `guardInheritance: "pattern-tree"` → `inheritance: "pattern-tree"`
- `guardInheritance: "none"` → `inheritance: "none"`
- `metaInheritance: "pattern-tree"` → `inheritance: "pattern-tree"`
- `metaInheritance: "none"` → `inheritance: "none"`
- `metaInheritance: "invalid"` → `inheritance: "invalid"`

Note: Some tests set both options. After replacement, they'll have `inheritance: "pattern-tree"` twice in the same object literal — keep only one.

- [ ] **Step 2: Remove the "independent toggles" test**

Delete the test `"guardInheritance and metaInheritance work independently"` (line 2128-2153) entirely. With a single option, this test is not applicable.

- [ ] **Step 3: Update the invalid options test**

The test `"invalid guardInheritance and metaInheritance values warn and fall back to defaults"` should become `"invalid inheritance value warns and falls back to default"`. It should pass one invalid `inheritance` value and expect one warning (not two).

- [ ] **Step 4: Run tests**

Run: `cd packages/lib && npm run test:qunit`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```
refactor(router): merge guardInheritance and metaInheritance into single inheritance option
```

---

### Task 4: Rename `unknownRouteGuardRegistration` → `unknownRouteRegistration`

**Files:**

- Modify: `packages/lib/src/types.ts`
- Modify: `packages/lib/src/Router.ts`

- [ ] **Step 1: Rename the type alias in types.ts**

Replace `UnknownRouteGuardRegistrationPolicy` (line 135) with `UnknownRouteRegistrationPolicy`. Update the JSDoc to say "Policy for registration against unknown route names" (remove "guard").

- [ ] **Step 2: Rename the field in `GuardRouterOptions`**

Replace `unknownRouteGuardRegistration?: UnknownRouteGuardRegistrationPolicy` with `unknownRouteRegistration?: UnknownRouteRegistrationPolicy`. Update JSDoc.

- [ ] **Step 3: Update Router.ts imports**

Replace `UnknownRouteGuardRegistrationPolicy` with `UnknownRouteRegistrationPolicy`.

- [ ] **Step 4: Rename the validator function**

Replace `isUnknownRouteGuardRegistrationPolicy` with `isUnknownRouteRegistrationPolicy`.

- [ ] **Step 5: Update `ResolvedGuardRouterOptions`**

Replace `unknownRouteGuardRegistration` with `unknownRouteRegistration`.

- [ ] **Step 6: Update `DEFAULT_OPTIONS`**

Replace `unknownRouteGuardRegistration: "warn"` with `unknownRouteRegistration: "warn"`.

- [ ] **Step 7: Update `normalizeGuardRouterOptions`**

Replace the `applyOption` call for `unknownRouteGuardRegistration` with `unknownRouteRegistration`.

- [ ] **Step 8: Update `_handleUnknownRouteRegistration`**

Replace `this._options.unknownRouteGuardRegistration` with `this._options.unknownRouteRegistration`. Update the error message (line 640-642) to say `unknownRouteRegistration` instead of `unknownRouteGuardRegistration`.

- [ ] **Step 9: Update all test references**

In `RouterOptions.qunit.ts`, replace all `unknownRouteGuardRegistration` with `unknownRouteRegistration`.
In `Router.qunit.ts`, do the same.

- [ ] **Step 10: Type-check and run tests**

Run: `cd packages/lib && npx tsc --noEmit && npm run test:qunit`
Expected: zero errors, ALL PASS

- [ ] **Step 11: Commit**

```
refactor(router): rename unknownRouteGuardRegistration to unknownRouteRegistration
```

---

### Task 5: Implement lazy metadata resolution with cache

**Files:**

- Modify: `packages/lib/src/Router.ts`

- [ ] **Step 1: Add the resolved-metadata cache field**

After `private _runtimeMeta` (line 497), add:

```typescript
private _resolvedMetaCache = new Map<string, Readonly<Record<string, unknown>>>();
```

- [ ] **Step 2: Remove `_expandManifestMeta()` and its call**

Remove the call in the constructor (line 539-541):

```typescript
if (this._options.inheritance === "pattern-tree" && this._manifestMeta.size > 0) {
	this._expandManifestMeta();
}
```

Remove the entire `_expandManifestMeta()` method (lines 1670-1704).

- [ ] **Step 3: Rewrite `getRouteMeta()` with lazy resolution**

Replace the current implementation (lines 796-803) with:

```typescript
getRouteMeta(routeName: string): Readonly<Record<string, unknown>> {
    // Empty string is a valid root route name (initial state before first navigation)
    if (routeName !== "" && !this.getRoute(routeName)) {
        Log.warning("getRouteMeta: unknown route, returning empty metadata", routeName, LOG_COMPONENT);
        return Router._EMPTY_META;
    }

    // Cache hit
    const cached = this._resolvedMetaCache.get(routeName);
    if (cached) return cached;

    let result: Readonly<Record<string, unknown>>;

    if (this._options.inheritance === "pattern-tree") {
        result = this._resolveInheritedMeta(routeName);
    } else {
        result = this._resolveFlatMeta(routeName);
    }

    if (Object.keys(result).length === 0) return Router._EMPTY_META;

    this._resolvedMetaCache.set(routeName, result);
    return result;
}
```

- [ ] **Step 4: Add `_resolveFlatMeta` helper**

```typescript
private _resolveFlatMeta(routeName: string): Readonly<Record<string, unknown>> {
    const manifest = this._manifestMeta.get(routeName);
    const runtime = this._runtimeMeta.get(routeName);
    if (!manifest && !runtime) return Router._EMPTY_META;
    if (!runtime) return manifest!;
    if (!manifest) return Object.freeze({ ...runtime });
    return Object.freeze({ ...manifest, ...runtime });
}
```

- [ ] **Step 5: Add `_resolveInheritedMeta` helper**

```typescript
private _resolveInheritedMeta(routeName: string): Readonly<Record<string, unknown>> {
    const allRoutes = this._collectRoutePatterns();
    const routeEntry = allRoutes.find((r) => r.name === routeName);
    if (!routeEntry) return this._resolveFlatMeta(routeName);

    // Find ancestors that have declared metadata (manifest or runtime)
    const ancestors = allRoutes
        .filter(
            (r) =>
                r.name !== routeName &&
                (this._manifestMeta.has(r.name) || this._runtimeMeta.has(r.name)) &&
                isPatternAncestor(r.pattern, routeEntry.pattern),
        )
        .sort((a, b) => a.pattern.split("/").length - b.pattern.split("/").length);

    // Merge shallowest-first: root ancestor → deeper ancestors → own manifest → own runtime
    const merged: Record<string, unknown> = {};

    for (const ancestor of ancestors) {
        const ancestorManifest = this._manifestMeta.get(ancestor.name);
        if (ancestorManifest) Object.assign(merged, ancestorManifest);
        const ancestorRuntime = this._runtimeMeta.get(ancestor.name);
        if (ancestorRuntime) Object.assign(merged, ancestorRuntime);
    }

    const ownManifest = this._manifestMeta.get(routeName);
    if (ownManifest) Object.assign(merged, ownManifest);
    const ownRuntime = this._runtimeMeta.get(routeName);
    if (ownRuntime) Object.assign(merged, ownRuntime);

    if (Object.keys(merged).length === 0) return Router._EMPTY_META;
    return Object.freeze(merged);
}
```

- [ ] **Step 6: Add cache invalidation to `setRouteMeta`**

Replace the current implementation (lines 816-819) with:

```typescript
setRouteMeta(routeName: string, meta: Record<string, unknown>): this {
    if (!isRecord(meta)) {
        Log.warning("setRouteMeta: expected object, ignoring", routeName, LOG_COMPONENT);
        return this;
    }
    if (routeName !== "" && !this._handleUnknownRouteRegistration(routeName, "setRouteMeta")) {
        return this;
    }
    this._runtimeMeta.set(routeName, Object.freeze({ ...meta }));
    this._resolvedMetaCache.clear();
    return this;
}
```

- [ ] **Step 7: Clear cache in `destroy()`**

After `this._runtimeMeta.clear()` (line 1885), add:

```typescript
this._resolvedMetaCache.clear();
```

- [ ] **Step 8: Type-check**

Run: `cd packages/lib && npx tsc --noEmit`
Expected: zero errors

- [ ] **Step 9: Commit**

```
feat(router): implement lazy metadata resolution with cache (#62)
```

---

### Task 6: Update tests for lazy resolution

**Files:**

- Modify: `packages/lib/test/qunit/RouterOptions.qunit.ts`

- [ ] **Step 1: Flip the runtime-metadata-inheritance test**

Replace the test `"runtime setRouteMeta does not participate in inheritance"` with:

```typescript
QUnit.test("runtime setRouteMeta participates in inheritance", function (assert: Assert) {
	router = createHierarchicalRouter({
		inheritance: "pattern-tree",
	});

	router.setRouteMeta("employees", { runtimeKey: true });
	const childMeta = router.getRouteMeta("employee");
	assert.strictEqual(childMeta.runtimeKey, true, "runtime metadata propagates to descendants");

	const ownMeta = router.getRouteMeta("employees");
	assert.strictEqual(ownMeta.runtimeKey, true, "runtime metadata is available on the declared route");
});
```

- [ ] **Step 2: Add cache invalidation test**

```typescript
QUnit.test("setRouteMeta invalidates cache so getRouteMeta returns fresh result", function (assert: Assert) {
	router = createHierarchicalRouter({
		inheritance: "pattern-tree",
		routeMeta: {
			employees: { section: "hr" },
		},
	});

	// First read — populates cache
	assert.strictEqual(router.getRouteMeta("employee").section, "hr", "inherited before mutation");

	// Mutate parent runtime metadata
	router.setRouteMeta("employees", { section: "engineering" });

	// Second read — cache was invalidated, fresh walk
	assert.strictEqual(router.getRouteMeta("employee").section, "engineering", "inherits updated runtime value");
});
```

- [ ] **Step 3: Add test for unknown-route warning on getRouteMeta**

```typescript
QUnit.test("getRouteMeta for unknown route returns empty and logs warning", function (assert: Assert) {
	router = createRouterWithOptions({});

	const warnings = captureWarnings(() => {
		const meta = router.getRouteMeta("nonexistent");
		assert.deepEqual(meta, {}, "empty object for unknown route");
		assert.ok(Object.isFrozen(meta), "returned object is frozen");
	});

	assert.ok(
		warnings.some((w) => w.message.includes("getRouteMeta")),
		"warning logged for unknown route",
	);
});
```

- [ ] **Step 4: Add test for getRouteMeta("") no warning**

```typescript
QUnit.test('getRouteMeta("") returns empty object without warning', function (assert: Assert) {
	router = createRouterWithOptions({});

	const warnings = captureWarnings(() => {
		const meta = router.getRouteMeta("");
		assert.deepEqual(meta, {}, "empty object for empty-string route");
	});

	assert.strictEqual(warnings.length, 0, "no warning for empty-string route name");
});
```

- [ ] **Step 5: Add test for setRouteMeta validation**

```typescript
QUnit.test("setRouteMeta with non-object meta logs warning and is a no-op", function (assert: Assert) {
	router = createRouterWithOptions({
		routeMeta: { home: { original: true } },
	});

	const warnings = captureWarnings(() => {
		router.setRouteMeta("home", "not-an-object" as unknown as Record<string, unknown>);
	});

	assert.ok(
		warnings.some((w) => w.message.includes("setRouteMeta")),
		"warning logged for non-object meta",
	);
	assert.strictEqual(router.getRouteMeta("home").original, true, "original metadata preserved");
});
```

- [ ] **Step 6: Add test for setRouteMeta unknown route policy**

```typescript
QUnit.test("setRouteMeta for unknown route follows unknownRouteRegistration policy", function (assert: Assert) {
	router = createRouterWithOptions({
		unknownRouteRegistration: "throw",
	});

	assert.throws(
		() => router.setRouteMeta("nonexistent", { key: true }),
		/setRouteMeta/,
		"throws for unknown route with throw policy",
	);
});
```

- [ ] **Step 7: Add test for snapshot semantics during pipeline**

```typescript
QUnit.test("setRouteMeta during guard does not affect current context toMeta", async function (assert: Assert) {
	router = createRouterWithOptions({
		routeMeta: { protected: { version: 1 } },
	});

	let capturedToMeta: Record<string, unknown> | undefined;
	router.addGuard((context: GuardContext) => {
		// Mutate metadata mid-pipeline
		router.setRouteMeta("protected", { version: 2 });
		return true;
	});
	router.addRouteGuard("protected", (context: GuardContext) => {
		capturedToMeta = context.toMeta;
		return true;
	});

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "protected");

	assert.strictEqual(capturedToMeta!.version, 1, "toMeta is a snapshot -- mid-pipeline mutation does not affect it");
});
```

- [ ] **Step 8: Run all tests**

Run: `cd packages/lib && npm run test:qunit`
Expected: ALL PASS

- [ ] **Step 9: Commit**

```
test(router): update tests for lazy metadata resolution and unified options
```

---

### Task 7: Update README and docs

**Files:**

- Modify: `packages/lib/README.md`
- Modify: `docs/features/12-lazy-resolution-error-handling.md`

- [ ] **Step 1: Update README options table**

Replace the `guardInheritance` and `metaInheritance` rows with a single `inheritance` row. Replace `unknownRouteGuardRegistration` with `unknownRouteRegistration`. Update all manifest JSON examples.

- [ ] **Step 2: Update README inheritance section**

Remove "Both toggles are independent" sentence. Update examples to use `inheritance`. Add note that runtime `setRouteMeta` now participates in inheritance when `inheritance: "pattern-tree"` is enabled.

- [ ] **Step 3: Update error handling spec**

In `docs/features/12-lazy-resolution-error-handling.md`:

- Replace `unknownRouteMetaRegistration` references with `unknownRouteRegistration`
- Replace `guardInheritance`/`metaInheritance` with `inheritance`
- Remove the "New configuration option" section proposing `unknownRouteMetaRegistration` — it no longer needs a new option
- Update the "Impact on Existing Plans" section

- [ ] **Step 4: Commit**

```
docs: update README and specs for unified inheritance and registration options
```

---

### Task 8: Full verification

- [ ] **Step 1: Type-check**

Run: `cd packages/lib && npx tsc --noEmit`
Expected: zero errors

- [ ] **Step 2: Lint**

Run: `npx oxlint --tsconfig tsconfig.base.json --import-plugin --deny-warnings`
Expected: zero warnings, zero errors

- [ ] **Step 3: Run full test suite**

Run: `npm run test:qunit`
Expected: ALL PASS

- [ ] **Step 4: Build and measure preload size**

Run: `cd packages/lib && npm run build && wc -c dist/resources/ui5/guard/router/library-preload.js`
Expected: modest change from current 27,078 B (removal of `_expandManifestMeta` offsets the new lazy resolver)
