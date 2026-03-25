# Route Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add declarative per-route metadata (`routeMeta`) to the manifest config and surface it on `GuardContext` as `toMeta`/`fromMeta` so a single global guard can implement policy-driven patterns (auth, roles, feature flags).

**Architecture:** Metadata is stored in two layers — manifest defaults (`_manifestMeta`) and runtime overrides (`_runtimeMeta`). `getRouteMeta()` resolves them via shallow merge (runtime wins). `_createGuardContext` populates frozen `toMeta`/`fromMeta` by calling `getRouteMeta()` for the target and current routes. No inheritance across route patterns (deferred to #58).

**Tech Stack:** TypeScript, UI5 `sap.m.routing.Router`, QUnit

**Closes:** #57

---

## File Structure

| File                                             | Action    | Responsibility                                                                                                                             |
| ------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/lib/src/types.ts`                      | Modify    | Add `toMeta`/`fromMeta` to `GuardContext`, add `routeMeta` to `GuardRouterOptions`, add `GuardRouter` methods                              |
| `packages/lib/src/Router.ts`                     | Modify    | Parse manifest `routeMeta`, store in `_manifestMeta`/`_runtimeMeta`, implement `getRouteMeta`/`setRouteMeta`, update `_createGuardContext` |
| `packages/lib/test/qunit/RouterOptions.qunit.ts` | Modify    | Add behavioral tests for route metadata                                                                                                    |
| `packages/lib/test/qunit/testHelpers.ts`         | No change | Existing `createRouterWithOptions` already supports passing arbitrary guardRouter config                                                   |
| `packages/lib/README.md`                         | Modify    | Document route metadata manifest config, API methods, GuardContext fields                                                                  |

---

### Task 1: Add types for route metadata

**Files:**

- Modify: `packages/lib/src/types.ts`

- [ ] **Step 1: Add `toMeta` and `fromMeta` to `GuardContext`**

After the `bag` field (line 67), add:

```typescript
/** Resolved metadata for the target route (manifest defaults merged with runtime overrides, frozen). */
toMeta: Readonly<Record<string, unknown>>;
/** Resolved metadata for the current route (manifest defaults merged with runtime overrides, frozen). */
fromMeta: Readonly<Record<string, unknown>>;
```

- [ ] **Step 2: Add `routeMeta` to `GuardRouterOptions`**

After the `guards` field (line 172), add:

```typescript
/**
 * Per-route metadata declarations indexed by route name.
 * Values are arbitrary key-value objects that the router stores but never interprets.
 * Surfaced on `GuardContext` as `toMeta` and `fromMeta`.
 */
routeMeta?: Record<string, Record<string, unknown>>;
```

- [ ] **Step 3: Add `getRouteMeta` and `setRouteMeta` to `GuardRouter` interface**

After `removeLeaveGuard` (line 302), add:

```typescript
/**
 * Get resolved metadata for a route.
 * Returns manifest defaults shallow-merged with runtime overrides.
 * Returns an empty frozen object for unknown or unconfigured routes.
 *
 * @param routeName - Route name as defined in `manifest.json`.
 */
getRouteMeta(routeName: string): Readonly<Record<string, unknown>>;

/**
 * Set runtime metadata for a route, replacing any previous runtime metadata.
 * Does not affect manifest defaults — runtime values take precedence on read.
 *
 * @param routeName - Route name as defined in `manifest.json`.
 * @param meta - Metadata object. The router stores but never interprets it.
 * @returns `this` for chaining.
 */
setRouteMeta(routeName: string, meta: Record<string, unknown>): GuardRouter;
```

- [ ] **Step 4: Update `createContext` in GuardPipeline tests to include new fields**

In `packages/lib/test/qunit/GuardPipeline.qunit.ts`, find the `createContext` helper and add:

```typescript
toMeta: Object.freeze({}),
fromMeta: Object.freeze({}),
```

This prevents TypeScript compile errors in the test suite from blocking subsequent tasks.

- [ ] **Step 5: Type-check**

Run: `cd packages/lib && npx tsc --noEmit`
Expected: Errors about Router not implementing the new interface members and `_createGuardContext` missing the new fields. This is expected — we'll fix them in subsequent tasks.

- [ ] **Step 6: Commit**

```
feat(types): add route metadata types to GuardContext and GuardRouter
```

---

### Task 2: Parse manifest routeMeta in constructor

**Files:**

- Modify: `packages/lib/src/Router.ts`

- [ ] **Step 1: Add private fields for metadata storage**

After `private _destroyed = false;` (line 434), add:

```typescript
private _manifestMeta = new Map<string, Readonly<Record<string, unknown>>>();
private _runtimeMeta = new Map<string, Record<string, unknown>>();
```

- [ ] **Step 2: Parse routeMeta from manifest in the constructor**

After the `this._options = normalizeGuardRouterOptions(guardRouter);` line (line 442), before the guards parsing block, add:

```typescript
if (isRecord(guardRouter) && guardRouter.routeMeta !== undefined) {
	if (isRecord(guardRouter.routeMeta)) {
		for (const [routeName, meta] of Object.entries(guardRouter.routeMeta)) {
			if (isRecord(meta)) {
				this._manifestMeta.set(routeName, Object.freeze({ ...meta }));
			} else {
				Log.warning(
					`guardRouter.routeMeta["${routeName}"]: expected object, skipping`,
					JSON.stringify(meta),
					LOG_COMPONENT,
				);
			}
		}
	} else {
		Log.warning(
			"guardRouter.routeMeta: expected object, skipping",
			JSON.stringify(guardRouter.routeMeta),
			LOG_COMPONENT,
		);
	}
}
```

- [ ] **Step 3: Commit**

```
feat(router): parse manifest routeMeta in constructor
```

---

### Task 3: Implement getRouteMeta and setRouteMeta

**Files:**

- Modify: `packages/lib/src/Router.ts`

- [ ] **Step 1: Write the failing test — getRouteMeta returns manifest metadata**

In `packages/lib/test/qunit/RouterOptions.qunit.ts`, add a new QUnit module after the existing guard context tests:

```typescript
// ============================================================
// Module: Router - Route metadata
// ============================================================
QUnit.module("Router - Route metadata", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
	},
});

