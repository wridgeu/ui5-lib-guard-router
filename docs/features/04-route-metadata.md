# Feature: Route Metadata

## Problem

Guard conditions are currently defined imperatively in JavaScript. For common patterns like "this route requires authentication" or "this route requires admin role", developers write repetitive guard logic:

```typescript
// Current: repetitive per-route guards
router.addRouteGuard("admin", (ctx) => (isLoggedIn() && hasRole("admin") ? true : "login"));
router.addRouteGuard("profile", (ctx) => (isLoggedIn() ? true : "login"));
router.addRouteGuard("settings", (ctx) => (isLoggedIn() ? true : "login"));
router.addRouteGuard("dashboard", (ctx) => (isLoggedIn() && hasRole("admin") ? true : "login"));
```

Most frameworks solve this with **route metadata**, declarative annotations on route definitions that a single guard function reads:

```typescript
// Desired: one guard, metadata-driven
router.addGuard((ctx) => {
	if (ctx.toMeta.requiresAuth && !isLoggedIn()) return "login";
	if (ctx.toMeta.roles && !hasAnyRole(ctx.toMeta.roles)) return "forbidden";
	return true;
});
```

## Proposed API: Hybrid (Manifest + Programmatic)

### Manifest Configuration

Store default metadata in `manifest.json` under a custom section:

```json
{
	"ui5.guard.router": {
		"routeMeta": {
			"admin": {
				"requiresAuth": true,
				"roles": ["admin"]
			},
			"profile": {
				"requiresAuth": true
			},
			"settings": {
				"requiresAuth": true
			},
			"home": {
				"public": true
			}
		}
	}
}
```

### Programmatic API

```typescript
// Set metadata for a route (overwrites manifest defaults)
router.setRouteMeta(routeName: string, meta: Record<string, unknown>): RouterInstance;

// Get metadata for a route (merged: manifest defaults + runtime overrides)
router.getRouteMeta(routeName: string): Record<string, unknown>;

// Merge additional metadata into existing (shallow merge)
router.mergeRouteMeta(routeName: string, meta: Record<string, unknown>): RouterInstance;
```

### GuardContext Integration

```typescript
interface GuardContext {
	// ... existing fields ...
	toMeta: Record<string, unknown>; // Metadata for target route
	fromMeta: Record<string, unknown>; // Metadata for current route
}
```

## Usage Examples

### Auth + Role Guard (One Guard for All)

```typescript
router.addGuard((context) => {
	const meta = context.toMeta;

	// Public routes always pass
	if (meta.public) return true;

	// Auth check
	if (meta.requiresAuth && !authModel.getProperty("/isLoggedIn")) {
		authModel.setProperty("/pendingTransition", context.transition);
		return "login";
	}

	// Role check
	if (meta.roles && !hasAnyRole(meta.roles as string[])) {
		return "forbidden";
	}

	return true;
});
```

### Runtime Feature Flags

```typescript
// Enable a feature at runtime
router.mergeRouteMeta("betaFeature", { enabled: true });

// Guard checks
router.addGuard((context) => {
	if (context.toMeta.featureFlag && !context.toMeta.enabled) {
		return "featureDisabled";
	}
	return true;
});
```

### Dynamic Metadata Based on User

```typescript
// After login, mark routes based on user's permissions
userPermissions.forEach((perm) => {
	router.mergeRouteMeta(perm.route, { authorized: true });
});
```

## Implementation Sketch

### Manifest Reading

```typescript
// In constructor or initialize
_initRouteMeta(this: RouterInstance): void {
    const component = this._oOwner;  // Component that owns the router
    if (!component) return;

    const manifest = component.getManifest();
    const extSection = manifest["ui5.guard.router"];
    if (extSection?.routeMeta) {
        this._manifestMeta = new Map(Object.entries(extSection.routeMeta));
    }
}
```

### Merged Metadata Resolution

```typescript
getRouteMeta(this: RouterInstance, routeName: string): Record<string, unknown> {
    const manifestMeta = this._manifestMeta.get(routeName) || {};
    const runtimeMeta = this._runtimeMeta.get(routeName) || {};
    return { ...manifestMeta, ...runtimeMeta };  // Runtime wins
}
```

### Context Building

```typescript
// In parse(), when building GuardContext:
const context: GuardContext = {
    toRoute,
    toHash: newHash,
    toArguments: routeInfo ? routeInfo.arguments : {},
    fromRoute: this._currentRoute,
    fromHash: this._currentHash ?? "",
    toMeta: this.getRouteMeta(toRoute),
    fromMeta: this.getRouteMeta(this._currentRoute),
    transition: this._createNavigationIntent(...)
};
```

## Types

```typescript
// RouterInstance additions
_manifestMeta: Map<string, Record<string, unknown>>;
_runtimeMeta: Map<string, Record<string, unknown>>;
setRouteMeta(routeName: string, meta: Record<string, unknown>): RouterInstance;
getRouteMeta(routeName: string): Record<string, unknown>;
mergeRouteMeta(routeName: string, meta: Record<string, unknown>): RouterInstance;

// Updated GuardContext
interface GuardContext {
    toRoute: string;
    toHash: string;
    toArguments: Record<string, string>;
    fromRoute: string;
    fromHash: string;
    toMeta: Record<string, unknown>;
    fromMeta: Record<string, unknown>;
    transition: NavigationIntent;
}
```

## Test Cases

1. `getRouteMeta` returns manifest-defined metadata
2. `setRouteMeta` overrides manifest metadata
3. `mergeRouteMeta` shallow-merges with existing metadata
4. `getRouteMeta` returns empty object for unknown routes
5. `context.toMeta` reflects merged metadata in guard
6. `context.fromMeta` reflects current route metadata
7. Runtime metadata changes are reflected in subsequent navigations
8. Manifest metadata loads from `ui5.guard.router` section
9. Guard uses `toMeta.requiresAuth` to block/redirect

## Trade-offs

**Pros:**

- Reduces guard boilerplate dramatically
- Declarative defaults in manifest (visible, auditable)
- Runtime overrides for dynamic scenarios (feature flags, user permissions)
- Familiar pattern (Vue's `meta`, Angular's `data`)

**Cons:**

- Two sources of truth (manifest + runtime), which could be confusing
- Manifest section (`ui5.guard.router`) is non-standard; UI5 tooling won't validate it
- Shallow merge may not handle nested objects well
- Metadata is untyped (`Record<string, unknown>`), with no compile-time safety

## Priority

**Lower priority** than Features 01-03. The current API already supports metadata-driven patterns; developers can read manifest data directly in their guards. This feature is a convenience layer that reduces boilerplate but doesn't enable new capabilities.

## Compatibility

- Fully backward compatible (additive API and context properties)
- Manifest section is ignored by UI5 framework (custom namespace)
- Guards that don't read `toMeta`/`fromMeta` are unaffected
