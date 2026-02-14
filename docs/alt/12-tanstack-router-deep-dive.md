# Alternative 12: TanStack Router Deep Dive, Source Code Analysis

This document analyzes the actual implementation of TanStack Router's navigation guarding and blocking system, based on a direct reading of `packages/router-core/src/router.ts` from the [TanStack Router repository](https://github.com/TanStack/router).

---

## Key Finding: TanStack Router is Fully Async

**TanStack Router's `beforeLoad` is truly async.** Unlike `ui5.guard.router` which uses a sync-first design with async fallback, TanStack Router's entire navigation pipeline runs inside an async function. There is no synchronous fast path.

### How Navigation Works (Source Code Walkthrough)

#### 1. `navigate()` → `buildAndCommitLocation()` → `commitLocation()`

```typescript
// router.ts -- navigate() delegates to buildAndCommitLocation()
navigate: NavigateFn = async ({ to, reloadDocument, href, ... }) => {
    // ... external URL handling ...
    return this.buildAndCommitLocation({ ...rest, href, to });
}
```

`buildAndCommitLocation` builds a `ParsedLocation` and calls `commitLocation`.

#### 2. `commitLocation()`: History Push with Blocker Passthrough

```typescript
commitLocation: CommitLocationFn = async ({ viewTransition, ignoreBlocker, ...next }) => {
	// ... same-state checks ...
	this.history[next.replace ? "replace" : "push"](
		nextHistory.publicHref,
		nextHistory.state,
		{ ignoreBlocker }, // ← blockers live in the history layer
	);
	// ...
	if (!this.history.subscribers.size) {
		this.load(); // ← triggers the actual route loading
	}
};
```

**Critical insight**: Navigation blocking (`ignoreBlocker`) happens at the **history library level** (`@tanstack/history`), not inside the router itself. The router simply passes `ignoreBlocker` through to `history.push()` or `history.replace()`.

#### 3. `load()`: The Async Navigation Pipeline

```typescript
load: LoadFn = async (opts?) => {
	loadPromise = new Promise<void>((resolve) => {
		this.startTransition(async () => {
			try {
				this.beforeLoad(); // ← synchronous: cancel + match routes
				// ...
				await loadMatches({
					// ← async: runs beforeLoad hooks, loaders
					router: this,
					matches: this.state.pendingMatches,
					location: next,
					// ...
				});
			} catch (err) {
				if (isRedirect(err)) {
					this.navigate({ ...redirect.options, replace: true, ignoreBlocker: true });
				}
			}
		});
	});

	this.latestLoadPromise = loadPromise;
	await loadPromise;

	// Wait for any newer navigation that may have been triggered
	while (this.latestLoadPromise && loadPromise !== this.latestLoadPromise) {
		await this.latestLoadPromise;
	}
};
```

#### 4. `beforeLoad()`: NOT the Route Hook, Just Route Matching

The `RouterCore.beforeLoad()` method is **not** where route `beforeLoad` hooks run. It just does synchronous work:

```typescript
beforeLoad = () => {
	this.cancelMatches(); // Cancel any pending matches
	this.updateLatestLocation(); // Update latestLocation from history
	// ... server-side redirect check ...
	const pendingMatches = this.matchRoutes(this.latestLocation); // Match routes
	this.__store.setState((s) => ({
		...s,
		status: "pending",
		pendingMatches,
		// ...
	}));
};
```

The actual route-level `beforeLoad` hooks run inside `loadMatches()` (imported from `./load-matches`), which is `await`ed.

---

## Blocking Mechanism: History-Level, Not Router-Level

Unlike Vue Router or `ui5.guard.router` where blocking happens in the routing layer, TanStack Router delegates blocking entirely to the history library:

```
Navigate call
  → buildLocation()
  → commitLocation()
    → history.push(href, state, { ignoreBlocker })
      → @tanstack/history checks registered blockers
      → If blocked: blocker callback invoked, navigation may be prevented
      → If allowed: history updated, router.load() called
```

For external navigations (`reloadDocument: true`), the router manually checks blockers:

```typescript
// router.ts -- navigate() for external URLs
if (!rest.ignoreBlocker) {
	const historyWithBlockers = this.history as any;
	const blockers = historyWithBlockers.getBlockers?.() ?? [];
	for (const blocker of blockers) {
		if (blocker?.blockerFn) {
			const shouldBlock = await blocker.blockerFn({
				currentLocation: this.latestLocation,
				nextLocation: this.latestLocation,
				action: "PUSH",
			});
			if (shouldBlock) return; // Block external navigation
		}
	}
}
```

### Implications for ui5.guard.router

TanStack Router's approach of delegating blocking to the history layer is fundamentally different from `ui5.guard.router`'s approach of intercepting `parse()`. In UI5:

