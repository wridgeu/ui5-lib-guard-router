# Analysis: Fully Async Router Rewrite

## Context: OpenUI5 Issue #3411

The UI5 team has been trying to solve navigation interception since December 2021
([SAP/openui5#3411](https://github.com/SAP/openui5/issues/3411), backlog item CPOUI5FRAMEWORK-338).
The issue is still open and labeled "in progress" as of 2024.

### The UI5 Team's Dilemma

The team proposed adding `preventDefault()` support to `beforeRouteMatched`:

```js
this.getRouter().attachBeforeRouteMatched(function (oEvent) {
	if (!this.hasAccess()) {
		oEvent.preventDefault();
	}
});
```

But they immediately acknowledged the problem: **this can only be synchronous**:

> The downside of this solution is that the `hasAccess` method has to return synchronously.
> You can not perform any async backend calls here because the response of the backend call
> would come later than the navigation process.
>
> _@flovogt, UI5 team_

A year later (Sept 2022), the team explicitly stated:

> Currently, the team does a great job of eliminating synchronous tasks in the framework
> and offering asynchronous options. Introducing a new synchronous concept fits not really
> in this work stream, so **the team is still looking for a way to make this concept
> asynchronous directly from the start**.
>
> _@flovogt, UI5 team_

As of October 2024, no solution has been implemented. The community workarounds include:

- Checking permissions before `navTo()` (doesn't cover URL bar / deep links)
- Checking in `onInit` / `attachPatternMatched` (view loads and flashes before redirect)
- Monkey-patching `HashChanger` or `CrossApplicationNavigation` (fragile, bad practice)
- Hard redirect via `URLHelper.redirect()` (full page reload, loses state)

### What This Library Already Solves

Our `parse()` override is the exact solution the UI5 team has been looking for:

| UI5 Team's Requirements                   | Our Library's Answer                                   |
| ----------------------------------------- | ------------------------------------------------------ |
| Must intercept **before** target loading  | `parse()` runs before `MobileRouter.prototype.parse()` |
| Must support async checks (backend calls) | Async guards with Promise return                       |
| Must not break the sync event model       | Sync-first: no overhead when guards are sync           |
| Must handle concurrent navigations        | Generation counter discards stale results              |
| Must not leave stale history entries      | `_restoreHash()` with `replaceHash`                    |
| Must work for all navigation sources      | `parse()` catches `navTo`, URL bar, back/forward       |

The `beforeRouteMatched` approach the UI5 team proposed is fundamentally flawed because it fires
**after** the hash has already changed and route matching has begun. Intercepting at `parse()` is
earlier, before any route matching, target loading, or event firing occurs.

## What "Fully Async Like TanStack" Would Actually Mean for UI5

### Current UI5 Flow (Half Sync, Half Async)

```
HashChanger.fireHashChanged()               ← SYNC: event fires
  → Router.parse(hash)                      ← SYNC: delegates to crossroads
    → crossroads._oRouter.parse(hash)       ← SYNC: regex matching
      → Route callback                      ← SYNC: matched route handler
        → Route._routeMatched()             ← SYNC: initiates everything
          → fireBeforeRouteMatched()        ← SYNC: event (can observe, can't prevent)
          → Targets._display()              ← ASYNC: returns Promise
            → Target._place()              ← ASYNC: view creation/loading
          → .then()                         ← ASYNC: after views loaded
            → fireRouteMatched()           ← ASYNC: event fires after views ready
            → fireRoutePatternMatched()    ← ASYNC: event fires after views ready
```

The **sync half** (hash change → route match → begin target loading) has no gap for async work.
The **async half** (target/view loading → post-load events) already uses Promises.

### TanStack's Fully Async Flow (For Comparison)

```
navigate()
  → commitLocation()                        ← ASYNC
    → history.push({ ignoreBlocker })       ← ASYNC: blocker check
  → load()                                  ← ASYNC
    → matchRoutes()                         ← sync (pattern matching)
    → loadMatches()                         ← ASYNC
      → route.beforeLoad()                  ← ASYNC: guards run here
      → route.loader()                      ← ASYNC: data fetching
    → resolve/commit                        ← ASYNC
    → notify subscribers                    ← ASYNC
```

Navigation is a **state machine**: `idle → pending → loading → committed → settled`.
Everything between `navigate()` and `committed` can be interrupted or replaced.

### Three Levels of "Making UI5 Async"

There's a spectrum. Each level includes the previous:

---

#### Level 1: Async Guard Hook (What Our Library Does Today)

**Scope**: Override `parse()` on a subclass, run guards before calling `super.parse()`.

```
HashChanger.fireHashChanged()
  → OUR Router.parse(hash)                  ← INTERCEPT
    → Run guards (sync-first, async fallback)
    → If allowed: MobileRouter.prototype.parse(hash)  ← resume normal flow
    → If blocked: _restoreHash()
```

**What changes in the framework**: Nothing. It's a subclass.

**What you get**: Async-capable guards before route matching. Sync guards have zero overhead.

**What you don't get**: No async in the route matching itself, no async between
`beforeRouteMatched` and target loading, no native framework support.

**Cost**: Already done. ~370 lines of library code.

---

#### Level 2: Native Async Guard Support in `sap.ui.core.routing.Router`

**Scope**: The UI5 framework adds a guard registry and makes `parse()` await guards before
delegating to crossroads. This is what the UI5 team has been trying to design since 2021
([#3411](https://github.com/SAP/openui5/issues/3411)).

```
HashChanger.fireHashChanged()
  → Router.parse(hash)
    → Router._runGuards(hash)               ← NEW: guard pipeline
      ├─ sync guards → immediate result
      └─ async guards → Promise
    → If allowed: crossroads._oRouter.parse(hash)  ← existing flow resumes
    → If blocked: restore hash
```

**What changes in the framework**:

| Module                 | Change                                                                        | Risk                             |
| ---------------------- | ----------------------------------------------------------------------------- | -------------------------------- |
| `Router.js`            | Add guard registry, modify `parse()` to support deferred `crossroads.parse()` | Medium (core flow but localized) |
| `Router.js`            | Add generation counter or AbortController for concurrent navigations          | Low (new internal state)         |
| `HashChanger.js`       | No change needed (parse is still called sync, just may defer internally)      | None                             |
| `Route.js`             | No change needed (only called after guards pass)                              | None                             |
| `Targets.js`           | No change needed (already async)                                              | None                             |
| OPA5 autowaiter        | Add awareness of `Router._navigationPending`                                  | Medium                           |
| `sap.m.routing.Router` | Inherit guard support                                                         | Low                              |
| `sap.f.routing.Router` | Inherit guard support, verify FCL interaction                                 | Medium                           |

**What you get**: Native guard support. Apps don't need a library. Works with all router
subclasses (sap.m, sap.f). Test tools can be updated to understand pending navigations.

**What you don't get**: Not a full pipeline like TanStack. No data loading phase, no
route-level middleware, no navigation state machine.

**Cost estimate**: ~500 lines of framework changes across 2-3 modules. The hard part is
not the code; it's the backward compatibility guarantee and test tool updates.

**Why the UI5 team hasn't done it**: The `parse()` → `crossroads.parse()` call is synchronous
and deeply entrenched. Inserting an async gap requires either:

- (a) Always deferring `crossroads.parse()` to a microtask (breaks sync contract), or
- (b) Using our library's dual-path approach (sync when possible, async when needed)

Option (b) is what our library proves works. The UI5 team may not have considered it because
the dual-path pattern is unusual, and most framework authors default to "just make it all async."

---

#### Level 3: Full TanStack-Style Async Pipeline

**Scope**: Rearchitect UI5 routing so the entire navigation is a managed async pipeline with
states, cancellation, and middleware phases.

```
Router.navTo("route", params)
  → Router._startNavigation(intent)         ← NEW: creates NavigationIntent
    → state: PENDING
    → Router._runLeaveGuards(intent)        ← NEW: async leave guards
    → Router._runEnterGuards(intent)        ← NEW: async enter guards
    → state: LOADING
    → Router._loadTargets(intent)           ← REPLACES: Targets._display()
    → Router._runResolvers(intent)          ← NEW: data loading phase
    → state: COMMITTING
    → Router._commitNavigation(intent)      ← UPDATE: hash + fire events
      → fireBeforeRouteMatched()
      → fireRouteMatched()
    → state: SETTLED
```

**What changes in the framework**:

| Module                 | Change                                                                                                           | Risk                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `Router.js`            | **Rewrite**: Replace `parse()` delegation with navigation state machine                                          | **Very High**                 |
| `Route.js`             | **Rewrite**: Replace `_routeMatched()` with phased pipeline                                                      | **Very High**                 |
| `Targets.js`           | Modify to accept deferred display from pipeline                                                                  | High                          |
| `Target.js`            | Add cancellation support (AbortSignal)                                                                           | Medium                        |
| `HashChanger.js`       | Decouple hash observation from route activation                                                                  | High                          |
| `sap.m.routing.Router` | **Rewrite** to new pipeline model                                                                                | High                          |
| `sap.f.routing.Router` | **Rewrite** FCL logic for async pipeline                                                                         | **Very High**                 |
| OPA5 autowaiter        | Rewrite routing waiter for state machine                                                                         | High                          |
| `sap.ushell`           | Adapt FLP routing integration                                                                                    | **Very High** (external team) |
| crossroads.js          | Replace or wrap (sync pattern matching is fine, but integration changes)                                         | Medium                        |
| Backward compat        | Every app using `attachBeforeRouteMatched`, `attachRouteMatched`, `attachRoutePatternMatched` needs verification | **Very High**                 |

**What you get**: Full modern router capabilities:

- Navigation state machine (pending/loading/committed/settled)
- Route-level middleware (beforeLoad, loader, like TanStack)
- Leave guards and enter guards as first-class concepts
- Data pre-fetching before view renders
- Cancellation via AbortSignal
- No view flash on guard rejection

**What you don't get that TanStack has** (and UI5 doesn't need):

- SSR support
- View transitions API
- Preloading on hover
- Type-safe route paths (TypeScript-first)

**Cost estimate**: 2000-5000 lines of framework changes across 8+ modules. Multi-quarter
project for the UI5 team. Would require a phased rollout with backward-compatible mode.

**Why the UI5 team will probably never do this**: The ROI doesn't justify it. UI5 apps are
predominantly enterprise CRUD with simple routing needs. TanStack's complexity is driven
by React's rendering model and modern web patterns (SSR, streaming, suspense) that don't
apply to UI5. The UI5 team is more likely to pursue Level 2, native guard support without
a full pipeline rewrite.

### Summary: Level Comparison

| Aspect             | Level 1 (Our Library) | Level 2 (Native Guards) | Level 3 (Full Pipeline)       |
| ------------------ | --------------------- | ----------------------- | ----------------------------- |
| Async guards       | Yes                   | Yes                     | Yes                           |
| Leave guards       | Feature 01            | Possible                | Yes                           |
| Data loading phase | No                    | No                      | Yes                           |
| Navigation states  | No                    | No                      | Yes (pending/loading/settled) |
| AbortSignal        | Feature (additive)    | Possible                | Yes                           |
| Framework changes  | None                  | 2-3 modules             | 8+ modules                    |
| Breaking changes   | None                  | Minimal                 | Significant                   |
| Timeline           | Done                  | Months                  | Quarters/Years                |
| Who does it        | Us                    | UI5 team                | UI5 team                      |
| Risk               | Low (subclass)        | Medium                  | Very High                     |

### Where Our Library Fits

Our library is a complete **Level 1** solution that proves **Level 2** is feasible.
The dual-path sync/async design is the key insight the UI5 team needs: you don't have to
make _everything_ async to support async guards. You just need to detect when a guard
returns a Promise and defer only in that case.

If the UI5 team adopted our approach for Level 2, the migration would be:

1. Replace `ui5.guard.router.Router` with native `sap.m.routing.Router`
2. Map `addGuard()` → native guard API
3. Map `addRouteGuard()` → native per-route guard API
4. Map `addLeaveGuard()` → native leave guard API (if supported)

Level 3 is unlikely and unnecessary. The proposed features (01-04) give us everything
we'd want from Level 3's guard/middleware capabilities without the framework rewrite.

## Current Architecture: Sync-First with Async Fallback

```
hashChanged → parse() → _runEnterGuards()
                          ├─ sync: _runGuards() → result in same tick
                          └─ async: _continueGuardsAsync() → result in microtask
                                    └─ generation check after each await
```

The dual-path approach:

1. **Sync fast path**: When all guards return non-Promise values, the entire guard evaluation +
   route activation happens in the same tick as the `hashChanged` event
2. **Async fallback**: When any guard returns a Promise, the pipeline switches to async mode
   with a generation counter for staleness detection

### Why This Is the Right Design

The sync-first approach is not a compromise; it's optimal:

- **Zero overhead without guards**: Direct call to `MobileRouter.prototype.parse()`
- **Same-tick for sync guards**: Framework sees navigation as complete within the event handler
- **Async when needed**: Backend permission checks, `MessageBox.confirm()` dialogs, etc.
- **Generation counter**: Lighter than per-match AbortControllers (TanStack's approach),
  sufficient for UI5's single-hash navigation model

### Dual-Path Complexity

The current code has three guard-running methods:

- `_runGuards()`: 14 lines
- `_continueGuardsAsync()`: 22 lines (unified for both leave and enter guards)
- `_runEnterGuards()`: 10 lines (coordinator)

Total: ~36 lines of dual-path logic. This is not a maintenance burden.

## What Would Going Fully Async Cost _Us_?

### Option A: Always-Async Pipeline

```typescript
parse(this: RouterInstance, newHash: string): void {
    // ... suppress/redirect/dedup checks (still sync) ...
    const generation = ++this._parseGeneration;
    const context = { /* ... */ };

    Promise.resolve()
        .then(() => this._runLeaveGuards(context))
        .then((r) => r !== true ? r : this._runGlobalGuards(context))
        .then((r) => r !== true ? r : this._runRouteGuards(toRoute, context))
        .then((result) => {
            if (generation !== this._parseGeneration) return;
            this._applyGuardResult(result, newHash, toRoute);
        })
        .catch((error) => {
            if (generation !== this._parseGeneration) return;
            this._restoreHash();
        });
}
```

**What we'd gain**: Simpler code (~25 lines vs ~36), single code path, easier to reason about

**What we'd lose**:

- **Zero-overhead fast path**: Every navigation pays a microtask delay, even with no guards
- **Test tool compatibility**: `waitForUI5()` breaks for _all_ navigations, not just async-guarded ones
- **Sync guard guarantee**: Code that depends on `navTo()` completing synchronously (e.g.,
  `navTo("home"); assert(getCurrentRoute() === "home")`) would break
- **Initial navigation timing**: App startup with `router.initialize()` would defer the first
  route match to a microtask

### Option B: Async-Internal, Sync-External

Keep `parse()` synchronous but unify the internal pipeline. Detect whether the result settled
synchronously.

**Problem**: `Promise.then()` is ALWAYS a microtask, even for already-resolved Promises. There is
no way to synchronously extract a value from a Promise in JavaScript. This approach fundamentally
doesn't work.

### Option C: Custom Sync/Async Result Wrapper

Create a custom type that can be either sync or async:

```typescript
type MaybeAsync<T> = T | Promise<T>;
```

This is essentially what the current code already does with the `isThenable()` check. The dual-path
is already the minimal implementation of this pattern.

### Cost Summary

| Change                     | Sync Fast Path | Test Tools | Code Simplicity    | Async Guards |
| -------------------------- | -------------- | ---------- | ------------------ | ------------ |
| Keep current (sync-first)  | Preserved      | Compatible | Good (~36 lines)   | Supported    |
| Always-async (Option A)    | **Lost**       | **Broken** | Better (~25 lines) | Supported    |
| Current + unified pipeline | Preserved      | Compatible | Good (~50 lines)   | Supported    |

**The cost of going fully async is high (broken tests, lost sync guarantee) for minimal gain
(~11 fewer lines of code). The dual-path is the correct trade-off.**

## What a Rewrite Could Improve (Without Going Fully Async)

### Unified Guard Pipeline

Instead of separate `_runEnterGuards`, `_runRouteGuards`, and `_runLeaveGuards`, create
a single pipeline concept:

```typescript
interface GuardPhase {
    name: string;
    guards: GuardFn[];
    context: GuardContext | LeaveGuardContext;
}

_buildPipeline(newHash, toRoute, routeInfo): GuardPhase[] {
    const phases: GuardPhase[] = [];

    // Phase 1: Leave guards
    if (this._currentRoute && this._leaveGuards.has(this._currentRoute)) {
        phases.push({
            name: "leave",
            guards: this._leaveGuards.get(this._currentRoute)!,
            context: leaveContext
        });
    }

    // Phase 2: Global enter guards
    if (this._globalGuards.length > 0) {
        phases.push({
            name: "global",
            guards: this._globalGuards,
            context: enterContext
        });
    }

    // Phase 3: Route-specific enter guards
    if (toRoute && this._enterGuards.has(toRoute)) {
        phases.push({
            name: "route",
            guards: this._enterGuards.get(toRoute)!,
            context: enterContext
        });
    }

    return phases;
}

_runPipeline(phases: GuardPhase[]): GuardResult | Promise<GuardResult> {
    for (const phase of phases) {
        const result = this._runGuards(phase.guards, phase.context);
        if (isThenable(result)) {
            return this._finishPipelineAsync(result, phases, currentPhaseIndex);
        }
        if (result !== true) return result;
    }
    return true;
}
```

**Benefit**: Adding new phases (e.g., "resolve" guards for data pre-loading) doesn't require
modifying `parse()` or the guard runner; just add a phase to `_buildPipeline()`.

### AbortSignal in Guard Context

For long-running async guards, pass an `AbortSignal` so guards can clean up when superseded:

```typescript
interface GuardContext {
	// ... existing ...
	signal: AbortSignal; // Aborted when navigation is superseded
}

// In parse():
this._currentAbortController?.abort();
this._currentAbortController = new AbortController();
const context = {
	// ...
	signal: this._currentAbortController.signal,
};

// In an async guard:
router.addGuard(async (context) => {
	const response = await fetch("/api/check-permission", {
		signal: context.signal, // Automatically cancelled if navigation superseded
	});
	return response.ok;
});
```

This is additive; guards that don't use `signal` are unaffected. The generation counter remains
the primary staleness mechanism; the signal is a convenience for guards that interact with
cancellable APIs.

### Navigation Lifecycle Events

Fire events at key points in the navigation lifecycle:

```typescript
router.fireEvent("beforeGuardEvaluation", { context });
router.fireEvent("navigationBlocked", { context, reason: "guard" | "leaveGuard" });
router.fireEvent("navigationRedirected", { context, redirectTo: "routeName" });
```

Useful for analytics, logging, and debugging. Could be added incrementally.

## Recommendation

**Do not rewrite to fully async.** The sync-first design is correct for UI5's architecture and
already solves the problem the UI5 team has been stuck on for 3+ years. Instead:

1. **Refactor to a unified pipeline** when implementing leave guards, as this simplifies adding
   new guard phases without the complexity or performance cost of going fully async
2. **Add `AbortSignal` to guard context** as a low-cost enhancement for async guards
3. **Keep the generation counter** as the primary staleness mechanism
4. **Consider lifecycle events** if observability becomes a need

### Positioning Relative to OpenUI5 #3411

This library is a working answer to the community's request. The `parse()` override approach:

- Was suggested by community members in the issue thread (Oct 2024)
- Works today without framework changes
- Supports both sync and async guards
- Handles all navigation sources (navTo, URL bar, back/forward)
- Doesn't require the multi-module framework changes the UI5 team would need

If the UI5 team ever implements native guard support, the migration path is straightforward:
replace `ui5.guard.router.Router` with the native `sap.m.routing.Router` and map guard
registrations to the new API.

## Comparison Table

| Aspect                   | Current (Sync-First) | Fully Async         | Unified Pipeline (Recommended) |
| ------------------------ | -------------------- | ------------------- | ------------------------------ |
| No-guard overhead        | Zero                 | Microtask delay     | Zero                           |
| Sync guard latency       | Same-tick            | Microtask delay     | Same-tick                      |
| Async guard latency      | Microtask            | Microtask           | Microtask                      |
| Test tool compat         | Full                 | Broken (waitForUI5) | Full                           |
| Code complexity          | Low (~36 lines)      | Lower (~25 lines)   | Medium (~50 lines)             |
| Extensibility            | Medium (add methods) | High (single chain) | High (add phases)              |
| New phase addition       | Modify parse()       | Add .then()         | Add to \_buildPipeline()       |
| Solves #3411             | Yes                  | Yes                 | Yes                            |
| Framework changes needed | None                 | None                | None                           |
