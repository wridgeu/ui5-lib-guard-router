# Analysis: Async Guard Support vs Fully Async Router Rewrite

> **Status**: Rejected. A fully async router rewrite is not recommended: the sync-first model is correct for UI5. The recommended alternative, a unified guard pipeline, shipped as [Feature 09](./09-guard-pipeline-extraction.md).

## Context: OpenUI5 Issue #3411

The UI5 team has worked on navigation interception since December 2021
([UI5/openui5#3411](https://github.com/UI5/openui5/issues/3411), backlog item CPOUI5FRAMEWORK-338).
At the time of this analysis (October 2024) the issue was open and labeled "in progress".

The team proposed `preventDefault()` support on `beforeRouteMatched`:

```js
this.getRouter().attachBeforeRouteMatched(function (oEvent) {
	if (!this.hasAccess()) {
		oEvent.preventDefault();
	}
});
```

They noted that this can only be synchronous:

> The downside of this solution is that the `hasAccess` method has to return synchronously.
> You can not perform any async backend calls here because the response of the backend call
> would come later than the navigation process.
>
> _@flovogt, UI5 team_

In September 2022:

> Currently, the team does a great job of eliminating synchronous tasks in the framework
> and offering asynchronous options. Introducing a new synchronous concept fits not really
> in this work stream, so **the team is still looking for a way to make this concept
> asynchronous directly from the start**.
>
> _@flovogt, UI5 team_

The community workarounds:

- Checking permissions before `navTo()` (misses the URL bar and deep links)
- Checking in `onInit` / `attachPatternMatched` (the view loads and flashes before the redirect)
- Monkey-patching `HashChanger` or `CrossApplicationNavigation` (fragile)
- A hard redirect via `URLHelper.redirect()` (full page reload, loses state)

### What a router subclass already provides

| UI5 team's requirement               | Subclass approach                                                   |
| ------------------------------------ | ------------------------------------------------------------------- |
| Intercept **before** target loading  | Guards run before `MobileRouter.prototype.parse()`                  |
| Support async checks (backend calls) | Guards may return a Promise                                         |
| Keep the sync event model            | Sync-first: no deferral when guards are sync                        |
| Handle concurrent navigations        | Generation counter discards stale results                           |
| Leave no stale history entries       | `navTo()` preflight; `_restoreHash()` with `replaceHash` for others |
| Work for all navigation sources      | `navTo()` preflight plus `parse()` for URL bar and back/forward     |

`beforeRouteMatched` fires **after** the hash has changed and route matching has begun. Intercepting in `parse()` is earlier: before route matching, target loading and events.

## What "fully async like TanStack" would mean for UI5

### UI5 flow: half sync, half async

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

The sync half (hash change, route match, start of target loading) has no gap for async work. The async half (view loading, post-load events) already uses Promises.

### TanStack flow, for comparison

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

Navigation is a state machine: `idle → pending → loading → committed → settled`. Everything before `committed` can be interrupted or replaced.

### Three levels

Each level includes the previous one.

#### Level 1: async guard hook on a router subclass

Override `parse()` (and `navTo()`) in a subclass and run guards before calling `super`.

```
HashChanger.fireHashChanged()
  → OUR Router.parse(hash)                  ← INTERCEPT
    → Run guards (sync-first, async fallback)
    → If allowed: MobileRouter.prototype.parse(hash)  ← resume normal flow
    → If blocked: _restoreHash()
```

- **Framework changes**: none.
- **Gains**: async-capable guards before route matching; sync guards are not deferred.
- **Not covered**: async inside route matching, or between `beforeRouteMatched` and target loading; native framework support.
- **Cost**: this library.

#### Level 2: native async guards in `sap.ui.core.routing.Router`

The framework adds a guard registry, and `parse()` awaits guards before delegating to crossroads. This is what #3411 is trying to design.

```
HashChanger.fireHashChanged()
  → Router.parse(hash)
    → Router._runGuards(hash)               ← NEW: guard pipeline
      ├─ sync guards → immediate result
      └─ async guards → Promise
    → If allowed: crossroads._oRouter.parse(hash)  ← existing flow resumes
    → If blocked: restore hash
```

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

- **Gains**: native guards in every router subclass (sap.m, sap.f), no library; test tools can learn about pending navigations.
- **Not covered**: no data loading phase, no route middleware, no navigation state machine.
- **Cost**: about 500 lines across 2-3 modules. The hard part is backward compatibility and test tool updates, not the code.

The `parse()` → `crossroads.parse()` call is synchronous and deeply entrenched. An async gap needs either (a) always deferring `crossroads.parse()` to a microtask, which breaks the sync contract, or (b) a dual path: sync when possible, async when needed. Option (b) keeps UI5's sync fast path.

#### Level 3: full TanStack-style async pipeline

Rearchitect routing so the whole navigation is a managed async pipeline with states, cancellation and middleware phases.

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

- **Gains**: a navigation state machine, route middleware (`beforeLoad`, `loader`), leave and enter guards as first-class concepts, data prefetching before render, cancellation via AbortSignal, no view flash on rejection.
- **Not needed for UI5**: SSR, the View Transitions API, preloading on hover, type-safe route paths.
- **Cost**: 2000-5000 lines across 8+ modules. A multi-quarter project with a phased, backward-compatible rollout.

The return does not justify this. UI5 apps are mostly enterprise CRUD with simple routing. TanStack's complexity comes from React's rendering model and SSR, streaming and suspense, which do not apply to UI5. Level 2 is the more likely path for the UI5 team.

### Level comparison

| Aspect             | Level 1 (Subclass) | Level 2 (Native Guards) | Level 3 (Full Pipeline)       |
| ------------------ | ------------------ | ----------------------- | ----------------------------- |
| Async guards       | Yes                | Yes                     | Yes                           |
| Leave guards       | Yes                | Possible                | Yes                           |
| Data loading phase | No                 | No                      | Yes                           |
| Navigation states  | No                 | No                      | Yes (pending/loading/settled) |
| AbortSignal        | Yes                | Possible                | Yes                           |
| Framework changes  | None               | 2-3 modules             | 8+ modules                    |
| Breaking changes   | None               | Minimal                 | Significant                   |
| Timeline           | Available today    | Months                  | Quarters/Years                |
| Who does it        | App/library code   | UI5 team                | UI5 team                      |
| Risk               | Low (subclass)     | Medium                  | Very High                     |

The subclass is a complete Level 1 solution and shows that Level 2 is feasible: UI5 does not need to make everything async to support async guards. It only needs to detect when a guard returns a Promise and defer in that case.

If UI5 ships native guards, migrating means replacing `ui5.guard.router.Router` with `sap.m.routing.Router` and mapping `addGuard()`, `addRouteGuard()` and `addLeaveGuard()` to the native API.

## Current architecture: sync-first with async fallback

```
navTo() preflight, or hashChanged → parse()
  → _pipeline.evaluate()
     ├─ sync: every guard returns a plain value → decision in the same tick
     └─ async: first Promise → _continueGuardsAsync() awaits the rest of that phase
               ├─ abort signal checked before each remaining guard and before the next phase
               ├─ later phases run in a plain loop until a guard returns a Promise
               └─ Router discards the decision if _parseGeneration changed
```

1. **Sync fast path**: when all guards return plain values, guard evaluation and route activation happen in the same tick as the `hashChanged` event.
2. **Async fallback**: when a guard returns a Promise, the decision becomes async. A generation counter detects stale results.

Why this fits UI5:

- **No guards**: the pipeline returns `allow` synchronously and the router commits in the same tick.
- **Sync guards**: the framework sees the navigation complete within the event handler.
- **Async when needed**: backend permission checks, `MessageBox.confirm()` dialogs.
- **Generation counter plus one AbortController per navigation**: lighter than TanStack's per-match AbortControllers, and enough for UI5's single-hash model.

`GuardPipeline.ts` holds the dual-path logic in five methods:

- `_runForEach()`: runs leave or enter guards route by route (greedy routes), sync until a run returns a Promise
- `_runGuards()`: the sync loop, shared by leave and enter guards
- `_continueGuardsAsync()`: the async continuation, shared by leave and enter guards
- `_runEnterGuards()`: global enter guards, then route enter guards
- `_runRouteGuards()`: route enter guards, if any are registered

This is a small amount of code, including error logging, and not a maintenance burden.

## Alternatives considered

### Option A: always-async pipeline

```typescript
parse(newHash: string): void {
    const generation = ++this._parseGeneration;
    Promise.resolve()
        .then(() => this._runLeaveGuards(context))
        .then((r) => r !== true ? r : this._runGlobalGuards(context))
        .then((r) => r !== true ? r : this._runRouteGuards(toRoute, context))
        .then((result) => {
            if (generation !== this._parseGeneration) return;
            this._applyGuardResult(result, newHash, toRoute);
        })
        .catch(() => {
            if (generation !== this._parseGeneration) return;
            this._restoreHash();
        });
}
```

Gains one code path and slightly less code. Loses:

- **The sync fast path**: every navigation pays a microtask delay, even with no guards.
- **Test tool compatibility**: `waitForUI5()` breaks for all navigations, not only async-guarded ones.
- **The sync guarantee**: code that expects `navTo()` to complete synchronously (`navTo("home"); assert(getCurrentRoute() === "home")`) breaks.
- **Initial navigation timing**: `router.initialize()` defers the first route match to a microtask.

### Option B: async inside, sync outside

Keep `parse()` synchronous, unify the internal pipeline on Promises, and detect whether the result settled synchronously. This cannot work: `Promise.then()` always runs in a microtask, even for a resolved Promise. JavaScript has no way to read a Promise's value synchronously.

### Option C: a sync-or-async result type

```typescript
type MaybeAsync<T> = T | Promise<T>;
```

This is what the code does with the `isPromiseLike()` check. The dual path is the minimal form of this pattern.

### Cost summary

Line counts are from the time of the analysis.

| Change                     | Sync fast path | Test tools | Code size | Async guards |
| -------------------------- | -------------- | ---------- | --------- | ------------ |
| Keep current (sync-first)  | Preserved      | Compatible | ~36 lines | Supported    |
| Always-async (Option A)    | **Lost**       | **Broken** | ~25 lines | Supported    |
| Current + unified pipeline | Preserved      | Compatible | ~50 lines | Supported    |

Going fully async costs broken test tools and the lost sync guarantee for about 11 fewer lines. The dual path is the right trade-off.

## Recommendation and outcome

Do not rewrite to fully async. Instead:

1. **Unify the guard pipeline** so a new phase does not touch `parse()`. Shipped as `GuardPipeline` ([Feature 09](./09-guard-pipeline-extraction.md)).
2. **Pass an `AbortSignal` in the guard context**, so async guards can cancel `fetch()` and similar work when superseded. Shipped as `GuardContext.signal`. The generation counter stays the primary staleness check.
3. **Keep the generation counter.**
4. **Add lifecycle events if observability is needed.** Shipped as the `navigationSettled` event and `navigationSettled()` Promise, with a `NavigationOutcome` per navigation ([Feature 10](./10-navigation-outcome-error.md)).

This library answers the request in #3411 without framework changes. A `parse()` override was suggested by community members in the issue thread (October 2024). It supports sync and async guards and covers every navigation source.
