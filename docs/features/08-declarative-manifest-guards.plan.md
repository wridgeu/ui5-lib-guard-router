# Declarative Manifest Guards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manifest-first guard router configuration (router options + declarative guard registration + context bag) to the guard router library.

**Architecture:** Extend the existing state machine router with a constructor that reads `guardRouter` config, an `initialize()` override for guard module loading, and an updated `navTo()` with preflight modes and per-call options. All changes build on the existing phase model (idle/evaluating/committing).

**Tech Stack:** TypeScript (ES2022), UI5 (OpenUI5 1.144+), QUnit 2.x, Sinon 4.x

**Spec:** `docs/features/08-declarative-manifest-guards.md`

**Branch:** Create `feat/declarative-manifest-guards` from `main`

---

## File Map

| File                                                        | Action | Responsibility                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/lib/src/types.ts`                                 | Modify | Add new types: `UnknownRouteGuardRegistrationPolicy`, `NavToPreflightMode`, `GuardLoading`, `GuardRouterOptions`, `GuardNavToOptions`, `ManifestGuardConfig`, `ManifestRouteGuardConfig`. Add `bag` to `GuardContext`. Add `navTo` overloads to `GuardRouter`.                       |
| `packages/lib/src/Router.ts`                                | Modify | Add constructor config parsing, `_options` field, `normalizeGuardRouterOptions()`, `_handleUnknownRouteRegistration()`, `initialize()` override for guard module loading, `navTo()` overload expansion with preflight modes and `skipGuards`, `bag` creation in `_evaluateGuards()`. |
| `packages/lib/test/qunit/testHelpers.ts`                    | Modify | Add `createRouterWithOptions()` helper for creating routers with `guardRouter` config.                                                                                                                                                                                               |
| `packages/lib/test/qunit/Router.qunit.ts`                   | Modify | Add test modules for: router options, unknown route policies, navTo preflight modes, skipGuards, guard context bag, manifest guard loading (block + lazy).                                                                                                                           |
| `packages/lib/test/qunit/fixtures/manifest/Component.ts`    | Create | Minimal UIComponent for manifest-driven router instantiation tests.                                                                                                                                                                                                                  |
| `packages/lib/test/qunit/fixtures/manifest/manifest.json`   | Create | Test manifest with `guardRouter` config block.                                                                                                                                                                                                                                       |
| `packages/lib/test/qunit/fixtures/guards/allowGuard.ts`     | Create | Stub guard module exporting `() => true`.                                                                                                                                                                                                                                            |
| `packages/lib/test/qunit/fixtures/guards/blockGuard.ts`     | Create | Stub guard module exporting `() => false`.                                                                                                                                                                                                                                           |
| `packages/lib/test/qunit/fixtures/guards/redirectGuard.ts`  | Create | Stub guard module exporting `() => "home"`.                                                                                                                                                                                                                                          |
| `packages/lib/test/qunit/fixtures/guards/leaveGuard.ts`     | Create | Stub leave guard module exporting `() => true`.                                                                                                                                                                                                                                      |
| `packages/lib/test/qunit/fixtures/guards/bagWriterGuard.ts` | Create | Stub guard that writes to `context.bag`.                                                                                                                                                                                                                                             |
| `packages/lib/test/qunit/fixtures/guards/bagReaderGuard.ts` | Create | Stub guard that reads from `context.bag` and blocks if missing.                                                                                                                                                                                                                      |
| `packages/lib/README.md`                                    | Modify | Add manifest configuration documentation.                                                                                                                                                                                                                                            |

---

## Task 1: Add new types to `types.ts`

**Files:**

- Modify: `packages/lib/src/types.ts`

- [ ] **Step 1: Add `bag` to `GuardContext`**

Add `bag: Map<string, unknown>` as the last field of the `GuardContext` interface:

```typescript
export interface GuardContext {
	// ... existing fields ...
	/**
	 * Shared mutable bag for passing data between guards within a single
	 * pipeline run. Created fresh per navigation attempt. The router never
	 * reads from or writes to it — it is purely a carrier for inter-guard
	 * communication.
	 */
	bag: Map<string, unknown>;
}
```

- [ ] **Step 2: Add option and config types**

Add after the `RouteGuardConfig` interface:

```typescript
/**
 * Policy for guard registration against unknown route names.
 *
 * - `"ignore"` — register silently.
 * - `"warn"` — log a warning and still register (default).
 * - `"throw"` — throw synchronously; guard is not registered.
 */
export type UnknownRouteGuardRegistrationPolicy = "ignore" | "warn" | "throw";

/**
 * Strategy for programmatic `navTo()` guard evaluation.
 *
 * - `"guard"` — run guards before the hash changes (default).
 * - `"bypass"` — skip guards for programmatic `navTo()` only.
 * - `"off"` — disable preflight; `parse()` guards the hash change afterward.
 */
export type NavToPreflightMode = "guard" | "bypass" | "off";

/**
 * Strategy for loading manifest-declared guard modules.
 *
 * - `"block"` — delay `initialize()` until all modules are loaded (default).
 * - `"lazy"` — register lazy wrappers that load modules on first use.
 */
export type GuardLoading = "block" | "lazy";

/**
 * Per-route guard declaration in the manifest.
 */
export interface ManifestRouteGuardConfig {
	/** Enter guard module paths (dot notation, relative to component namespace). */
	enter?: string[];
	/** Leave guard module paths (dot notation, relative to component namespace). */
	leave?: string[];
}

/**
 * Guard declarations in the manifest `guardRouter.guards` block.
 *
 * Keys are route names or `"*"` for global guards.
 * Values are either a `string[]` shorthand (enter guards only)
 * or a {@link ManifestRouteGuardConfig} object with `enter` and/or `leave` arrays.
 */
export type ManifestGuardConfig = Record<string, string[] | ManifestRouteGuardConfig>;