- The `HashChanger` is UI5's history abstraction
- There is no blocker API on the `HashChanger`
- `parse()` is the earliest interception point in the router

So `ui5.guard.router`'s approach of blocking in `parse()` is the UI5 equivalent of TanStack's history-level blocking.

---

## Concurrent Navigation Handling: No Generation Counter

TanStack Router does **not** use a generation counter like `ui5.guard.router`'s `_parseGeneration`. Instead, it uses three mechanisms:

### 1. AbortController per Match

Each route match gets its own `AbortController`:

```typescript
// In matchRoutesInternal()
match = {
	// ...
	abortController: new AbortController(),
	// ...
};
```

When a new navigation starts, all pending matches are cancelled:

```typescript
beforeLoad = () => {
	this.cancelMatches(); // ← cancels all pending AbortControllers
	// ...
};

cancelMatches = () => {
	const matchesToCancel = new Set([
		...(this.state.pendingMatches ?? []),
		...currentPendingMatches,
		...currentLoadingMatches,
	]);
	matchesToCancel.forEach((match) => {
		this.cancelMatch(match.id);
	});
};

cancelMatch = (id: string) => {
	const match = this.getMatch(id);
	if (!match) return;
	match.abortController.abort(); // ← signal to async operations
};
```

Route `beforeLoad` hooks receive the `abortController` in their context, allowing them to check `signal.aborted` during long-running operations.

### 2. latestLoadPromise Tracking

```typescript
this.latestLoadPromise = loadPromise;
await loadPromise;

// After load completes, wait for any newer navigation that started during loading
while (this.latestLoadPromise && loadPromise !== this.latestLoadPromise) {
	await this.latestLoadPromise;
}
```

This ensures that if navigation B starts while navigation A is loading, navigation A's completion will wait for navigation B to finish before resolving.

### 3. commitLocationPromise Chain

```typescript
const previousCommitPromise = this.commitLocationPromise;
this.commitLocationPromise = createControlledPromise<void>(() => {
	previousCommitPromise?.resolve();
});
```

New commit promises resolve old ones, creating a chain where only the latest commit matters.

### Comparison with ui5.guard.router's Generation Counter

| Mechanism       | TanStack Router                  | ui5.guard.router                       |
| --------------- | -------------------------------- | -------------------------------------- |
| Stale detection | `AbortController.signal.aborted` | `generation !== this._parseGeneration` |
| Cancel pending  | `cancelMatches()` → `abort()`    | Generation increment invalidates       |
| Latest wins     | `latestLoadPromise` loop         | Generation check after each `await`    |
| Granularity     | Per-match AbortController        | Single router-wide generation counter  |

**TanStack's approach is more granular** (per-match cancellation), while **ui5.guard.router's is simpler** (single counter). Both achieve the same goal: only the latest navigation wins.

---

## Redirect Handling

TanStack Router handles redirects via `throw redirect()`:

```typescript
// In route's beforeLoad:
beforeLoad: async ({ context }) => {
    if (!context.auth) throw redirect({ to: '/login' })
}

// Caught in load():
catch (err) {
    if (isRedirect(err)) {
        redirect = err
        if (!this.isServer) {
            this.navigate({
                ...redirect.options,
                replace: true,
                ignoreBlocker: true  // ← redirects bypass blockers
            })
        }
    }
}
```

**Key insight**: Redirects from guards bypass blockers (`ignoreBlocker: true`). This is analogous to `ui5.guard.router`'s `_redirecting` flag, which also bypasses guards during redirects.

---

## State Machine: RouterState

```typescript
interface RouterState {
	status: "pending" | "idle";
	isLoading: boolean;
	isTransitioning: boolean;
	matches: Array<RouteMatch>; // Currently active matches
	pendingMatches?: Array<RouteMatch>; // Matches being loaded
	cachedMatches: Array<RouteMatch>; // Previously matched, cached for reuse
	location: ParsedLocation;
	resolvedLocation?: ParsedLocation; // Last confirmed location
	statusCode: number;
	redirect?: AnyRedirect;
}
```

The `pendingMatches` → `matches` transition happens atomically inside `onReady()`:

```typescript
onReady: async () => {
	this.startTransition(() => {
		batch(() => {
			this.__store.setState((s) => {
				const newMatches = s.pendingMatches || s.matches;
				return {
					...s,
					isLoading: false,
					matches: newMatches,
					pendingMatches: undefined,
					cachedMatches: [...s.cachedMatches, ...exitingMatches],
				};
			});
		});
	});
};
```

---

## What ui5.guard.router Can Learn from TanStack Router

### 1. Blocking at the Right Layer

TanStack delegates blocking to the history library. In UI5, the equivalent would be intercepting at the `HashChanger` level. However, `ui5.guard.router` already found that `parse()` is a better interception point (see `docs/alt/02-hashchanger-interception.md`). The `parse()` approach is actually more reliable in UI5's architecture.

