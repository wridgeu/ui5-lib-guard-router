# Alternative 10: Route Metadata for Declarative Guard Configuration

## The Problem

Currently, guard conditions are defined **imperatively** in JavaScript:

```typescript
router.addRouteGuard("admin", (context) => {
	if (!isAdmin()) return "home";
	return true;
});
router.addRouteGuard("profile", (context) => {
	if (!isLoggedIn()) return "login";
	return true;
});
router.addRouteGuard("settings", (context) => {
	if (!isLoggedIn()) return "login";
	return true;
});
```

This is repetitive. Most frameworks solve this with **route metadata**: declaring guard requirements on the route definition, then writing one guard that checks the metadata.

### Framework Precedents

**Vue Router:**

```javascript
const routes = [
	{ path: "/admin", meta: { requiresAuth: true, roles: ["admin"] } },
	{ path: "/profile", meta: { requiresAuth: true } },
];
router.beforeEach((to) => {
	if (to.meta.requiresAuth && !isAuth()) return "/login";
	if (to.meta.roles && !hasRole(to.meta.roles)) return "/forbidden";
});
```

**Angular:**

```typescript
{ path: 'admin', data: { expectedRole: 'admin' }, canActivate: [RoleGuard] }
```

**Nuxt:**

```typescript
definePageMeta({ middleware: ["auth"], requiresAuth: true });
```

**TanStack Router:**

```typescript
beforeLoad: async ({ context }) => {
	// Context accumulated from parent routes
	if (!context.auth.isLoggedIn) throw redirect({ to: "/login" });
};
```

---

## Design Approaches for UI5

### Approach A: Custom Manifest Section (Recommended)

Store route metadata in a custom section of `manifest.json`, keyed by route name.

```json
{
	"sap.ui5": {
		"routing": {
			"routes": [
				{ "name": "home", "pattern": "", "target": "home" },
				{ "name": "admin", "pattern": "admin", "target": "admin" },
				{ "name": "profile", "pattern": "profile", "target": "profile" },
				{ "name": "login", "pattern": "login", "target": "login" }
			]
		}
	},
	"ui5.guard.router": {
		"routeMeta": {
			"admin": {
				"requiresAuth": true,
				"roles": ["admin"]
			},
			"profile": {
				"requiresAuth": true
			},
			"login": {
				"public": true
			}
		}
	}
}
```

#### Reading Metadata in Guards

```typescript
// In Component.ts
const router = this.getRouter() as RouterInstance;
const manifest = this.getManifestEntry("ui5.guard.router") as RouteMetaConfig;

// One guard handles all auth logic
router.addGuard((context) => {
	const meta = manifest.routeMeta?.[context.toRoute] || {};

	if (meta.requiresAuth && !isLoggedIn()) {
		return "login";
	}
	if (meta.roles && !hasAnyRole(meta.roles)) {
		return "forbidden";
	}
	return true;
});
```

#### Built-In Metadata Support

The router could provide a helper to read metadata:

```typescript
// Router method
getRouteMeta(routeName: string): Record<string, unknown> {
    const component = this.getOwnerComponent();
    const config = component.getManifestEntry("ui5.guard.router") as RouteMetaConfig;
    return config?.routeMeta?.[routeName] || {};
}

// In guard context
interface GuardContext {
    toRoute: string;
    toHash: string;
    toArguments: Record<string, string>;
    fromRoute: string;
    fromHash: string;
    toMeta: Record<string, unknown>;    // ← NEW
    fromMeta: Record<string, unknown>;  // ← NEW
}
```

#### Pros

- **Manifest-driven**: UI5 developers expect configuration in manifest.json
- **Declarative**: Route requirements visible in one place
- **Separation of concerns**: Metadata declares WHAT is required; guards implement HOW to check
- **No schema conflict**: Custom manifest sections are allowed (under custom namespaces)
- **Tooling-friendly**: Can be validated, documented, auto-completed

#### Cons

