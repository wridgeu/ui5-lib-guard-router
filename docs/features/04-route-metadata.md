# Feature: Route Metadata

> **Status**: Implemented (PR #61). Pattern-tree inheritance resolves metadata lazily and caches it (issue #62, [Feature 12](./12-lazy-resolution-error-handling.md)). See the [library README](../../packages/lib/README.md) for the API. `Router.ts` and `RouteMeta.ts` are the source of truth.

## Problem

Guard conditions were written imperatively, one guard per route:

```typescript
router.addRouteGuard("admin", () => (isLoggedIn() && hasRole("admin") ? true : "login"));
router.addRouteGuard("profile", () => (isLoggedIn() ? true : "login"));
router.addRouteGuard("settings", () => (isLoggedIn() ? true : "login"));
```

Most frameworks solve this with **route metadata** (Vue's `meta`, Angular's `data`): declarative annotations on routes that one guard reads.

```typescript
router.addGuard((ctx) => {
	if (ctx.toMeta.requiresAuth && !isLoggedIn()) return "login";
	if (ctx.toMeta.roles && !hasAnyRole(ctx.toMeta.roles as string[])) return "forbidden";
	return true;
});
```

## API

### Manifest

Default metadata lives in `sap.ui5.routing.config.guardRouter.routeMeta`, next to the other router options:

```json
{
	"sap.ui5": {
		"routing": {
			"config": {
				"guardRouter": {
					"routeMeta": {
						"admin": { "requiresAuth": true, "roles": ["admin"] },
						"profile": { "requiresAuth": true },
						"home": { "public": true }
					}
				}
			}
		}
	}
}
```

### Runtime

```typescript
// Replaces earlier runtime metadata of the route; its keys win over the manifest's
router.setRouteMeta(routeName: string, meta: Record<string, unknown>): GuardRouter;

// Manifest metadata with runtime metadata on top, frozen
router.getRouteMeta(routeName: string): Readonly<Record<string, unknown>>;
```

To add keys instead of replacing, spread the current value:

```typescript
router.setRouteMeta("betaFeature", { ...router.getRouteMeta("betaFeature"), enabled: true });
```

### Guard context

`GuardContext.toMeta` and `GuardContext.fromMeta` carry the resolved metadata of the target and the current route.

## Decisions

| Decision                    | Choice                                                                         | Reason                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Sources                     | Manifest defaults plus runtime values                                          | Manifest values are visible and auditable. Runtime values cover feature flags and user permissions known only after login.                |
| Manifest location           | `sap.ui5.routing.config.guardRouter.routeMeta`                                 | The proposal used a custom top-level `"ui5.guard.router"` section. Keeping it in the router config co-locates it with the router options. |
| Merge                       | Shallow; runtime keys win                                                      | Predictable. Nested objects are replaced, not merged.                                                                                     |
| `mergeRouteMeta()`          | Dropped                                                                        | The spread pattern above does the same with no extra API.                                                                                 |
| Result                      | Frozen object, cached until `setRouteMeta()` or `addRoute()`                   | Guards cannot mutate shared state, and repeated reads in one navigation cost nothing.                                                     |
| Unknown route               | `getRouteMeta()` warns and returns an empty object                             | See [Feature 12](./12-lazy-resolution-error-handling.md). `setRouteMeta()` follows the `unknownRouteRegistration` policy.                 |
| `guardRouter` block and UI5 | The router removes `guardRouter` from the config before `sap.m.routing.Router` | UI5 never sees the non-standard block.                                                                                                    |

## Trade-offs

- Two sources of truth (manifest and runtime) can confuse.
- UI5 tooling does not validate the `guardRouter` block.
- Shallow merge does not combine nested objects.
- Metadata is `Record<string, unknown>`: no compile-time safety.

## Compatibility

Additive API and context properties. Guards that do not read `toMeta`/`fromMeta` are unaffected.