### 2. AbortController for Async Guards ✅ Implemented

~~Currently, `ui5.guard.router` uses a generation counter for staleness.~~ **This has been implemented.** `ui5.guard.router` now creates an `AbortController` per `parse()` call, aborts it when a newer navigation starts or the router is destroyed, and exposes `signal: AbortSignal` on the `GuardContext`. This runs alongside the generation counter — the signal provides cooperative cancellation for async operations (e.g., `fetch`), while the generation counter provides the hard staleness check after each `await`.

```typescript
// Actual GuardContext (implemented):
interface GuardContext {
	toRoute: string;
	toHash: string;
	toArguments: Record<string, string>;
	fromRoute: string;
	fromHash: string;
	signal: AbortSignal; // Aborted when navigation is superseded or router is destroyed
}

// Usage in a guard:
router.addGuard(async (context) => {
	const result = await fetch("/api/check-auth", { signal: context.signal });
	return result.ok;
});
```

The generation counter remains the primary staleness mechanism (checked after each async guard resolves), while the `AbortSignal` enables guards to cancel in-flight network requests immediately when a new navigation starts.

### 3. `ignoreBlocker` for Redirects

TanStack explicitly passes `ignoreBlocker: true` when handling redirects. `ui5.guard.router` achieves the same with `_redirecting = true`. Both prevent infinite redirect loops.

### 4. Match Caching

TanStack caches route matches (`cachedMatches`) so that revisiting a recently-left route is fast. UI5's view caching already provides similar behavior at the view level, but this pattern could inform future optimizations.

### 5. View Transitions

TanStack integrates with the View Transitions API (`document.startViewTransition()`). This is orthogonal to guards but could be a nice enhancement for `ui5.guard.router`.

---

## Architecture Comparison

```
TanStack Router:
  navigate()
    → buildLocation()
    → commitLocation()
      → history.push({ ignoreBlocker })    ← BLOCKING happens here
        → history subscriber fires
          → load()
            → beforeLoad() [route matching]
            → loadMatches() [async]
              → route.beforeLoad() hooks    ← GUARDING happens here
              → route.loader() hooks
            → onReady() [commit to state]

ui5.guard.router:
  navTo() / hashChange / URL bar
    → HashChanger fires hashChanged
      → parse(newHash)                      ← BLOCKING + GUARDING happens here
        → _runLeaveGuards()
        → _runEnterGuards()
          → _runGuards()                ← sync-first optimization
          → _continueGuardsAsync()             ← async fallback
        → _commitNavigation()
          → MobileRouter.parse()
            → route matching + target loading
```

**Key architectural difference**: TanStack separates blocking (history layer) from guarding (load layer). `ui5.guard.router` combines both in `parse()`. The combined approach is simpler and more reliable for UI5's architecture, where the `HashChanger` doesn't support blocking.

---

## Summary

| Aspect               | TanStack Router                       | ui5.guard.router                   |
| -------------------- | ------------------------------------- | ---------------------------------- |
| **Async model**      | Fully async (everything in Promises)  | Sync-first, async fallback         |
| **Blocking layer**   | History library (`@tanstack/history`) | Router `parse()` override          |
| **Guard execution**  | In `loadMatches()` (async)            | In `parse()` (sync path preferred) |
| **Staleness**        | AbortController per match             | Generation counter + AbortSignal   |
| **Concurrent nav**   | Cancel matches + latest promise wins  | Generation check after each await  |
| **Redirect bypass**  | `ignoreBlocker: true`                 | `_redirecting = true`              |
| **State management** | `@tanstack/store` (reactive)          | Internal properties on router      |
| **Match caching**    | `cachedMatches` array                 | Delegated to UI5 target caching    |

**Bottom line**: TanStack Router is more complex and feature-rich (view transitions, match caching, SSR, preloading), but `ui5.guard.router`'s simpler sync-first design is better suited to UI5's synchronous event model. The generation counter is lighter than per-match AbortControllers for the common case where guards are synchronous. The `AbortSignal` on `GuardContext` (implemented) provides cooperative cancellation for async guards without the overhead of per-match controllers.

> **Note (2025):** TanStack Router's `navigate` function within `beforeLoad` context is now deprecated. The recommended pattern is `throw redirect({ to: '/somewhere' })`. TanStack Router now has official packages for React, Solid, and Vue.

## References

- [TanStack Router Source: router.ts](https://github.com/TanStack/router/blob/main/packages/router-core/src/router.ts)
- [TanStack Router Source: load-matches.ts](https://github.com/TanStack/router/blob/main/packages/router-core/src/load-matches.ts)
- [TanStack History Source](https://github.com/TanStack/router/tree/main/packages/history)
- [TanStack Router Navigation Blocking Guide](https://tanstack.com/router/v1/docs/framework/react/guide/navigation-blocking)
