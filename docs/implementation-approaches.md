# Implementation Approaches

## Approaches Considered

### 1. Event-Based Guard (Extend `beforeRouteMatched`)

**Idea**: Attach to the existing `beforeRouteMatched` event and add a `preventDefault()` mechanism.

**Pros**:
- Aligns with UI5's event system patterns
- No method overrides needed

**Cons**:
- `beforeRouteMatched` fires **after** internal route matching has already occurred. The target is about to be displayed. Preventing at this stage requires undoing work the router already started (view creation may have begun).
- The event is synchronous - no async guard support without fundamentally changing the event system.
- Cannot cleanly prevent history entry creation since the hash has already changed.

**Verdict**: Rejected. Too late in the lifecycle; cannot prevent the view flash.

### 2. Override `navTo()` Only

**Idea**: Override `navTo()` to run guards before triggering navigation.

**Pros**:
- Simple, clear interception point for programmatic navigation
- Guards run before any hash change

**Cons**:
- Does **not** catch browser back/forward button navigation
- Does **not** catch direct URL/hash changes (user typing in address bar)
- Would need additional HashChanger listeners to cover all entry points, creating complexity and potential race conditions

**Verdict**: Rejected. Incomplete coverage of navigation entry points.

### 3. Override `parse()` (Chosen Approach)

**Idea**: Override `parse(sNewHash)`, the single method through which all navigation flows.

**Pros**:
- **Complete coverage**: Every navigation path (programmatic `navTo`, browser back/forward, URL bar changes) flows through `parse()`. One override catches everything.
- **Earliest possible interception**: Guards run before route matching, target loading, view creation, and event firing. No flash, no unnecessary work.
- **Clean blocking**: When a guard blocks, we simply don't call `super.parse()`. The framework never begins processing. We restore the previous hash via `replaceHash()`.
- **Minimal surface**: Single method override. Less code, fewer bugs, easier to maintain.
- **Async-friendly**: Synchronous guards execute in the same tick as the hash change. Async guards are supported via a deferred path with a generation counter to handle concurrent navigations.

**Cons**:
- `parse()` is not a public/documented-stable API. In theory, a future UI5 version could rename or refactor it. In practice, it has been stable since the router's inception and is fundamental to how `HashChanger` integration works.
- Need to manually determine which route matches the hash (using `Route#match()`) to build guard context and run per-route guards.

**Verdict**: **Chosen**. Best coverage, earliest interception, minimal code.

### 4. Custom HashChanger Wrapper

**Idea**: Wrap or replace the `HashChanger` instance to intercept hash changes before they reach the router.

**Pros**:
- Intercepts at the absolute earliest point
- No router method overrides

**Cons**:
- HashChanger is a singleton shared across all routers. Wrapping it affects the entire application.
- Complex lifecycle management (when to wrap, when to unwrap).
- Breaks if multiple routers exist (nested components, component reuse).
- Tight coupling to HashChanger internals which have changed across versions.

**Verdict**: Rejected. Too invasive, too fragile with multiple components.

### 5. Middleware/Plugin Pattern

**Idea**: Create a standalone plugin that attaches to any router instance, without subclassing.

**Pros**:
- No subclassing required
- Could work with any router implementation

**Cons**:
- Still needs to hook into `parse()` or `navTo()` via monkey-patching, which is worse than a clean override.
- No type-safe integration with the router class.
- Harder to discover and configure.

**Verdict**: Rejected. Monkey-patching is worse than clean inheritance.

## Chosen Approach: Override `parse()`

### How It Works

```
Hash Change (any source)
  │
  ▼
parse(sNewHash)  ← OVERRIDDEN
  │
  ├─ 1. Match route: iterate routes, call route.match(sNewHash)
  ├─ 2. Build GuardContext { toRoute, toHash, toArguments, fromRoute, fromHash }
  ├─ 3. Run global guards (sequential, await each)
  │     → false: block, replaceHash to previous
  │     → string: redirect via navTo(result, {}, {}, true)
  ├─ 4. Run route-specific guards (same logic)
  └─ 5. All passed → super.parse(sNewHash)
```

### Why `sap.m.routing.Router`

We extend `sap.m.routing.Router` rather than `sap.ui.core.routing.Router` because:

- ~99% of UI5 apps use `sap.m` controls with `NavContainer` / `SplitApp`
- `sap.m.routing.Router` adds `TargetHandler` for animated view transitions
- Extending it preserves all mobile navigation behavior
- Apps swap in via `"routerClass": "ui5.ext.routing.Router"` in manifest.json

### Minimum UI5 Version

**1.75.0** required for `getHashChanger()` on the Router instance. A fallback using `HashChanger.getInstance()` could lower this to 1.58.0, but 1.75 is already 5+ years old and the per-router hash changer is architecturally cleaner.

### Migration Path

If UI5 natively implements route guards (CPOUI5FRAMEWORK-338), migration is straightforward:

1. Remove guard registrations from `Component.ts`
2. Change `routerClass` back to `sap.m.routing.Router` in manifest.json
3. Register equivalent guards using the native API

No application logic changes needed beyond the guard definitions themselves.