/**
 * Router-level options for the guard router.
 *
 * Configured manifest-first under `sap.ui5.routing.config.guardRouter`.
 * Defaults: `unknownRouteGuardRegistration: "warn"`, `navToPreflight: "guard"`, `guardLoading: "block"`.
 */
export interface GuardRouterOptions {
	unknownRouteGuardRegistration?: UnknownRouteGuardRegistrationPolicy;
	navToPreflight?: NavToPreflightMode;
	guardLoading?: GuardLoading;
	guards?: ManifestGuardConfig;
}

/**
 * Per-navigation overrides for programmatic `navTo()` calls.
 */
export interface GuardNavToOptions {
	/**
	 * When `true`, skip all guards for this navigation only.
	 * Browser-initiated hash changes still run through `parse()`.
	 */
	skipGuards?: boolean;
}
```

- [ ] **Step 3: Add `navTo` overloads to `GuardRouter` interface**

Add before the existing `addGuard` declaration in the `GuardRouter` interface:

```typescript
	/**
	 * Navigate with optional guard-router-specific per-call options.
	 */
	navTo(routeName: string, parameters?: object, bReplace?: boolean): this;
	navTo(
		routeName: string,
		parameters?: object,
		componentTargetInfo?: Record<string, ComponentTargetParameters>,
		bReplace?: boolean,
	): this;
	navTo(routeName: string, parameters?: object, bReplace?: boolean, options?: GuardNavToOptions): this;
	navTo(
		routeName: string,
		parameters?: object,
		componentTargetInfo?: Record<string, ComponentTargetParameters>,
		bReplace?: boolean,
		options?: GuardNavToOptions,
	): this;
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd packages/lib && npx tsc --noEmit -p tsconfig.test.json`
Expected: No errors (types are added but not yet consumed).

- [ ] **Step 5: Commit**

```
git add packages/lib/src/types.ts
git commit -m "feat(types): add manifest guard config, router options, and context bag types"
```

---

## Task 2: Add `bag` to guard pipeline

**Files:**

- Modify: `packages/lib/src/Router.ts`
- Modify: `packages/lib/test/qunit/Router.qunit.ts`

- [ ] **Step 1: Write failing test — bag exists on guard context**

Append to `Router.qunit.ts` in a new test module:

```typescript
// ============================================================
// Module: Guard context bag
// ============================================================
QUnit.module("Router - Guard context bag", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
		router.initialize();
	},
	afterEach: standardHooks.afterEach,
});