QUnit.test("getRouteMeta returns manifest-defined metadata", function (assert: Assert) {
	router = createRouterWithOptions({
		routeMeta: {
			protected: { requiresAuth: true, roles: ["admin"] },
		},
	});

	const meta = router.getRouteMeta("protected");
	assert.strictEqual(meta.requiresAuth, true, "requiresAuth is true");
	assert.deepEqual(meta.roles, ["admin"], "roles array is present");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/lib && npx tsc --noEmit`
Expected: Compile error — `getRouteMeta` does not exist on GuardRouter.

- [ ] **Step 3: Implement getRouteMeta and setRouteMeta on Router**

After `removeLeaveGuard` and before `navigationSettled`, add:

```typescript
private static readonly _EMPTY_META: Readonly<Record<string, unknown>> = Object.freeze({});

getRouteMeta(routeName: string): Readonly<Record<string, unknown>> {
    const manifest = this._manifestMeta.get(routeName);
    const runtime = this._runtimeMeta.get(routeName);
    if (!manifest && !runtime) return Router._EMPTY_META;
    if (!runtime) return manifest!;
    if (!manifest) return Object.freeze({ ...runtime });
    return Object.freeze({ ...manifest, ...runtime });
}

setRouteMeta(routeName: string, meta: Record<string, unknown>): this {
    this._runtimeMeta.set(routeName, meta);
    return this;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:qunit`
Expected: PASS

- [ ] **Step 5: Write test — getRouteMeta returns empty object for unknown routes**

```typescript
QUnit.test("getRouteMeta returns empty object for unknown routes", function (assert: Assert) {
	router = createRouterWithOptions({});

	const meta = router.getRouteMeta("nonexistent");
	assert.deepEqual(meta, {}, "empty object for unknown route");
	assert.ok(Object.isFrozen(meta), "returned object is frozen");
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:qunit`
Expected: PASS (already handled by the `_EMPTY_META` fallback)

- [ ] **Step 7: Write test — setRouteMeta overrides manifest metadata**

```typescript
QUnit.test("setRouteMeta overrides manifest metadata", function (assert: Assert) {
	router = createRouterWithOptions({
		routeMeta: {
			protected: { requiresAuth: true, level: 1 },
		},
	});

	router.setRouteMeta("protected", { requiresAuth: false, custom: "value" });
	const meta = router.getRouteMeta("protected");
	assert.strictEqual(meta.requiresAuth, false, "runtime overrides manifest");
	assert.strictEqual(meta.custom, "value", "runtime adds new keys");
	assert.strictEqual(meta.level, 1, "manifest keys not in runtime are preserved");
});
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test:qunit`
Expected: PASS

- [ ] **Step 9: Write test — setRouteMeta for route without manifest metadata**

```typescript
QUnit.test("setRouteMeta works for routes without manifest metadata", function (assert: Assert) {
	router = createRouterWithOptions({});

	router.setRouteMeta("home", { public: true });
	const meta = router.getRouteMeta("home");
	assert.strictEqual(meta.public, true, "runtime metadata for unconfigured route");
});
```

- [ ] **Step 10: Run test and commit**

Run: `npm run test:qunit`
Expected: PASS

```
feat(router): implement getRouteMeta and setRouteMeta
```

---

### Task 4: Surface toMeta and fromMeta on GuardContext

**Files:**

- Modify: `packages/lib/src/Router.ts`

- [ ] **Step 1: Write the failing test — guard receives toMeta from manifest**

```typescript
QUnit.test("guard receives toMeta from manifest metadata", async function (assert: Assert) {
	router = createRouterWithOptions({
		routeMeta: {
			protected: { requiresAuth: true },
			home: { public: true },
		},
	});
	router.initialize();
	await waitForRoute(router, "home");

	let receivedToMeta: Record<string, unknown> | undefined;
	router.addGuard((context: GuardContext) => {
		receivedToMeta = context.toMeta;
		return true;
	});

	router.navTo("protected");
	await waitForRoute(router, "protected");

	assert.deepEqual(receivedToMeta, { requiresAuth: true }, "toMeta reflects target route metadata");
	assert.ok(Object.isFrozen(receivedToMeta), "toMeta is frozen");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:qunit`
Expected: FAIL — `toMeta` is undefined on context.

- [ ] **Step 3: Update `_createGuardContext` to populate toMeta and fromMeta**

```typescript
private _createGuardContext(
    toRoute: string,
    toHash: string,
    routeInfo: { arguments: Record<string, string | Record<string, string>> } | undefined,
    signal: AbortSignal,
): GuardContext {
    return {
        toRoute,
        toHash,
        toArguments: routeInfo?.arguments ?? {},
        fromRoute: this._currentRoute,
        fromHash: this._currentHash ?? "",
        signal,
        bag: new Map(),
        toMeta: this.getRouteMeta(toRoute),
        fromMeta: this.getRouteMeta(this._currentRoute),
    };
}
```

Also update the redirect context in `_redirect` (the inline `GuardContext` construction) to include `toMeta` and `fromMeta`:

```typescript
const context: GuardContext = {
	toRoute: routeInfo?.name ?? "",
	toHash: resolvedHash,
	toArguments: routeInfo?.arguments ?? {},
	fromRoute: chain.fromRoute,
	fromHash: chain.fromHash,
	signal: chain.signal,
	bag: chain.bag,
	toMeta: this.getRouteMeta(routeInfo?.name ?? ""),
	fromMeta: this.getRouteMeta(chain.fromRoute),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:qunit`
Expected: PASS

- [ ] **Step 5: Write test — guard receives fromMeta for the current route**

```typescript
QUnit.test("guard receives fromMeta for the current route", async function (assert: Assert) {
	router = createRouterWithOptions({
		routeMeta: {
			home: { public: true },
			protected: { requiresAuth: true },
		},
	});
	router.initialize();
	await waitForRoute(router, "home");

	let receivedFromMeta: Record<string, unknown> | undefined;
	router.addGuard((context: GuardContext) => {
		receivedFromMeta = context.fromMeta;
		return true;
	});

	router.navTo("protected");
	await waitForRoute(router, "protected");

	assert.deepEqual(receivedFromMeta, { public: true }, "fromMeta reflects source route metadata");
});
```

- [ ] **Step 6: Write test — runtime setRouteMeta reflected in subsequent navigations**

```typescript
QUnit.test("runtime metadata changes reflected in subsequent navigations", async function (assert: Assert) {
	router = createRouterWithOptions({
		routeMeta: { protected: { requiresAuth: true } },
	});
	router.initialize();
	await waitForRoute(router, "home");

	const snapshots: Record<string, unknown>[] = [];
	router.addGuard((context: GuardContext) => {
		snapshots.push(context.toMeta);
		return true;
	});

	router.navTo("protected");
	await waitForRoute(router, "protected");

	router.setRouteMeta("home", { updated: true });
	router.navTo("home");
	await waitForRoute(router, "home");

	assert.deepEqual(snapshots[0], { requiresAuth: true }, "first navigation uses manifest meta");
	assert.deepEqual(snapshots[1], { updated: true }, "second navigation sees runtime meta");
});
```

- [ ] **Step 7: Write test — toMeta for route without metadata is empty frozen object**

```typescript
QUnit.test("toMeta is empty frozen object for routes without metadata", async function (assert: Assert) {
	router = createRouterWithOptions({});
	router.initialize();
	await waitForRoute(router, "home");

	let receivedToMeta: Record<string, unknown> | undefined;
	router.addGuard((context: GuardContext) => {
		receivedToMeta = context.toMeta;
		return true;
	});

	router.navTo("protected");
	await waitForRoute(router, "protected");

	assert.deepEqual(receivedToMeta, {}, "empty object for unconfigured route");
	assert.ok(Object.isFrozen(receivedToMeta), "empty meta is frozen");
});
```

- [ ] **Step 8: Write test — auth guard pattern using toMeta**

```typescript
QUnit.test("global auth guard using toMeta blocks unauthenticated access", async function (assert: Assert) {
	router = createRouterWithOptions({
		routeMeta: {
			protected: { requiresAuth: true },
			home: { public: true },
		},
	});

	let isLoggedIn = false;
	router.addGuard((context: GuardContext) => {
		if (context.toMeta.requiresAuth && !isLoggedIn) return "home";
		return true;
	});

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const blocked = await router.navigationSettled();
	assert.strictEqual(blocked.status, NavigationOutcome.Redirected, "unauthenticated user redirected");

	isLoggedIn = true;
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.ok(true, "authenticated user reaches protected route");
});
```

- [ ] **Step 9: Run all tests and commit**

Run: `npm run test:qunit`
Expected: ALL PASS

```
feat(router): surface toMeta and fromMeta on GuardContext
```

---

### Task 5: Handle manifest validation edge cases

**Files:**

- Modify: `packages/lib/test/qunit/RouterOptions.qunit.ts`
- Modify: `packages/lib/src/Router.ts`

- [ ] **Step 1: Write test — invalid routeMeta entries produce warnings**

```typescript
QUnit.test("invalid routeMeta entries produce warnings", function (assert: Assert) {
	const warnings = captureWarnings(() => {
		router = createRouterWithOptions({
			routeMeta: {
				home: "not an object",
				protected: { valid: true },
			},
		});
	});

	assert.ok(
		warnings.some((w) => w.message.includes('routeMeta["home"]')),
		"warning for non-object metadata entry",
	);
	assert.deepEqual(router.getRouteMeta("protected"), { valid: true }, "valid entries still parsed");
});
```

- [ ] **Step 2: Write test — non-object routeMeta produces warning**

```typescript
QUnit.test("non-object routeMeta produces warning", function (assert: Assert) {
	const warnings = captureWarnings(() => {
		router = createRouterWithOptions({
			routeMeta: "invalid",
		});
	});

	assert.ok(
		warnings.some((w) => w.message.includes("routeMeta")),
		"warning for non-object routeMeta",
	);
});
```

- [ ] **Step 3: Run tests and commit**

Run: `npm run test:qunit`
Expected: ALL PASS

```
test(router): add route metadata validation edge case tests
```

---

### Task 6: Update README documentation

**Files:**

- Modify: `packages/lib/README.md`

- [ ] **Step 1: Add `toMeta` and `fromMeta` to the GuardContext table**

In the GuardContext properties table, add after the `bag` row:

```markdown
| `toMeta` | `Readonly<Record<string, unknown>>` | Resolved metadata for the target route (manifest + runtime, frozen) |
| `fromMeta` | `Readonly<Record<string, unknown>>` | Resolved metadata for the current route (manifest + runtime, frozen) |
```

- [ ] **Step 2: Add Route Metadata section after Guard context bag section**

Add a new subsection documenting:

- Manifest configuration under `guardRouter.routeMeta`
- `getRouteMeta()` and `setRouteMeta()` methods
- Example: auth + role guard using a single global guard with metadata

- [ ] **Step 3: Update the API tables**

Add `getRouteMeta` and `setRouteMeta` to the guard registration/removal API table section.

- [ ] **Step 4: Commit**

```
docs(readme): document route metadata configuration and API
```

---

### Task 7: Full verification

- [ ] **Step 1: Type-check**

Run: `cd packages/lib && npx tsc --noEmit`
Expected: zero errors

- [ ] **Step 2: Lint**

Run: `npx oxlint --tsconfig tsconfig.base.json --import-plugin --deny-warnings`
Expected: zero warnings, zero errors

- [ ] **Step 3: Run full test suite**

Run: `npm run test:full`
Expected: ALL PASS (QUnit + E2E + compat)

- [ ] **Step 4: Build and measure preload size**

Run: `cd packages/lib && npm run build && wc -c dist/resources/ui5/guard/router/library-preload.js`
Expected: modest increase (~200-400 B over current 24,149 B)
