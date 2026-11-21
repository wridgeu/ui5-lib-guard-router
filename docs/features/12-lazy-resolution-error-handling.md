# Feature: Error Handling for Lazy Resolution

> **Status**: Implemented. Companion to [#62](https://github.com/wridgeu/ui5-lib-guard-router/issues/62) (lazy metadata and guard inheritance resolution with cache invalidation).

## Problem

Issue #62 defines lazy resolution with a cache for metadata and guard inheritance. It does not say what happens when a lookup misses: an unknown route, or a route with nothing to resolve. This record fixes that behavior.

## Prior art

Vue Router, React Router, TanStack Router, Angular Router and Ember Router were compared:

- **Unknown routes on read.** Vue and Angular return `{}` for a route without metadata, Ember `null`, React Router `undefined`. Named-route resolution in Vue and unmatched URLs in Angular, TanStack and Ember throw. Returning `{}` is the safest choice for guards that destructure the result.
- **Writing metadata at runtime.** None of them can: metadata is static route config. `setRouteMeta` on an unknown route exists here only because UI5 supports `addRoute()` at runtime. There is no precedent for its policy.
- **Configurable policy.** Only TanStack Router has one (`notFoundMode`), and it controls rendering only. The `ignore` / `warn` / `throw` policy is more granular.
- **Caching empty results.** None of them caches empty metadata; they recompute per resolution.
- **No guards.** All of them skip silently when a route has no guards.

## Metadata

### `getRouteMeta(routeName)` for an unknown route

When `this.getRoute(routeName)` is falsy and the name is not empty:

- Returns the shared empty frozen object.
- Logs `getRouteMeta: unknown route, returning empty metadata`, with the route name as details.
- Does not cache. Every call checks again and warns again.

`getRouteMeta("")` returns `{}` without a warning. The empty string is the route before the first navigation: it is `_currentRoute` then, and `_createGuardContext` passes it to build `fromMeta`.

Why not throw or return `undefined`: `getRouteMeta` feeds `context.toMeta` and `context.fromMeta`. Guards must be able to destructure the result without a try/catch. The warning still points at typos and premature calls.

### `getRouteMeta(routeName)` for a known route without metadata

No manifest, runtime or inherited metadata: returns the empty frozen object, without a warning. A route without metadata is normal.

The result is cached, like every resolved result (`RouteMetaStore` in `RouteMeta.ts`). The original spec said never to cache empty results; caching them avoids repeating the ancestor walk, and `setRouteMeta()` and `addRoute()` clear the cache, so the value never goes stale.

### `setRouteMeta(routeName, meta)` for an unknown route

`setRouteMeta` is a registration, like `addRouteGuard` and `addLeaveGuard`, so it follows the same `unknownRouteRegistration` option (default `"warn"`). The option was called `unknownRouteGuardRegistration` before it covered metadata.

| Policy     | Behavior                                                                 |
| ---------- | ------------------------------------------------------------------------ |
| `"ignore"` | Stores the metadata silently.                                            |
| `"warn"`   | Logs `setRouteMeta: unknown route, metadata stored anyway`, then stores. |
| `"throw"`  | Throws an `Error` synchronously. Nothing is stored.                      |

The empty route name `""` is not checked against the policy.

Storing for an unknown route lets an app set metadata before it calls `addRoute()`. `addRoute()` clears the cache, so the next `getRouteMeta` for that route or its descendants picks the stored metadata up.

### Invalid `meta`

`meta` must be a plain object (`isRecord`), as in manifest `routeMeta` parsing. Anything else (`null`, `"string"`, `42`) is ignored with `setRouteMeta: expected object, ignoring`.

`mergeRouteMeta` (proposed in [04](./04-route-metadata.md)) is not implemented. Use `router.setRouteMeta(name, { ...router.getRouteMeta(name), ...newMeta })`.

### Cache effects

- Stored (`"ignore"` / `"warn"`, or a known route): the cache is cleared.
- `"throw"` or invalid `meta`: nothing is stored, the cache stays.
- `getRouteMeta` for an unknown route: nothing is cached or cleared.

## Guards

The design planned a lazy guard resolver with its own cache. It was built differently: with `inheritance: "pattern-tree"`, `initialize()` expands each manifest guard descriptor to all descendant routes once (`expandToDescendants()` in `PatternTree.ts`), and `addRoute()` expands the descriptors for the new route (`expandForNewRoute()`). There is no guard cache, so the planned miss cases reduce to:

- **A route without inherited guards** has none registered. `_runRouteGuards()` returns `true` and navigation continues silently, as in every router surveyed.
- **A descriptor for a route that is never added** is handled at registration by `unknownRouteRegistration`. For a manifest guard, `"throw"` does not throw: `guardRouter.guards: failed to register "<modulePath>"` is logged, the guard is skipped and the router still starts. Expansion only reaches routes that exist, and UI5 matches no hash to a missing route, so the descriptor stays inert.

## Summary

| Scenario                                 | Result             | Warning                  | Cached            |
| ---------------------------------------- | ------------------ | ------------------------ | ----------------- |
| `getRouteMeta`, unknown route            | `{}`               | Yes, every call          | No                |
| `getRouteMeta`, known route, no metadata | `{}`               | No                       | Yes               |
| `setRouteMeta`, unknown route            | Per policy         | Per policy               | Cleared if stored |
| `setRouteMeta`, invalid `meta`           | Ignored            | Yes                      | Unchanged         |
| Route without inherited guards           | Navigation allowed | No                       | n/a               |
| Guard descriptor for a missing route     | Inert              | Registration-time policy | n/a               |

## Tests

`RouteMetadata.qunit.ts` and `Inheritance.qunit.ts` in `packages/lib/test/qunit/router/meta/` cover: an unknown route returns `{}` and warns; `getRouteMeta("")` and `setRouteMeta("")` skip the unknown-route handling; a route without metadata gets an empty frozen `toMeta`; the policies for an unknown route; a non-object `meta`; cache clearing on `setRouteMeta()` and `addRoute()`; metadata stored before `addRoute()`.