QUnit.test("guard receives a bag Map on context", async function (assert: Assert) {
	await waitForRoute(router, "home");

	let receivedMeta: Map<string, unknown> | undefined;
	router.addGuard((context: GuardContext) => {
		receivedMeta = context.bag;
		return true;
	});

	router.navTo("protected");
	await waitForRoute(router, "protected");

	assert.ok(receivedMeta instanceof Map, "bag is a Map instance");
	assert.strictEqual(receivedMeta!.size, 0, "bag starts empty");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:qunit`
Expected: FAIL — `context.bag` is undefined.

- [ ] **Step 3: Implement bag creation in `_evaluateGuards`**

In `Router.ts`, update `_evaluateGuards` to create the `bag` Map when building the context:

```typescript
const bag = new Map<string, unknown>();
const context: GuardContext = { ...baseContext, signal, bag };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:qunit`
Expected: PASS

- [ ] **Step 5: Write test — bag is shared across leave and enter guards**

```typescript
QUnit.test("bag is shared across leave and enter guards in the same pipeline", async function (assert: Assert) {
	await waitForRoute(router, "home");

	let enterMeta: Map<string, unknown> | undefined;

	router.addLeaveGuard("home", (context: GuardContext) => {
		context.bag.set("fromLeave", true);
		return true;
	});

	router.addGuard((context: GuardContext) => {
		enterMeta = context.bag;
		return true;
	});

	router.navTo("protected");
	await waitForRoute(router, "protected");

	assert.ok(enterMeta instanceof Map, "enter guard received bag");
	assert.strictEqual(enterMeta!.get("fromLeave"), true, "enter guard sees data set by leave guard");
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:qunit`
Expected: PASS (bag is already shared since it's created once per `_evaluateGuards` call).

- [ ] **Step 7: Write test — bag is fresh per navigation**

```typescript
QUnit.test("bag is fresh for each navigation (not carried across)", async function (assert: Assert) {
	await waitForRoute(router, "home");

	const metaSnapshots: Map<string, unknown>[] = [];
	router.addGuard((context: GuardContext) => {
		metaSnapshots.push(context.bag);
		context.bag.set("visited", true);
		return true;
	});

	router.navTo("protected");
	await waitForRoute(router, "protected");

	router.navTo("forbidden");
	await waitForRoute(router, "forbidden");

	assert.strictEqual(metaSnapshots.length, 2, "guard ran twice");
	assert.notStrictEqual(metaSnapshots[0], metaSnapshots[1], "each navigation gets a different Map instance");
	assert.notOk(metaSnapshots[1]!.has("visited"), "second navigation bag does not carry data from first");
});
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test:qunit`
Expected: PASS

- [ ] **Step 9: Commit**

```
git add packages/lib/src/Router.ts packages/lib/test/qunit/Router.qunit.ts
git commit -m "feat(router): add bag Map to GuardContext for inter-guard data passing"
```

---

## Task 3: Constructor config parsing and option normalization

**Files:**

- Modify: `packages/lib/src/Router.ts`
- Modify: `packages/lib/test/qunit/Router.qunit.ts`
- Modify: `packages/lib/test/qunit/testHelpers.ts`

- [ ] **Step 1: Add `createRouterWithOptions` helper to testHelpers.ts**

```typescript
export function createRouterWithOptions(guardRouter: Record<string, unknown>): GuardRouter {
	return new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
			{ name: "forbidden", pattern: "forbidden" },
			{ name: "detail", pattern: "detail/{id}" },
		],
		{
			async: true,
			guardRouter,
		},
	);
}
```

- [ ] **Step 2: Write failing test — constructor reads guardRouter and strips it from parent config**

```typescript
// ============================================================
// Module: Router options — constructor
// ============================================================
QUnit.module("Router - Router options — constructor", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("constructor accepts guardRouter config and does not leak it to parent", function (assert: Assert) {
	router = createRouterWithOptions({ unknownRouteGuardRegistration: "ignore", navToPreflight: "guard" });
	const options = Reflect.get(router, "_options") as Record<string, unknown>;

	assert.strictEqual(options.unknownRouteGuardRegistration, "ignore", "unknownRouteGuardRegistration is read");
	assert.strictEqual(options.navToPreflight, "guard", "navToPreflight is read");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:qunit`
Expected: FAIL — `_options` is undefined.

- [ ] **Step 4: Implement constructor config parsing**

In `Router.ts`, add the validation helpers and update the constructor:

```typescript
/** Type guard for plain objects. */
function isRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

function isUnknownRouteGuardRegistrationPolicy(v: unknown): v is UnknownRouteGuardRegistrationPolicy {
	return v === "ignore" || v === "warn" || v === "throw";
}

function isNavToPreflightMode(v: unknown): v is NavToPreflightMode {
	return v === "guard" || v === "bypass" || v === "off";
}

function isGuardLoading(v: unknown): v is GuardLoading {
	return v === "block" || v === "lazy";
}

interface ResolvedGuardRouterOptions {
	readonly unknownRouteGuardRegistration: UnknownRouteGuardRegistrationPolicy;
	readonly navToPreflight: NavToPreflightMode;
	readonly guardLoading: GuardLoading;
}

const DEFAULT_OPTIONS: ResolvedGuardRouterOptions = {
	unknownRouteGuardRegistration: "warn",
	navToPreflight: "guard",
	guardLoading: "block",
};

function normalizeGuardRouterOptions(raw: unknown): ResolvedGuardRouterOptions {
	if (!isRecord(raw)) {
		if (raw !== undefined) {
			Log.warning("guardRouter config is not a plain object, using defaults", JSON.stringify(raw), LOG_COMPONENT);
		}
		return DEFAULT_OPTIONS;
	}

	const result = { ...DEFAULT_OPTIONS };

	if (raw.unknownRouteGuardRegistration !== undefined) {
		if (isUnknownRouteGuardRegistrationPolicy(raw.unknownRouteGuardRegistration)) {
			result.unknownRouteGuardRegistration = raw.unknownRouteGuardRegistration;
		} else {
			Log.warning(
				"guardRouter.unknownRouteGuardRegistration has invalid value, using default",
				JSON.stringify(raw.unknownRouteGuardRegistration),
				LOG_COMPONENT,
			);
		}
	}

	if (raw.navToPreflight !== undefined) {
		if (isNavToPreflightMode(raw.navToPreflight)) {
			result.navToPreflight = raw.navToPreflight;
		} else {
			Log.warning(
				"guardRouter.navToPreflight has invalid value, using default",
				JSON.stringify(raw.navToPreflight),
				LOG_COMPONENT,
			);
		}
	}

	if (raw.guardLoading !== undefined) {
		if (isGuardLoading(raw.guardLoading)) {
			result.guardLoading = raw.guardLoading;
		} else {
			Log.warning(
				"guardRouter.guardLoading has invalid value, using default",
				JSON.stringify(raw.guardLoading),
				LOG_COMPONENT,
			);
		}
	}

	return result;
}
```

Update the class:

```typescript
export default class Router extends MobileRouter implements GuardRouter {
	private _globalGuards: GuardFn[] = [];
	private _enterGuards = new Map<string, GuardFn[]>();
	private _leaveGuards = new Map<string, LeaveGuardFn[]>();
	private _currentRoute = "";
	private _currentHash: string | null = null;
	private _phase: RouterPhase = IDLE;
	private _parseGeneration = 0;
	private _suppressedHash: string | null = null;
	private _settlementResolvers: ((result: NavigationResult) => void)[] = [];
	private _lastSettlement: NavigationResult | null = null;
	private _options: ResolvedGuardRouterOptions = DEFAULT_OPTIONS;

	constructor(
		routes?: object | object[],
		config: (object & { guardRouter?: unknown }) | undefined = {},
		owner?: object,
		targetsConfig?: object,
		routerHashChanger?: object,
	) {
		const { guardRouter, ...cleanConfig } = isRecord(config) ? config : ({} as Record<string, unknown>);
		super(routes, isRecord(config) ? cleanConfig : config, owner, targetsConfig, routerHashChanger);
		this._options = normalizeGuardRouterOptions(guardRouter);
	}
	// ... rest of class
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:qunit`
Expected: PASS

- [ ] **Step 6: Write test — malformed config warns and falls back to defaults**

```typescript
QUnit.test("malformed guardRouter config warns and uses defaults", function (assert: Assert) {
	const warnings = captureWarnings(() => {
		router = createRouterWithOptions("not-an-object" as unknown as Record<string, unknown>);
	});
	const options = Reflect.get(router, "_options") as Record<string, unknown>;

	assert.strictEqual(options.unknownRouteGuardRegistration, "warn", "falls back to default");
	assert.strictEqual(options.navToPreflight, "guard", "falls back to default");
	assert.ok(warnings.length > 0, "warning logged for non-object config");
});

QUnit.test("invalid option values warn individually and fall back", function (assert: Assert) {
	const warnings = captureWarnings(() => {
		router = createRouterWithOptions({
			unknownRouteGuardRegistration: "invalid",
			navToPreflight: 42,
			guardLoading: null,
		});
	});
	const options = Reflect.get(router, "_options") as Record<string, unknown>;

	assert.strictEqual(
		options.unknownRouteGuardRegistration,
		"warn",
		"invalid unknownRouteGuardRegistration falls back",
	);
	assert.strictEqual(options.navToPreflight, "guard", "invalid navToPreflight falls back");
	assert.strictEqual(options.guardLoading, "block", "invalid guardLoading falls back");
	assert.strictEqual(warnings.length, 3, "one warning per invalid option");
});
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test:qunit`
Expected: PASS

- [ ] **Step 8: Commit**

```
git add packages/lib/src/Router.ts packages/lib/test/qunit/Router.qunit.ts packages/lib/test/qunit/testHelpers.ts
git commit -m "feat(router): add constructor config parsing and option normalization"
```

---

## Task 4: Unknown route guard registration policies

**Files:**

- Modify: `packages/lib/src/Router.ts`
- Modify: `packages/lib/test/qunit/Router.qunit.ts`

- [ ] **Step 1: Write failing test — "ignore" policy silences warnings**

```typescript
// ============================================================
// Module: Router options — unknownRouteGuardRegistration
// ============================================================
QUnit.module("Router - unknownRouteGuardRegistration", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test('"ignore" registers silently for unknown routes', function (assert: Assert) {
	router = createRouterWithOptions({ unknownRouteGuardRegistration: "ignore" });
	const guard: GuardFn = () => true;

	const warnings = captureWarnings(() => {
		router.addRouteGuard("nonexistent", guard);
		router.addLeaveGuard("nonexistent", guard);
	});

	assert.strictEqual(warnings.length, 0, "no warnings logged");
	const enterGuards = Reflect.get(router, "_enterGuards") as Map<string, GuardFn[]>;
	assert.strictEqual(enterGuards.get("nonexistent")?.length, 1, "guard registered despite unknown route");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:qunit`
Expected: FAIL — warnings are still logged (using default "warn" behavior).

- [ ] **Step 3: Write failing test — "throw" policy prevents registration**

```typescript
QUnit.test('"throw" prevents registration and throws', function (assert: Assert) {
	router = createRouterWithOptions({ unknownRouteGuardRegistration: "throw" });

	assert.throws(
		() => router.addRouteGuard("nonexistent", () => true),
		/unknown route/i,
		"addRouteGuard throws for unknown route",
	);

	assert.throws(
		() => router.addLeaveGuard("nonexistent", () => true),
		/unknown route/i,
		"addLeaveGuard throws for unknown route",
	);

	const enterGuards = Reflect.get(router, "_enterGuards") as Map<string, GuardFn[]>;
	assert.notOk(enterGuards.has("nonexistent"), "guard was not registered after throw");
});

QUnit.test('"throw" with config object is all-or-nothing', function (assert: Assert) {
	router = createRouterWithOptions({ unknownRouteGuardRegistration: "throw" });

	assert.throws(
		() => router.addRouteGuard("nonexistent", { beforeEnter: () => true, beforeLeave: () => true }),
		/unknown route/i,
		"config form also throws for unknown route",
	);

	const enterGuards = Reflect.get(router, "_enterGuards") as Map<string, GuardFn[]>;
	const leaveGuards = Reflect.get(router, "_leaveGuards") as Map<string, LeaveGuardFn[]>;
	assert.notOk(enterGuards.has("nonexistent"), "enter guard not registered");
	assert.notOk(leaveGuards.has("nonexistent"), "leave guard not registered — all-or-nothing");
});
```

- [ ] **Step 4: Implement `_handleUnknownRouteRegistration`**

Replace `_warnIfRouteUnknown` with:

```typescript
/**
 * Handle guard registration for a potentially unknown route.
 * Returns `true` if registration should proceed, `false` if not.
 */
private _handleUnknownRouteRegistration(routeName: string, methodName: string): boolean {
	if (this.getRoute(routeName)) return true;

	switch (this._options.unknownRouteGuardRegistration) {
		case "ignore":
			return true;
		case "throw":
			throw new Error(
				`${methodName} called for unknown route "${routeName}". ` +
				`Set guardRouter.unknownRouteGuardRegistration to "warn" or "ignore" to allow this.`,
			);
		case "warn":
		default:
			Log.warning(
				`${methodName} called for unknown route; guard will still register. ` +
				`If the route is added later via addRoute(), this warning can be ignored.`,
				routeName,
				LOG_COMPONENT,
			);
			return true;
	}
}
```

Update `addRouteGuard` — move the unknown route check before handler validation for the config form, and return early on `false`:

```typescript
addRouteGuard(routeName: string, guard: GuardFn | RouteGuardConfig): this {
	if (isRouteGuardConfig(guard)) {
		if (!this._handleUnknownRouteRegistration(routeName, "addRouteGuard")) return this;
		// ... rest of config handling
	}
	// ... function form
	if (!this._handleUnknownRouteRegistration(routeName, "addRouteGuard")) return this;
	// ...
}
```

Update `addLeaveGuard` similarly.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:qunit`
Expected: PASS (all existing tests + new policy tests).

- [ ] **Step 6: Commit**

```
git add packages/lib/src/Router.ts packages/lib/test/qunit/Router.qunit.ts
git commit -m "feat(router): add unknownRouteGuardRegistration policy (ignore/warn/throw)"
```

---

## Task 5: navTo preflight modes and skipGuards

**Files:**

- Modify: `packages/lib/src/Router.ts`
- Modify: `packages/lib/test/qunit/Router.qunit.ts`

- [ ] **Step 1: Write failing test — "bypass" mode skips guards for programmatic navTo**

```typescript
// ============================================================
// Module: Router options — navToPreflight
// ============================================================
QUnit.module("Router - navToPreflight", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test('"bypass" skips guards for programmatic navTo', async function (assert: Assert) {
	router = createRouterWithOptions({ navToPreflight: "bypass" });
	router.addGuard(() => false); // would block in guard mode
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "protected");

	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "navigation committed despite blocking guard");
	assert.strictEqual(result.route, "protected", "reached target route");
});

QUnit.test('"bypass" still guards browser-initiated hash changes', async function (assert: Assert) {
	router = createRouterWithOptions({ navToPreflight: "bypass" });
	router.addGuard(() => false);
	router.initialize();
	await waitForRoute(router, "home");

	HashChanger.getInstance().setHash("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "browser hash change is still guarded");
});
```

- [ ] **Step 2: Write failing test — "off" mode defers to parse fallback**

```typescript
QUnit.test('"off" defers guard evaluation to parse() fallback', async function (assert: Assert) {
	router = createRouterWithOptions({ navToPreflight: "off" });
	router.addGuard(() => false);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "guard ran via parse() fallback and blocked");
	assert.strictEqual(getHash(), "", "hash restored after block via parse path");
});
```

- [ ] **Step 3: Write failing test — skipGuards per-call override**

```typescript
// ============================================================
// Module: Router options — skipGuards
// ============================================================
QUnit.module("Router - skipGuards", {
	beforeEach: function () {
		initHashChanger();
		router = createRouter();
		router.initialize();
	},
	afterEach: standardHooks.afterEach,
});

QUnit.test("skipGuards bypasses guards for a single navTo call", async function (assert: Assert) {
	await waitForRoute(router, "home");

	router.addGuard(() => false);

	// With skipGuards, the blocking guard is bypassed
	router.navTo("protected", {}, false, { skipGuards: true });
	await waitForRoute(router, "protected");

	assert.strictEqual(getHash(), "protected", "navigated despite blocking guard");
});

QUnit.test("skipGuards produces NavigationOutcome.Committed", async function (assert: Assert) {
	await waitForRoute(router, "home");

	router.addGuard(() => false);

	router.navTo("protected", {}, false, { skipGuards: true });
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Committed, "skipGuards settles as Committed");
	assert.strictEqual(result.route, "protected", "reached target route");
});

QUnit.test("skipGuards does not affect subsequent navTo calls", async function (assert: Assert) {
	await waitForRoute(router, "home");

	router.addGuard(() => false);

	router.navTo("protected", {}, false, { skipGuards: true });
	await waitForRoute(router, "protected");

	router.navTo("forbidden");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "next navTo without skipGuards is still guarded");
});
```

- [ ] **Step 4: Implement navTo overload expansion**

Update the `navTo` override in `Router.ts` to handle the new overloads and options:

```typescript
override navTo(
	routeName: string,
	parameters?: object,
	componentTargetInfoOrReplace?: Record<string, ComponentTargetParameters> | boolean,
	replaceOrOptions?: boolean | GuardNavToOptions,
	options?: GuardNavToOptions,
): this {
	let componentTargetInfo: Record<string, ComponentTargetParameters> | undefined;
	let replace: boolean | undefined;
	let guardOptions: GuardNavToOptions | undefined;

	if (typeof componentTargetInfoOrReplace === "boolean") {
		replace = componentTargetInfoOrReplace;
		// 4th arg could be GuardNavToOptions when using short form
		if (typeof replaceOrOptions === "object" && replaceOrOptions !== null) {
			guardOptions = replaceOrOptions as GuardNavToOptions;
		}
	} else {
		componentTargetInfo = componentTargetInfoOrReplace;
		if (typeof replaceOrOptions === "boolean") {
			replace = replaceOrOptions;
		}
		guardOptions = options;
	}

	const skipGuards = guardOptions?.skipGuards === true;

	// Redirect path (existing)
	if (this._phase.kind === "committing" && this._phase.origin === "redirect") {
		super.navTo(routeName, parameters, componentTargetInfo, replace);
		return this;
	}

	// Resolve target
	const route = this.getRoute(routeName);
	if (!route) {
		this._cancelPendingNavigation();
		super.navTo(routeName, parameters, componentTargetInfo, replace);
		return this;
	}

	const targetHash = route.getURL(parameters ?? {});
	const routeInfo = this.getRouteInfoByHash(targetHash);
	const toRoute = routeInfo?.name ?? "";

	// Same-hash dedup
	if (this._currentHash !== null && targetHash === this._currentHash) {
		this._cancelPendingNavigation();
		return this;
	}

	// Pending-hash dedup
	if (this._phase.kind === "evaluating" && targetHash === this._phase.attempt.hash) {
		return this;
	}

	// skipGuards or bypass mode: commit directly
	if (skipGuards || this._options.navToPreflight === "bypass") {
		this._cancelPendingNavigation();
		this._phase = { kind: "committing", hash: targetHash, route: toRoute, origin: "preflight" };
		super.navTo(routeName, parameters, componentTargetInfo, replace);
		if (this._phase.kind === "committing" && this._phase.hash === targetHash) {
			this._commitNavigation(targetHash, toRoute);
		}
		return this;
	}

	// "off" mode: delegate to super (parse will guard)
	if (this._options.navToPreflight === "off") {
		this._cancelPendingNavigation();
		super.navTo(routeName, parameters, componentTargetInfo, replace);
		return this;
	}

	// Default "guard" mode: existing preflight logic
	this._cancelPendingNavigation();
	// ... rest of existing guard evaluation code
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:qunit`
Expected: PASS (all existing + new tests).

- [ ] **Step 6: Commit**

```
git add packages/lib/src/Router.ts packages/lib/test/qunit/Router.qunit.ts
git commit -m "feat(router): add navToPreflight modes (guard/bypass/off) and skipGuards option"
```

---

## Task 6: Create test fixtures for manifest guard loading

**Files:**

- Create: `packages/lib/test/qunit/fixtures/manifest/Component.ts`
- Create: `packages/lib/test/qunit/fixtures/manifest/manifest.json`
- Create: `packages/lib/test/qunit/fixtures/guards/allowGuard.ts`
- Create: `packages/lib/test/qunit/fixtures/guards/blockGuard.ts`
- Create: `packages/lib/test/qunit/fixtures/guards/redirectGuard.ts`
- Create: `packages/lib/test/qunit/fixtures/guards/leaveGuard.ts`
- Create: `packages/lib/test/qunit/fixtures/guards/bagWriterGuard.ts`
- Create: `packages/lib/test/qunit/fixtures/guards/bagReaderGuard.ts`

- [ ] **Step 1: Create stub guard modules**

Each is a minimal default-export module:

`allowGuard.ts`:

```typescript
import type { GuardContext, GuardResult } from "ui5/guard/router/types";
export default function allowGuard(_context: GuardContext): GuardResult {
	return true;
}
```

`blockGuard.ts`:

```typescript
import type { GuardContext, GuardResult } from "ui5/guard/router/types";
export default function blockGuard(_context: GuardContext): GuardResult {
	return false;
}
```

`redirectGuard.ts`:

```typescript
import type { GuardContext, GuardResult } from "ui5/guard/router/types";
export default function redirectGuard(_context: GuardContext): GuardResult {
	return "home";
}
```

`leaveGuard.ts`:

```typescript
import type { GuardContext } from "ui5/guard/router/types";
export default function leaveGuard(_context: GuardContext): boolean {
	return true;
}
```

`bagWriterGuard.ts`:

```typescript
import type { GuardContext, GuardResult } from "ui5/guard/router/types";
export default function bagWriterGuard(context: GuardContext): GuardResult {
	context.bag.set("writer", "was-here");
	return true;
}
```

`bagReaderGuard.ts`:

```typescript
import type { GuardContext, GuardResult } from "ui5/guard/router/types";
export default function bagReaderGuard(context: GuardContext): GuardResult {
	return context.bag.has("writer") ? true : false;
}
```

- [ ] **Step 2: Create manifest test Component**

`fixtures/manifest/Component.ts`:

```typescript
import UIComponent from "sap/ui/core/UIComponent";

/**
 * Minimal test component for manifest-driven router instantiation.
 * @namespace ui5.guard.router.qunit.fixtures.manifest
 */
export default class Component extends UIComponent {
	static readonly metadata = {
		manifest: "json",
	};
}
```

`fixtures/manifest/manifest.json`:

```json
{
	"sap.app": {
		"id": "ui5.guard.router.qunit.fixtures.manifest",
		"type": "application",
		"applicationVersion": {
			"version": "1.0.0"
		}
	},
	"sap.ui5": {
		"routing": {
			"config": {
				"routerClass": "ui5.guard.router.Router",
				"async": true,
				"guardRouter": {
					"unknownRouteGuardRegistration": "ignore",
					"navToPreflight": "guard",
					"guardLoading": "block"
				}
			},
			"routes": [
				{ "name": "home", "pattern": "" },
				{ "name": "protected", "pattern": "protected" }
			],
			"targets": {}
		}
	}
}
```

- [ ] **Step 3: Commit**

```
git add packages/lib/test/qunit/fixtures/
git commit -m "test(fixtures): add stub guard modules and manifest test component"
```

---

## Task 7: Manifest-based guard module loading (`"block"` mode)

**Files:**

- Modify: `packages/lib/src/Router.ts`
- Modify: `packages/lib/test/qunit/Router.qunit.ts`

- [ ] **Step 1: Write failing test — guards block parsed from manifest config and registered**

```typescript
// ============================================================
// Module: Declarative manifest guards — block loading
// ============================================================
QUnit.module("Router - Declarative manifest guards (block loading)", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("guards from config are registered and functional (block mode)", async function (assert: Assert) {
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
					protected: ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
				},
			},
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(
		result.status,
		NavigationOutcome.Blocked,
		"manifest-declared blocking guard prevents navigation",
	);
});
```

Note: For this test, we use the full slash-path module ID since we're not going through a UIComponent (no `sap.app.id` for namespace resolution). The relative dot-notation resolution will be tested separately with the manifest Component fixture.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:qunit`
Expected: FAIL — `initialize()` does not load guard modules.

- [ ] **Step 3: Implement guard descriptor parsing and `initialize()` override**

Add to `Router.ts`:

```typescript
/** Parsed manifest guard declaration. */
interface GuardDescriptor {
	readonly route: string; // "*" for global, route name for per-route
	readonly type: "enter" | "leave";
	readonly modulePath: string;
}

/**
 * Resolve a guard module path following UI5's routing convention.
 *
 * Mirrors `sap.ui.core.routing.Target._getEffectiveObjectName()`:
 * - Relative dot-notation paths are prefixed with the component namespace.
 * - Paths starting with `"module:"` bypass resolution and use the explicit path.
 * - Dots are converted to slashes for `sap.ui.require`.
 */
function resolveGuardModulePath(dotPath: string, componentNamespace: string): string {
	if (dotPath.startsWith("module:")) {
		return dotPath.slice("module:".length).replace(/\./g, "/");
	}
	const fullDotPath = componentNamespace ? componentNamespace + "." + dotPath : dotPath;
	return fullDotPath.replace(/\./g, "/");
}

function parseGuardDescriptors(guards: unknown, componentNamespace: string): GuardDescriptor[] {
	if (!isRecord(guards)) return [];

	const descriptors: GuardDescriptor[] = [];

	for (const [routeKey, value] of Object.entries(guards)) {
		if (Array.isArray(value)) {
			// Shorthand: string[] → enter guards (or global guards for "*")
			for (const modulePath of value) {
				if (typeof modulePath !== "string" || modulePath.length === 0) {
					Log.warning(
						"guardRouter.guards: invalid module path, skipping",
						JSON.stringify(modulePath),
						LOG_COMPONENT,
					);
					continue;
				}
				descriptors.push({
					route: routeKey,
					type: "enter",
					modulePath: resolveGuardModulePath(modulePath, componentNamespace),
				});
			}
		} else if (isRecord(value)) {
			if (routeKey === "*" && value.enter) {
				// "*" with object form: treat enter as global guards, warn
				Log.warning(
					'guardRouter.guards: "*" only supports array format, treating "enter" as global guards',
					undefined,
					LOG_COMPONENT,
				);
			}
			for (const phase of ["enter", "leave"] as const) {
				const modules = value[phase];
				if (!Array.isArray(modules)) continue;
				if (routeKey === "*" && phase === "leave") {
					Log.warning(
						"guardRouter.guards: global leave guards are not supported, skipping",
						undefined,
						LOG_COMPONENT,
					);
					continue;
				}
				for (const modulePath of modules) {
					if (typeof modulePath !== "string" || modulePath.length === 0) {
						Log.warning(
							"guardRouter.guards: invalid module path, skipping",
							JSON.stringify(modulePath),
							LOG_COMPONENT,
						);
						continue;
					}
					descriptors.push({
						route: routeKey,
						type: phase,
						modulePath: resolveGuardModulePath(modulePath, componentNamespace),
					});
				}
			}
		} else {
			Log.warning(
				"guardRouter.guards: invalid entry, skipping",
				JSON.stringify({ [routeKey]: value }),
				LOG_COMPONENT,
			);
		}
	}

	return descriptors;
}
```

Add field and constructor update:

```typescript
private _pendingGuardDescriptors: GuardDescriptor[] = [];
```

In constructor, after `this._options = normalizeGuardRouterOptions(guardRouter)`:

```typescript
if (isRecord(guardRouter) && guardRouter.guards !== undefined) {
	const ownerComponent = this.getOwnerComponent?.();
	const appId = ownerComponent?.getManifestEntry?.("sap.app")?.id as string | undefined;
	const componentNamespace = appId ? appId.replace(/\./g, "/") : "";
	this._pendingGuardDescriptors = parseGuardDescriptors(guardRouter.guards, componentNamespace);
}
```

Add `initialize()` override:

```typescript
override initialize(): this {
	if (this._pendingGuardDescriptors.length === 0) {
		return super.initialize();
	}

	const descriptors = this._pendingGuardDescriptors;
	this._pendingGuardDescriptors = [];

	if (this._options.guardLoading === "lazy") {
		this._registerLazyGuards(descriptors);
		return super.initialize();
	}

	// "block" mode: load all modules, then initialize
	this._loadAndRegisterGuards(descriptors)
		.then(() => {
			super.initialize();
		})
		.catch((err: unknown) => {
			Log.error("guardRouter.guards: module loading failed, initializing without manifest guards", String(err), LOG_COMPONENT);
			super.initialize();
		});
	return this;
}

private _loadAndRegisterGuards(descriptors: GuardDescriptor[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const modulePaths = descriptors.map((d) => d.modulePath);
		sap.ui.require(modulePaths, (...modules: Function[]) => {
			for (let i = 0; i < descriptors.length; i++) {
				const descriptor = descriptors[i];
				const guardFn = modules[i];
				if (typeof guardFn !== "function") {
					Log.warning(
						`guardRouter.guards: module "${descriptor.modulePath}" did not export a function, skipping`,
						undefined,
						LOG_COMPONENT,
					);
					continue;
				}
				this._registerGuardFromDescriptor(descriptor, guardFn);
			}
			resolve();
		}, (err: Error) => {
			Log.error("guardRouter.guards: failed to load guard modules", String(err), LOG_COMPONENT);
			reject(err);
		});
	});
}

private _registerGuardFromDescriptor(descriptor: GuardDescriptor, guardFn: Function): void {
	if (descriptor.route === "*") {
		this.addGuard(guardFn as GuardFn);
	} else if (descriptor.type === "leave") {
		this.addLeaveGuard(descriptor.route, guardFn as LeaveGuardFn);
	} else {
		this.addRouteGuard(descriptor.route, guardFn as GuardFn);
	}
}

private _registerLazyGuards(descriptors: GuardDescriptor[]): void {
	for (const descriptor of descriptors) {
		const { modulePath } = descriptor;
		const lazyGuard = (context: GuardContext): GuardResult | PromiseLike<GuardResult> => {
			const cached = sap.ui.require(modulePath) as GuardFn | undefined;
			if (cached) return cached(context);
			return new Promise<GuardResult>((resolve, reject) => {
				sap.ui.require([modulePath], (fn: GuardFn) => {
					resolve(fn(context));
				}, reject);
			});
		};
		this._registerGuardFromDescriptor(descriptor, lazyGuard);
	}
}
```

Note: `sap.ui.require` is available via `@openui5/types` — no custom type declarations needed. Use it directly as the global `sap.ui.require()`. For module path resolution, follow UI5's `sap.ui.core.routing.Target._getEffectiveObjectName()` pattern: prepend the component namespace (from `sap.app.id`) with a dot separator, then convert all dots to slashes. Support `"module:"` prefix for explicit absolute paths that bypass namespace resolution.

Or access it via `sap.ui.require` directly since UI5 provides it as a global. Check how the codebase handles `sap.ui.require` — it may already be available via `@openui5/types`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:qunit`
Expected: PASS

- [ ] **Step 5: Write additional tests for block mode**

```typescript
QUnit.test("global guards via '*' key are registered", async function (assert: Assert) {
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
					"*": ["ui5/guard/router/qunit/fixtures/guards/blockGuard"],
				},
			},
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "global guard blocks all navigations");
});

QUnit.test("manifest guards run before imperatively registered guards", async function (assert: Assert) {
	const order: string[] = [];

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
					"*": ["ui5/guard/router/qunit/fixtures/guards/allowGuard"],
				},
			},
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	// Add imperative guard AFTER initialize — manifest guard was registered during initialize
	router.addGuard(() => {
		order.push("imperative");
		return true;
	});

	// Manifest guard is at index 0, imperative at index 1
	const globalGuards = Reflect.get(router, "_globalGuards") as GuardFn[];
	assert.strictEqual(globalGuards.length, 2, "both manifest and imperative guards registered");

	// Verify manifest guard is first in the array (runs first in pipeline)
	// The manifest guard is the allowGuard fixture, imperative is the one pushing to order[]
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(order.length, 1, "imperative guard ran");
	assert.strictEqual(order[0], "imperative", "imperative guard ran after manifest guard (which allowed silently)");
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:qunit`
Expected: PASS

- [ ] **Step 7: Commit**

```
git add packages/lib/src/Router.ts packages/lib/test/qunit/Router.qunit.ts
git commit -m "feat(router): add manifest guard loading with block mode and module resolution"
```

---

## Task 8: Lazy guard loading mode

**Files:**

- Modify: `packages/lib/test/qunit/Router.qunit.ts`

- [ ] **Step 1: Write test — lazy mode loads on first use**

```typescript
// ============================================================
// Module: Declarative manifest guards — lazy loading
// ============================================================
QUnit.module("Router - Declarative manifest guards (lazy loading)", {
	beforeEach: function () {
		initHashChanger();
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test("lazy guard loads module on first navigation and blocks", async function (assert: Assert) {
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
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Blocked, "lazy-loaded guard blocks navigation");
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm run test:qunit`
Expected: PASS (lazy loading was implemented in Task 7).

- [ ] **Step 3: Commit**

```
git add packages/lib/test/qunit/Router.qunit.ts
git commit -m "test(router): add lazy guard loading tests"
```

---

## Task 9: Manifest Component integration test

**Files:**

- Modify: `packages/lib/test/qunit/Router.qunit.ts`

- [ ] **Step 1: Write test — UIComponent creates router with manifest-provided options**

```typescript
// ============================================================
// Module: Manifest-driven router instantiation
// ============================================================
QUnit.module("Router - Manifest-driven instantiation");

QUnit.test("UIComponent creates router with manifest-provided guardRouter options", async function (assert: Assert) {
	const component = await Component.create({
		name: "ui5.guard.router.qunit.fixtures.manifest",
	});

	try {
		const manifestRouter = component.getRouter() as GuardRouter;
		const options = Reflect.get(manifestRouter, "_options") as Record<string, unknown>;
		assert.strictEqual(options.unknownRouteGuardRegistration, "ignore", "option read from manifest");
		assert.strictEqual(options.navToPreflight, "guard", "option read from manifest");
	} finally {
		component.destroy();
	}
});
```

Add import at top of test file:

```typescript
import Component from "sap/ui/core/Component";
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm run test:qunit`
Expected: PASS

- [ ] **Step 3: Commit**

```
git add packages/lib/test/qunit/Router.qunit.ts
git commit -m "test(router): add manifest-driven UIComponent integration test"
```

---

## Task 10: Guard context bag with manifest guards (inter-guard data passing)

**Files:**

- Modify: `packages/lib/test/qunit/Router.qunit.ts`

- [ ] **Step 1: Write test — manifest guards share bag across pipeline**

```typescript
QUnit.test("manifest guards share bag across pipeline (metaWriter → metaReader)", async function (assert: Assert) {
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
					"*": [
						"ui5/guard/router/qunit/fixtures/guards/bagWriterGuard",
						"ui5/guard/router/qunit/fixtures/guards/bagReaderGuard",
					],
				},
			},
		},
	);

	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Committed, "metaReader allowed because metaWriter set data");
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm run test:qunit`
Expected: PASS

- [ ] **Step 3: Commit**

```
git add packages/lib/test/qunit/Router.qunit.ts
git commit -m "test(router): verify inter-guard bag data passing with manifest guards"
```

---

## Task 11: Update destroy/stop for new fields

**Files:**

- Modify: `packages/lib/src/Router.ts`
- Modify: `packages/lib/test/qunit/Router.qunit.ts`

- [ ] **Step 1: Update `destroy()` and `stop()` to clear new fields**

In `destroy()`, add before `super.destroy()`:

```typescript
this._pendingGuardDescriptors = [];
```

- [ ] **Step 2: Write test — destroy cleans up pending descriptors**

```typescript
QUnit.test("destroy clears pending guard descriptors", function (assert: Assert) {
	router = createRouterWithOptions({
		guards: { "*": ["some/guard"] },
	});

	router.destroy();

	const pending = Reflect.get(router, "_pendingGuardDescriptors") as unknown[];
	assert.strictEqual(pending.length, 0, "pending descriptors cleared on destroy");
});
```

- [ ] **Step 3: Run tests to verify all pass**

Run: `npm run test:qunit`
Expected: PASS

- [ ] **Step 4: Commit**

```
git add packages/lib/src/Router.ts packages/lib/test/qunit/Router.qunit.ts
git commit -m "fix(router): clear pending guard descriptors on destroy"
```

---

## Task 12: Update README documentation

**Files:**

- Modify: `packages/lib/README.md`

- [ ] **Step 1: Add manifest configuration section to README**

Add a section after the existing guard API documentation covering:

- Manifest schema example
- Router options table
- Guards block format
- Guard module format example
- Guard loading strategies
- Guard context bag usage
- navTo options (skipGuards)

- [ ] **Step 2: Commit**

```
git add packages/lib/README.md
git commit -m "docs(readme): add manifest guard configuration documentation"
```

---

## Task 13: Full test suite validation

- [ ] **Step 1: Run full test suite**

Run: `npm run test:full`
Expected: All tests pass.

- [ ] **Step 2: Run type check**

Run: `cd packages/lib && npx tsc --noEmit -p tsconfig.test.json`
Expected: No errors.

- [ ] **Step 3: Run linter**

Run: `npm run check` (if available)
Expected: No lint errors.

- [ ] **Step 4: Final commit if any fixes needed**

Fix any issues and commit with appropriate message.
