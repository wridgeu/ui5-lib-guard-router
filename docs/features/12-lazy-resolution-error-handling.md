# Feature: Error Handling for Lazy Resolution

> **Status**: Implemented. Companion to [#62](https://github.com/wridgeu/ui5-lib-guard-router/issues/62) (lazy metadata/guard inheritance resolution with cache invalidation).

## Problem

Issue #62 defines the lazy-resolution-with-cache pattern for metadata and guard inheritance but does not specify what happens in error scenarios — specifically when a cache miss occurs and the requested entry still does not exist after resolution.

This document specifies the error handling behavior for all cache-miss error paths in both phases of the lazy resolution design.

## How Other Routing Libraries Handle This

Before defining our approach, here is how popular routing libraries handle metadata access for non-existent routes and empty guard resolution:

| Behavior                                | Vue Router v4                                                    | React Router v6/v7                                                  | TanStack Router                                                                   | Angular Router                                            | Ember Router                                                     |
| --------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------- |
| **Get metadata for non-existent route** | Returns `{}`. Named route resolution throws `MATCHER_NOT_FOUND`. | `matchRoutes()` returns `null`. `handle` is `undefined` if not set. | Throws `notFound()` error, renders `notFoundComponent`.                           | Throws `RuntimeError` (`NO_MATCH`), navigation cancelled. | Throws `UnrecognizedURLError`, error bubbles up route hierarchy. |
| **Set metadata on non-existent route**  | N/A — `meta` is static config only.                              | N/A — `handle` is static config only.                               | N/A — context set at config time only.                                            | N/A — `data` is static config only.                       | N/A — metadata is a Route class hook.                            |
| **Cache empty/missing metadata**        | No. Recomputed per `resolve()` call.                             | No. `matchRoutes` is a pure function.                               | Not-found results are not cached (loader data has separate `staleTime`/`gcTime`). | No. `ActivatedRoute.data` is not cached separately.       | No. `buildRouteInfoMetadata` is called fresh per transition.     |
| **Configurable error policy**           | No. Fixed behavior (path: silent empty; named: throw).           | No. `matchRoutes` always returns `null`.                            | **Yes.** `notFoundMode: 'fuzzy' or 'root'` controls rendering.                    | No. Unmatched routes throw.                               | No. Unrecognized URLs trigger error events.                      |
| **Guard/middleware with no guards**     | Silently skipped. Only guards that exist run.                    | Silently skipped. Middleware only runs if a `loader` exists.        | Silently skipped. Context inheritance still flows.                                | Silently skipped. Zero guards = pass all checks.          | Silently skipped. Transition continues normally.                 |

**Key takeaways:**

1. **No library caches empty metadata results.** Our "never cache empty" principle aligns with industry practice.
2. **No library offers a runtime API to set metadata on non-existent routes.** Our `setRouteMeta` for unknown routes is a unique capability (driven by dynamic `addRoute()` support), so the configurable policy is a reasonable safety net without precedent to copy from.
3. **Only TanStack Router has a configurable error policy** for unknown routes. Our policy pattern (`ignore`/`warn`/`throw`) is more granular than TanStack's rendering-only config.
4. **Default metadata values:** Vue Router and Angular return `{}`, Ember returns `null`, React Router gives `undefined`. Our `{}` return aligns with the Vue/Angular approach — the safest for guard destructuring.
5. **Guard skip behavior is universal.** All libraries silently skip guards that aren't defined. Our silent-allow for empty descriptor lists matches this consensus.

## Phase 1: Metadata Error Handling

> **Note**: this section describes **proposed changes** to the current `getRouteMeta` and `setRouteMeta` behavior. Currently, `getRouteMeta` does not check whether the route exists — it simply returns `_EMPTY_META` when neither manifest nor runtime metadata is found. `setRouteMeta` stores unconditionally without validation. The changes below add unknown-route detection and policy enforcement.

### `getRouteMeta(routeName)` — unknown route

When `getRouteMeta` is called with a route name that does not exist (i.e., `this.getRoute(routeName)` returns falsy):

- **Return value**: empty frozen object (`{}`).
- **Warning**: log a warning: `getRouteMeta: unknown route "<routeName>", returning empty metadata`.
- **Caching**: do **not** cache the empty result. The next call for the same unknown route will re-evaluate and warn again.

**Empty string is a valid route name**: `getRouteMeta("")` must return `{}` **without** warning. The empty string represents the root/initial state before any route has matched. It is used as `_currentRoute` before the first navigation and passed to `_createGuardContext` to populate `fromMeta`. The unknown-route warning must only fire for non-empty route names that don't resolve via `this.getRoute()`.

The unknown-route check uses `this.getRoute(routeName)` and is independent of the ancestor-chain metadata walk. A route that exists but has no metadata in its ancestor chain is a separate case (see below).

**Rationale**: `getRouteMeta` is a read operation that feeds `context.toMeta` and `context.fromMeta` during navigation. Guards must be able to safely destructure the result without try/catch. Throwing or returning `undefined` would force defensive code in every guard. The warning gives developers a signal for typos or premature calls without breaking the navigation flow. This matches Vue Router and Angular's approach of returning `{}` for routes without metadata.

### `getRouteMeta(routeName)` — route exists, no metadata in ancestor chain

When the route exists but the ancestor walk finds no metadata (no manifest metadata, no runtime metadata, no inherited metadata from ancestors):

- **Return value**: empty frozen object (`{}`).
- **Warning**: none. A route with no metadata is a normal, expected case.
- **Caching**: do **not** cache the empty result. For apps with deep route hierarchies, this means the ancestor walk re-executes on every call. This is acceptable because apps typically have 10-30 routes and 2-4 levels of depth (as noted in #62), making the walk trivial. Subtree caching is an optimization for later if profiling shows a need.

### `setRouteMeta(routeName, meta)` — unknown route

When `setRouteMeta` is called with a route name that does not exist:

- **Behavior**: follow the `unknownRouteRegistration` policy (new configuration option).
- **Policy values**: `"ignore"` | `"warn"` | `"throw"` — same semantics as `unknownRouteRegistration`.
- **Default**: `"warn"`.

| Policy     | Behavior                                                                           |
| ---------- | ---------------------------------------------------------------------------------- |
| `"ignore"` | Store the metadata silently. No warning logged.                                    |
| `"warn"`   | Log a warning (`setRouteMeta: unknown route, metadata stored anyway`), then store. |
| `"throw"`  | Throw an `Error` synchronously. Metadata is not stored.                            |

**Rationale**: `setRouteMeta` is a write/registration operation, same category as `addRouteGuard` / `addLeaveGuard`. The policy pattern is already established for guard registration (`unknownRouteRegistration`). Metadata registration deserves the same configurability because developers may intentionally set metadata before calling `addRoute()` (dynamic routes) or may have a typo that should be caught early.

**Pre-registered metadata for dynamic routes**: when `setRouteMeta` stores metadata for a not-yet-added route (via `"ignore"` or `"warn"` policy), and that route is later added via `addRoute()` (inherited from UI5's base `Router`), the stored metadata participates in lazy resolution normally. The `addRoute()` call invalidates the cache (as specified in #62), and the next `getRouteMeta` for that route or its descendants will pick up the pre-registered metadata during the ancestor walk.

### Input validation for `meta` argument

`setRouteMeta` should validate that the `meta` argument is a plain object (via `isRecord`). Non-object values (e.g., `null`, `"string"`, `42`) are ignored with a warning:

```
setRouteMeta: expected object, ignoring
```

This is consistent with manifest `routeMeta` parsing (which validates entries with `isRecord`) and with guard registration (which validates `typeof guard !== "function"`).

> **Note**: `mergeRouteMeta` (proposed in `04-route-metadata.md`) is **not implemented**. Consumers can trivially achieve the same with `router.setRouteMeta(name, { ...router.getRouteMeta(name), ...newMeta })`.

### Configuration

The existing `unknownRouteRegistration` policy covers both guard and metadata registration against unknown route names. No additional configuration option is needed -- `setRouteMeta()` reuses the same `"ignore" | "warn" | "throw"` policy that `addRouteGuard()` and `addLeaveGuard()` use.

### Cache invalidation on error paths

- `setRouteMeta` with `"ignore"` or `"warn"` policy: metadata is stored, cache is invalidated (same as the happy path described in #62).
- `setRouteMeta` with `"throw"` policy: metadata is **not** stored, cache is **not** invalidated.
- `setRouteMeta` with invalid `meta` argument: metadata is **not** stored, cache is **not** invalidated.
- `getRouteMeta` for an unknown route: no caching, no invalidation.

## Phase 2: Guard Error Handling

### Pipeline cache miss — ancestor walk finds zero descriptors

When the pipeline resolves inherited guards for a route and the ancestor walk produces an empty descriptor list:

- **Behavior**: return the empty list. Navigation is allowed silently.
- **Warning**: none. A route with no inherited guards is a normal, expected case.
- **Caching**: do **not** cache the empty result.

**Rationale**: the pipeline is an internal mechanism — developers never directly request "give me the guard descriptors for route X." The pipeline silently finding nothing and allowing navigation is the correct behavior. This is consistent with the current behavior where `_runRouteGuards` returns `true` when no guards are registered, and matches every other routing library surveyed (all silently skip when no guards exist).

### Stale guard descriptors (route never added)

When a guard descriptor references a route name that never gets added to the router:

- **No special handling needed.** The registration-time policy (`unknownRouteRegistration`) is sufficient.
- The ancestor walk goes upward from the navigation target. A descriptor pointing at a non-existent route is never reached by any ancestor walk — it sits inert in the descriptor registry.
- If someone navigates to a non-existent route, UI5's own router fails to match the route pattern before the guard pipeline is ever consulted.

## Summary

| Scenario                                   | Return             | Warning                  | Cache            |
| ------------------------------------------ | ------------------ | ------------------------ | ---------------- |
| `getRouteMeta` — unknown route             | `{}`               | Yes (always)             | No               |
| `getRouteMeta` — route exists, no metadata | `{}`               | No                       | No               |
| `setRouteMeta` — unknown route             | Policy-dependent   | Policy-dependent         | Policy-dependent |
| `setRouteMeta` — invalid `meta` arg        | No-op              | Yes (always)             | No               |
| Guard pipeline — no inherited descriptors  | Empty list (allow) | No                       | No               |
| Guard descriptor — route never added       | N/A (inert)        | Registration-time policy | N/A              |

## Shared Design Principle

**Never cache empty results.** Only cache when there is actual resolved data. Empty results are either error states (unknown route) or normal no-data states (no metadata/guards configured). In both cases, caching would either mask a persistent error or waste cache entries for routes that genuinely have nothing to resolve. This aligns with how every surveyed routing library handles metadata: none cache empty or missing results.

## Impact on Existing Plans

- **`04-route-metadata.plan.md` Task 1**: Done. The unified `unknownRouteRegistration` option (renamed from `unknownRouteGuardRegistration`) covers both guard and metadata registration. No separate option is needed.
- **`04-route-metadata.plan.md` Task 3**: Done. `getRouteMeta` logs a warning for unknown routes. `setRouteMeta` checks the `unknownRouteRegistration` policy before storing.
- **`Router.ts` internals**: Done. `normalizeGuardRouterOptions`, `ResolvedGuardRouterOptions`, and `DEFAULT_OPTIONS` use the unified `unknownRouteRegistration` option. The `_handleUnknownRouteRegistration` method is generalized to accept a caller label.
- **`Router.ts` implementation**: Done. `getRouteMeta` checks `this.getRoute()` with an empty-string carve-out. `setRouteMeta` delegates to the unified `_handleUnknownRouteRegistration` method.
- **`packages/lib/README.md`**: Done. The options table documents `unknownRouteRegistration` and the unified `inheritance` option.
- **Issue #62 Phase 1**: Done. The lazy resolver skips caching on empty results and logs a warning for unknown routes.
- **Issue #62 Phase 2**: Done. The guard lazy resolver skips caching on empty descriptor lists.

## Test Cases

1. `getRouteMeta` for unknown route returns `{}` and logs warning
2. `getRouteMeta` for unknown route re-warns on subsequent calls (not cached)
3. `getRouteMeta("")` returns `{}` without warning (empty string is a valid root route name)
4. `getRouteMeta` for known route with no metadata returns `{}` without warning
5. `getRouteMeta` for known route with no metadata returns `{}` on subsequent calls (result is not stale after `setRouteMeta` on an ancestor)
6. `setRouteMeta` for unknown route with `"warn"` policy: stores metadata, logs warning
7. `setRouteMeta` for unknown route with `"throw"` policy: throws, does not store
8. `setRouteMeta` for unknown route with `"ignore"` policy: stores silently
9. `setRouteMeta` with non-object `meta` argument: ignored with warning
10. `setRouteMeta` for known route invalidates cache (subsequent `getRouteMeta` re-resolves)
11. Pre-registered metadata picked up after `addRoute()` adds the route
12. Guard pipeline cache miss with no inherited descriptors: navigation allowed
