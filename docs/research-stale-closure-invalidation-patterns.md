# Stale Closure Invalidation Patterns Across Frameworks

How major UI frameworks detect and discard results from outdated async operations
when reactive dependencies change before those operations complete.

---

## Table of Contents

1. [React: useEffect cleanup with boolean flag](#react-useeffect-cleanup-with-boolean-flag)
2. [Vue 3: Watcher cleanup with onCleanup / onWatcherCleanup](#vue-3-watcher-cleanup-with-oncleanup--onwatchercleanup)
3. [Solid.js: Owner-scoped cleanups via onCleanup](#solidjs-owner-scoped-cleanups-via-oncleanup)
4. [Svelte 5: $effect teardown return function](#svelte-5-effect-teardown-return-function)
5. [Angular: effect() onCleanup callback](#angular-effect-oncleanup-callback)
6. [RxJS / Angular: switchMap automatic unsubscription](#rxjs--angular-switchmap-automatic-unsubscription)
7. [TanStack Query: Single-retryer replacement with AbortSignal](#tanstack-query-single-retryer-replacement-with-abortsignal)
8. [Comparison summary](#comparison-summary)

---

## React: useEffect cleanup with boolean flag

### Mechanism

React does **not** use a generation counter internally for useEffect. Instead,
React's reconciler stores a `destroy` function (the return value of the effect
callback) on the effect's `EffectInstance` object. Before an effect re-runs due
to changed dependencies, React calls all pending `destroy` functions first,
then runs the new `create` functions.

The **user-land** pattern for stale async invalidation is a **boolean flag**,
commonly called `ignore` or `cancelled`, scoped to the effect closure and
flipped to `true` in the cleanup function.

### Source code (React internals)

The relevant files in [facebook/react](https://github.com/facebook/react) are:

| File                                                       | Purpose                                                                                                          |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `packages/react-reconciler/src/ReactFiberHooks.js`         | `mountEffect`, `updateEffect`, `pushEffect`; creates Effect objects with `{tag, inst, create, deps}`             |
| `packages/react-reconciler/src/ReactFiberCommitEffects.js` | `commitHookEffectListUnmount` (runs destroy), `commitHookEffectListMount` (runs create, stores returned destroy) |
| `packages/react-reconciler/src/ReactHookEffectTags.js`     | Flag constants `HookHasEffect`, `HookPassive`, `HookLayout`                                                      |

**Effect type definition** (`ReactFiberHooks.js`):

```js
type Effect = {
  tag: HookFlags,
  inst: EffectInstance,     // { destroy: void | (() => void) }
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
  next: Effect,
};
```

**Cleanup execution** (`ReactFiberCommitEffects.js`):

```js
// Runs all destroy (cleanup) functions for matching effects
function commitHookEffectListUnmount(flags, finishedWork, nearestMountedAncestor) {
	// ...
	do {
		if ((effect.tag & flags) === flags) {
			const inst = effect.inst;
			const destroy = inst.destroy;
			if (destroy !== undefined) {
				inst.destroy = undefined;
				safelyCallDestroy(finishedWork, nearestMountedAncestor, destroy);
			}
		}
		effect = effect.next;
	} while (effect !== firstEffect);
}

// Runs all create functions and stores returned cleanup
function commitHookEffectListMount(flags, finishedWork) {
	// ...
	do {
		if ((effect.tag & flags) === flags) {
			const create = effect.create;
			const inst = effect.inst;
			const destroy = create(); // Execute the effect
			inst.destroy = destroy; // Store cleanup for next cycle
		}
		effect = effect.next;
	} while (effect !== firstEffect);
}
```

The overall commit order in `flushPassiveEffectsImpl()` is:

```
commitPassiveUnmountEffects(...)   // 1. Run all destroy/cleanup
commitPassiveMountEffects(...)     // 2. Run all create, store new destroy
```

### Canonical user-land pattern

From the [official React docs](https://react.dev/reference/react/useEffect):

```js
useEffect(() => {
	let ignore = false;

	async function fetchData() {
		const response = await fetch(`/api/user/${userId}`);
		const data = await response.json();
		if (!ignore) {
			setUser(data); // Only apply if this effect is still current
		}
	}

	fetchData();

	return () => {
		ignore = true; // Flip the flag -- stale results are discarded
	};
}, [userId]);
```

The `ignore` flag acts as a **per-invocation boolean token**. Each effect
invocation captures its own `ignore` variable in a closure. When React tears
down the old effect (because `userId` changed), `ignore` becomes `true` for
that closure, causing any in-flight `fetch` response to be silently discarded.

**Variant with AbortController** (cancels the HTTP request entirely):

```js
useEffect(() => {
	const controller = new AbortController();

	fetch(`/api/user/${userId}`, { signal: controller.signal })
		.then((res) => res.json())
		.then((data) => setUser(data))
		.catch((err) => {
			if (err.name !== "AbortError") throw err;
		});

	return () => controller.abort();
}, [userId]);
```

---

## Vue 3: Watcher cleanup with onCleanup / onWatcherCleanup

### Mechanism

Vue uses a **cleanup callback registration** pattern. Effects store their
cleanup functions in a `WeakMap<ReactiveEffect, (() => void)[]>` called
`cleanupMap`. Before the watcher's scheduler `job` re-runs the effect, it
invokes all registered cleanup functions, then clears them. The effect also
checks its `dirty` flag to determine whether re-evaluation is needed.

There are two API surfaces:

1. **`onCleanup` parameter** (Vue 3.0+), passed as the 3rd argument to
   `watch` callbacks or 1st argument to `watchEffect`.
2. **`onWatcherCleanup()`** (Vue 3.5+), a standalone import that registers
   cleanup on the currently active watcher.

### Source code

The relevant files in [vuejs/core](https://github.com/vuejs/core) are:

| File                                    | Purpose                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| `packages/reactivity/src/watch.ts`      | `onWatcherCleanup`, `cleanupMap` WeakMap, `baseWatch` core logic                  |
| `packages/runtime-core/src/apiWatch.ts` | `watch`, `watchEffect`: thin wrappers over `baseWatch` with scheduler integration |

**Cleanup registration** (`packages/reactivity/src/watch.ts`):

```ts
const cleanupMap: WeakMap<ReactiveEffect, (() => void)[]> = new WeakMap();

export function onWatcherCleanup(
	cleanupFn: () => void,
	failSilently = false,
	owner: ReactiveEffect | undefined = activeWatcher,
): void {
	if (owner) {
		let cleanups = cleanupMap.get(owner);
		if (!cleanups) cleanupMap.set(owner, (cleanups = []));
		cleanups.push(cleanupFn);
	}
}
```

**Bound onCleanup parameter** (same file):

```ts
boundCleanup = (fn) => onWatcherCleanup(fn, false, effect);
```

This is passed into user callbacks so they can register cleanup without
importing `onWatcherCleanup` explicitly.

**Pre-execution cleanup** (in the watcher's `job` function):

```ts
const job = (immediateFirstRun?: boolean) => {
	if (!(effect.flags & EffectFlags.ACTIVE) || (!effect.dirty && !immediateFirstRun)) {
		return;
	}
	if (cleanup) {
		cleanup(); // Run registered cleanups before re-executing
	}
	// ... execute callback with new values ...
};
```

### Canonical user-land pattern

From the [Vue docs](https://vuejs.org/guide/essentials/watchers):

**Using `onWatcherCleanup` (Vue 3.5+):**

```ts
import { watch, onWatcherCleanup } from "vue";

watch(id, (newId) => {
	const controller = new AbortController();

	fetch(`/api/${newId}`, { signal: controller.signal }).then(() => {
		// callback logic
	});

	onWatcherCleanup(() => {
		controller.abort(); // Abort stale request
	});
});
```

**Using the `onCleanup` parameter (Vue 3.0+):**

```ts
watch(id, (newId, oldId, onCleanup) => {
	const controller = new AbortController();

	fetch(`/api/${newId}`, { signal: controller.signal }).then(() => {
		// callback logic
	});

	onCleanup(() => {
		controller.abort();
	});
});
```

**Using a boolean flag (same idea as React):**

```ts
watchEffect(async (onCleanup) => {
	let cancelled = false;
	onCleanup(() => {
		cancelled = true;
	});

	const data = await fetchSomething(source.value);
	if (!cancelled) {
		result.value = data;
	}
});
```

---

## Solid.js: Owner-scoped cleanups via onCleanup

### Mechanism

Solid uses a **fine-grained reactive graph** where every computation (effect,
memo) is an `Owner` node. Each node has a `cleanups` array. When a computation
re-runs, Solid calls `cleanNode(node)` first, which:

1. Disconnects tracking subscriptions (sources/observers).
2. Recursively cleans owned child nodes.
3. Iterates `node.cleanups` in reverse order, calling each function.
4. Sets `node.cleanups = null`.

The `onCleanup()` primitive pushes a callback into the current `Owner.cleanups`
array. Because Solid runs components once (not on every render), the cleanup
array naturally scopes to the reactive computation that registered it.

### Source code

The relevant file in [solidjs/solid](https://github.com/solidjs/solid) is:

| File                                    | Purpose                                                         |
| --------------------------------------- | --------------------------------------------------------------- |
| `packages/solid/src/reactive/signal.ts` | `onCleanup`, `cleanNode`, `updateComputation`, `runComputation` |

**onCleanup registration:**

```ts
export function onCleanup<T extends () => any>(fn: T): T {
	if (Owner === null) console.warn("cleanups created outside a `createRoot` or `render` will never be run");
	else if (Owner.cleanups === null) Owner.cleanups = [fn];
	else Owner.cleanups.push(fn);
	return fn;
}
```

**cleanNode: runs all cleanups before re-execution:**

```ts
function cleanNode(node: Owner) {
	// 1. Disconnect tracking subscriptions (sources/observers)
	if ((node as Computation<any>).sources) {
		while ((node as Computation<any>).sources!.length) {
			// ... pop sources, unlink observers ...
		}
	}

	// 2. Recursively clean owned child nodes
	if ((node as Memo<any>).tOwned) {
		for (i = (node as Memo<any>).tOwned!.length - 1; i >= 0; i--) cleanNode((node as Memo<any>).tOwned![i]);
		delete (node as Memo<any>).tOwned;
	}

	// 3. Execute cleanup functions in reverse order
	if (node.cleanups) {
		for (i = node.cleanups.length - 1; i >= 0; i--) node.cleanups[i]();
		node.cleanups = null;
	}
}
```

**updateComputation: cleanup then re-run:**

```ts
function updateComputation(node: Computation<any>) {
  if (!node.fn) return;
  cleanNode(node);            // Cleanup FIRST
  const time = ExecCount;
  runComputation(node, ...);  // Then re-execute
}
```

### Canonical user-land pattern

```ts
import { createSignal, createEffect, onCleanup } from "solid-js";

function UserProfile(props) {
  const [user, setUser] = createSignal(null);

  createEffect(() => {
    const controller = new AbortController();
    const userId = props.userId;  // Tracked dependency

    fetch(`/api/user/${userId}`, { signal: controller.signal })
      .then(res => res.json())
      .then(data => setUser(data))
      .catch(err => {
        if (err.name !== "AbortError") throw err;
      });

    onCleanup(() => controller.abort());
  });

  return <div>{user()?.name}</div>;
}
```

**Boolean flag variant:**

```ts
createEffect(() => {
	let stale = false;
	const id = userId();

	fetchUser(id).then((data) => {
		if (!stale) setUser(data);
	});

	onCleanup(() => {
		stale = true;
	});
});
```

---

## Svelte 5: $effect teardown return function

### Mechanism

Svelte 5's `$effect` rune follows React's return-function convention. The
effect function can return a **teardown function** that Svelte stores on the
effect object's `teardown` property. Before the effect re-runs (due to
dependency changes) or when the component is destroyed, Svelte calls
`execute_effect_teardown(effect)`.

Unlike React, Svelte's `$effect` does not track values accessed asynchronously
(after `await` or inside `setTimeout`), which inherently reduces, but does
not eliminate, the stale closure problem.

### Source code

The relevant file in [sveltejs/svelte](https://github.com/sveltejs/svelte) is:

| File                                                        | Purpose                                     |
| ----------------------------------------------------------- | ------------------------------------------- |
| `packages/svelte/src/internal/client/reactivity/effects.js` | `execute_effect_teardown`, `destroy_effect` |

**execute_effect_teardown:**

```js
export function execute_effect_teardown(effect) {
	var teardown = effect.teardown;
	if (teardown !== null) {
		const previously_destroying_effect = is_destroying_effect;
		const previous_reaction = active_reaction;
		set_is_destroying_effect(true);
		set_active_reaction(null);
		try {
			teardown.call(null);
		} finally {
			set_is_destroying_effect(previously_destroying_effect);
			set_active_reaction(previous_reaction);
		}
	}
}
```

**destroy_effect:**

```js
export function destroy_effect(effect, remove_dom = true) {
	// ...
	execute_effect_teardown(effect);
	// ... nullify effect properties ...
}
```

### Canonical user-land pattern

From the [Svelte docs](https://svelte.dev/docs/svelte/$effect):

```svelte
<script>
  let milliseconds = $state(1000);
  let count = $state(0);

  $effect(() => {
    const interval = setInterval(() => {
      count += 1;
    }, milliseconds);

    return () => {
      clearInterval(interval);   // Teardown before re-run or unmount
    };
  });
</script>
```

**Boolean flag for async operations:**

```svelte
<script>
  let userId = $state(1);
  let user = $state(null);

  $effect(() => {
    let cancelled = false;
    const id = userId;

    fetch(`/api/user/${id}`)
      .then(res => res.json())
      .then(data => {
        if (!cancelled) user = data;
      });

    return () => { cancelled = true; };
  });
</script>
```

---

## Angular: effect() onCleanup callback

### Mechanism

Angular's signal-based `effect()` (introduced in Angular 16+) provides an
**`onCleanup` callback parameter**. The registered cleanup function runs
immediately before the next effect execution or when the effect is destroyed
(tied to the component's `DestroyRef`).

Angular effects only track signals read **synchronously**. Values read after an
`await` are not tracked, similar to Svelte.

### Source code

The relevant documentation lives at [angular.dev/guide/signals/effect](https://angular.dev/guide/signals/effect).
The internal implementation is in:

| File (angular/angular repo)                      | Purpose                                   |
| ------------------------------------------------ | ----------------------------------------- |
| `packages/core/src/render3/reactivity/effect.ts` | `effect()` creation, cleanup registration |

### Canonical user-land pattern

From the [Angular docs](https://angular.dev/guide/signals/effect):

```ts
effect((onCleanup) => {
	const user = currentUser(); // Tracked signal read

	const timer = setTimeout(() => {
		console.log(`1 second ago, the user became ${user}`);
	}, 1000);

	onCleanup(() => {
		clearTimeout(timer); // Cancel stale timer
	});
});
```

**AbortController variant:**

```ts
effect((onCleanup) => {
	const id = userId();
	const controller = new AbortController();

	fetch(`/api/user/${id}`, { signal: controller.signal })
		.then((res) => res.json())
		.then((data) => userData.set(data));

	onCleanup(() => controller.abort());
});
```

---

## RxJS / Angular: switchMap automatic unsubscription

### Mechanism

RxJS `switchMap` provides **automatic cancellation** of the previous inner
observable when a new outer value arrives. When the source observable emits,
`switchMap` calls `.unsubscribe()` on the previous inner subscription before
subscribing to the new one. For Angular's `HttpClient`, unsubscription triggers
`XMLHttpRequest.abort()`, cancelling the in-flight HTTP request at the network
level.

This is a **subscription replacement** pattern rather than a boolean flag, but
it solves the same stale-result problem.

### Source reference

| Package | Module                                |
| ------- | ------------------------------------- |
| `rxjs`  | `src/internal/operators/switchMap.ts` |

### Canonical user-land pattern

```ts
// Angular component
this.searchTerms$
	.pipe(
		debounceTime(300),
		distinctUntilChanged(),
		switchMap((term) => this.http.get(`/api/search?q=${term}`)),
	)
	.subscribe((results) => {
		this.results = results;
		// Only the latest search term's results arrive here.
		// Previous in-flight requests are automatically cancelled.
	});
```

**Key rule:** Place `takeUntil(this.destroy$)` or `takeUntilDestroyed()` after
`switchMap` in the operator chain, not before it.

---

## TanStack Query: Single-retryer replacement with AbortSignal

### Mechanism

TanStack Query prevents stale results through a **single-active-retryer**
pattern combined with `AbortSignal`:

1. Each `Query` instance maintains a single `#retryer` property. When a new
   fetch starts, it **replaces** the previous retryer, effectively abandoning
   the old one.
2. An `AbortController` is created per fetch. Its `signal` is lazily exposed to
   the user's `queryFn` via a getter that sets `#abortSignalConsumed = true`.
3. If the query is cancelled (e.g. by invalidation or component unmount), a
   `CancelledError` is thrown. If `CancelledError.revert` is true, state rolls
   back to `#revertState` (a snapshot taken before the fetch started).

### Source code

The relevant files in [TanStack/query](https://github.com/TanStack/query) are:

| File                                 | Purpose                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `packages/query-core/src/query.ts`   | `#retryer` property, `#revertState` snapshot, `#abortSignalConsumed` flag, fetch orchestration                  |
| `packages/query-core/src/retryer.ts` | `CancelledError` class (`revert`, `silent` properties), `createRetryer`, resolution guarding via `isResolved()` |

**CancelledError** (`retryer.ts`):

```ts
export class CancelledError extends Error {
	revert?: boolean;
	silent?: boolean;
	constructor(options?: CancelOptions) {
		super("CancelledError");
		this.revert = options?.revert;
		this.silent = options?.silent;
	}
}
```

**AbortSignal consumption tracking** (`query.ts`):

```ts
const addSignalProperty = (object: unknown) => {
	Object.defineProperty(object, "signal", {
		enumerable: true,
		get: () => {
			this.#abortSignalConsumed = true;
			return abortController.signal;
		},
	});
};
```

**Cancellation guard** (`retryer.ts`):

```ts
const cancel = (cancelOptions?: CancelOptions): void => {
	if (!isResolved()) {
		const error = new CancelledError(cancelOptions) as TError;
		reject(error);
		config.onCancel?.(error);
	}
};
```

### Canonical user-land pattern

```ts
const { data } = useQuery({
	queryKey: ["user", userId],
	queryFn: async ({ signal }) => {
		const response = await fetch(`/api/user/${userId}`, { signal });
		return response.json();
	},
});
```

TanStack Query passes the `AbortSignal` to `queryFn` automatically. If the
query is invalidated or the component unmounts while the fetch is in-flight,
the signal is aborted, cancelling the request.

---

## Comparison summary

| Framework          | Invalidation mechanism                                             | Who runs cleanup                                                         | Async cancellation                              |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------- |
| **React**          | Per-closure boolean flag (`ignore`)                                | Framework calls `destroy` before re-running `create`                     | User-land (flag or AbortController)             |
| **Vue**            | Registered cleanup callbacks in `cleanupMap` WeakMap               | Framework calls cleanups before watcher `job` re-runs                    | User-land via `onCleanup`/`onWatcherCleanup`    |
| **Solid**          | `Owner.cleanups` array, cleared by `cleanNode()`                   | Framework calls `cleanNode` in `updateComputation` before re-run         | User-land via `onCleanup`                       |
| **Svelte 5**       | Return-function stored as `effect.teardown`                        | Framework calls `execute_effect_teardown` before re-run                  | User-land (flag or AbortController in teardown) |
| **Angular**        | `onCleanup` callback parameter in `effect()`                       | Framework calls cleanup before next execution or on `DestroyRef` destroy | User-land via `onCleanup`                       |
| **RxJS**           | `switchMap` auto-unsubscribes previous inner observable            | Operator calls `.unsubscribe()` on previous inner subscription           | Automatic (unsubscribe triggers XHR abort)      |
| **TanStack Query** | Single-retryer replacement + AbortSignal + state snapshot rollback | Framework replaces `#retryer`, signals abort                             | Automatic (AbortSignal passed to queryFn)       |

### Common patterns across all frameworks

1. **Boolean flag / token**: The simplest form. A boolean scoped to the effect
   closure is flipped in cleanup. Stale async callbacks check the flag before
   applying results. Used in React, Vue, Solid, Svelte.

2. **AbortController**: A stronger form that cancels the underlying operation
   (HTTP request, stream) rather than just ignoring its result. Supported as a
   user-land pattern in all frameworks; automatic in TanStack Query.

3. **Generation counter**: A numeric counter incremented on each invocation.
   The async callback captures the counter value and compares it to the current
   value before applying results. This is a generalization of the boolean flag
   that works when multiple overlapping invocations are possible. This pattern
   is common in custom hooks/composables but is not the primary mechanism in any
   of the frameworks surveyed (they all use cleanup-callback registration
   instead).

4. **Object token**: A variant of the generation counter that uses object
   identity instead of a numeric value. Each invocation creates a fresh `{}`
   and stores it on the instance. The async callback captures the token
   reference and compares it to the current one before applying results.
   Functionally equivalent to the generation counter but sometimes more
   readable when the "counter" semantics are not needed.

    ```ts
    class Fetcher {
    	#currentToken: object | null = null;

    	async load(url: string): Promise<void> {
    		const token = {}; // unique identity per invocation
    		this.#currentToken = token; // store as "current"

    		const data = await fetch(url).then((r) => r.json());

    		if (token !== this.#currentToken) {
    			return; // a newer load() replaced our token -- discard
    		}
    		this.applyData(data);
    	}
    }
    ```

5. **Subscription replacement**: RxJS's `switchMap` replaces the entire
   subscription rather than using a flag, achieving automatic cancellation.

### Key insight

All frameworks converge on the same fundamental idea: **the framework provides
a hook to run cleanup code at the boundary between the old effect invocation
and the new one**. What varies is the API surface (return function vs. callback
parameter vs. registered function) and whether the framework itself performs
cancellation (TanStack Query, RxJS) or delegates it to user code (React, Vue,
Solid, Svelte, Angular).

---

## References

- [React useEffect docs](https://react.dev/reference/react/useEffect)
- [React source: ReactFiberHooks.js](https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberHooks.js)
- [React source: ReactFiberCommitEffects.js](https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberCommitEffects.js)
- [How does useEffect work internally](https://jser.dev/2023-07-08-how-does-useeffect-work/)
- [Vue Watchers docs](https://vuejs.org/guide/essentials/watchers)
- [Vue Reactivity API: Core](https://vuejs.org/api/reactivity-core.html)
- [Vue source: packages/reactivity/src/watch.ts](https://github.com/vuejs/core/blob/main/packages/reactivity/src/watch.ts)
- [Vue source: packages/runtime-core/src/apiWatch.ts](https://github.com/vuejs/core/blob/main/packages/runtime-core/src/apiWatch.ts)
- [Solid.js createEffect docs](https://docs.solidjs.com/reference/basic-reactivity/create-effect)
- [Solid.js onCleanup docs](https://docs.solidjs.com/reference/lifecycle/on-cleanup)
- [Solid source: packages/solid/src/reactive/signal.ts](https://github.com/solidjs/solid/blob/main/packages/solid/src/reactive/signal.ts)
- [Svelte $effect docs](https://svelte.dev/docs/svelte/$effect)
- [Svelte source: packages/svelte/src/internal/client/reactivity/effects.js](https://github.com/sveltejs/svelte/blob/main/packages/svelte/src/internal/client/reactivity/effects.js)
- [Angular effect() docs](https://angular.dev/guide/signals/effect)
- [RxJS switchMap](https://www.learnrxjs.io/learn-rxjs/operators/transformation/switchmap)
- [TanStack Query Cancellation docs](https://tanstack.com/query/v5/docs/framework/react/guides/query-cancellation)
- [TanStack Query source: packages/query-core/src/query.ts](https://github.com/TanStack/query/blob/main/packages/query-core/src/query.ts)
- [TanStack Query source: packages/query-core/src/retryer.ts](https://github.com/TanStack/query/blob/main/packages/query-core/src/retryer.ts)
- [Dan Abramov's race condition pattern](https://maxrozen.com/race-conditions-fetching-data-react-with-useeffect)
- [Vue 3.5 onWatcherCleanup](https://dev.to/alexanderop/vue-35s-onwatchercleanup-mastering-side-effect-management-in-vue-applications-9pn)