- **JSON limitations**: Can't express complex conditions (e.g., "requires auth OR is preview mode")
- **Static**: Metadata is defined at build time, not runtime
- **Custom section**: Not part of `sap.ui5/routing`, so no direct integration with UI5 tooling

---

### Approach B: Programmatic Route Metadata

Configure metadata in JavaScript, separate from manifest.json.

```typescript
// In Component.ts
const router = this.getRouter() as RouterInstance;

// Register metadata per route
router.setRouteMeta("admin", { requiresAuth: true, roles: ["admin"] });
router.setRouteMeta("profile", { requiresAuth: true });
router.setRouteMeta("login", { public: true });

// Single guard reads metadata
router.addGuard((context) => {
	const meta = router.getRouteMeta(context.toRoute);
	if (meta.requiresAuth && !isLoggedIn()) return "login";
	return true;
});
```

#### API

```typescript
interface RouterInstance {
	// ... existing methods ...

	/** Set metadata for a route */
	setRouteMeta(routeName: string, meta: Record<string, unknown>): RouterInstance;

	/** Get metadata for a route */
	getRouteMeta(routeName: string): Record<string, unknown>;

	/** Merge additional metadata into a route's existing metadata */
	mergeRouteMeta(routeName: string, meta: Record<string, unknown>): RouterInstance;
}
```

#### Pros

- **Dynamic**: Metadata can be set at runtime (e.g., based on user config or feature flags)
- **Type-safe**: With generics, metadata can be strongly typed
- **Simple**: No manifest changes needed
- **Flexible**: Can express complex conditions via runtime logic

#### Cons

- **Not declarative**: Requirements are spread across JavaScript code
- **Less discoverable**: No single place to see all route requirements
- **Duplicates work**: If routes are already in manifest, metadata is in a different place

---

### Approach C: Convention-Based Metadata via Route Config

Piggyback on existing manifest route properties that UI5 ignores.

UI5's route schema allows arbitrary properties in route definitions (they're simply ignored by the framework). However, the UI5 linter may flag unknown properties.

```json
{
	"sap.ui5": {
		"routing": {
			"routes": [
				{
					"name": "admin",
					"pattern": "admin",
					"target": "admin"
				}
			]
		}
	}
}
```

Since we can't add arbitrary properties to routes without risking linter warnings, this approach is **not recommended** for UI5.

#### Alternative: Use Route Name Conventions

```typescript
// Convention: routes starting with "auth." require authentication
router.addGuard((context) => {
	if (context.toRoute.startsWith("auth.") && !isLoggedIn()) {
		return "login";
	}
	return true;
});
```

#### Pros

- **Zero configuration**: No metadata to maintain
- **Simple**: Just follow a naming convention

#### Cons

- **Fragile**: Route names carry semantic meaning they shouldn't
- **Limited**: Can only express one dimension (prefix-based)
- **Unconventional**: Not how any other framework does it

---

### Approach D: Hybrid (Manifest + Programmatic Override)

Combine Approaches A and B: defaults in manifest, overrides in code.

```json
{
	"ui5.guard.router": {
		"routeMeta": {
			"admin": { "requiresAuth": true, "roles": ["admin"] },
			"profile": { "requiresAuth": true }
		}
	}
}
```

```typescript
// Runtime: override or extend manifest metadata
router.mergeRouteMeta("admin", { maintenanceMode: true });

// Guard reads merged result
router.addGuard((context) => {
	const meta = router.getRouteMeta(context.toRoute);
	// meta = { requiresAuth: true, roles: ["admin"], maintenanceMode: true }

	if (meta.maintenanceMode) return "maintenance";
	if (meta.requiresAuth && !isLoggedIn()) return "login";
	return true;
});
```

#### Implementation

```typescript
constructor(this: RouterInstance, ...args: unknown[]) {
    MobileRouter.prototype.constructor.apply(this, args);
    // ... existing init ...
    this._routeMeta = new Map<string, Record<string, unknown>>();
},

_getManifestRouteMeta(this: RouterInstance, routeName: string): Record<string, unknown> {
    try {
        const component = this._oOwner;  // Owner component
        if (!component) return {};
        const config = component.getManifestEntry("ui5.guard.router");
        return (config as any)?.routeMeta?.[routeName] || {};
    } catch {
        return {};
    }
},

getRouteMeta(this: RouterInstance, routeName: string): Record<string, unknown> {
    const manifestMeta = this._getManifestRouteMeta(routeName);
    const runtimeMeta = this._routeMeta.get(routeName) || {};
    return { ...manifestMeta, ...runtimeMeta };
},

setRouteMeta(this: RouterInstance, routeName: string, meta: Record<string, unknown>): RouterInstance {
    this._routeMeta.set(routeName, meta);
    return this;
},

mergeRouteMeta(this: RouterInstance, routeName: string, meta: Record<string, unknown>): RouterInstance {
    const existing = this._routeMeta.get(routeName) || {};
    this._routeMeta.set(routeName, { ...existing, ...meta });
    return this;
}
```

#### Exposing in GuardContext

```typescript
// Build context in parse()
const context: GuardContext = {
    toRoute,
    toHash: newHash,
    toArguments: ...,
    fromRoute: this._currentRoute,
    fromHash: this._currentHash ?? "",
    toMeta: this.getRouteMeta(toRoute),
    fromMeta: this.getRouteMeta(this._currentRoute),
};
```

#### Pros

- **Best of both worlds**: Declarative defaults + runtime flexibility
- **Feature flags**: Runtime metadata enables feature flag integration
- **Configuration inheritance**: Manifest provides base, code provides overrides
- **Familiar**: manifest.json for static config is idiomatic UI5

#### Cons

- **Two sources of truth**: Could be confusing which takes precedence
- **Complexity**: More code to maintain
- **Merge semantics**: Shallow merge may not be sufficient for nested objects

---

## Recommended Approach

**Approach D (Hybrid)** provides the best balance:

1. **Manifest metadata** for static, declarative route requirements (auth, roles)
2. **Runtime metadata** for dynamic conditions (feature flags, maintenance mode)
3. **GuardContext integration** so guards can read metadata without external lookups

### Type Safety

```typescript
// Optional: typed metadata
interface RouteMeta {
	requiresAuth?: boolean;
	roles?: string[];
	public?: boolean;
	[key: string]: unknown; // extensible
}

// Type-safe context
interface GuardContext {
	// ... existing fields ...
	toMeta: RouteMeta;
	fromMeta: RouteMeta;
}
```

### Migration Path

This is fully backward-compatible:

- Existing guards that don't use `toMeta` / `fromMeta` continue to work
- The manifest section is optional
- `getRouteMeta()` returns `{}` for routes without metadata

## Real-World Example

```json
{
	"ui5.guard.router": {
		"routeMeta": {
			"home": { "public": true },
			"login": { "public": true },
			"dashboard": { "requiresAuth": true },
			"admin": { "requiresAuth": true, "roles": ["admin", "superadmin"] },
			"reports": { "requiresAuth": true, "roles": ["admin", "analyst"] },
			"userProfile": { "requiresAuth": true }
		}
	}
}
```

```typescript
// One guard to rule them all
router.addGuard((context) => {
	const meta = context.toMeta;

	// Public routes -- always allow
	if (meta.public) return true;

	// Auth required -- redirect to login
	if (meta.requiresAuth && !authModel.getProperty("/isLoggedIn")) {
		return "login";
	}

	// Role check -- redirect to forbidden
	if (meta.roles) {
		const userRoles = authModel.getProperty("/roles") as string[];
		if (!meta.roles.some((r: string) => userRoles.includes(r))) {
			return "forbidden";
		}
	}

	return true;
});
```

## References

- [Vue Router Route Meta Fields](https://router.vuejs.org/guide/advanced/meta.html)
- [Angular Route Data](https://angular.io/api/router/Route#data)
- [Nuxt definePageMeta](https://nuxt.com/docs/api/utils/define-page-meta)
- [TanStack Router Route Context](https://tanstack.com/router/v1/docs/framework/react/guide/route-context)
