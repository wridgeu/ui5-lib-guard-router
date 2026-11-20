# Guards on Redirect Targets

**Issue:** [#52](https://github.com/wridgeu/ui5-lib-guard-router/issues/52)

> **Status**: Implemented. The guards of a redirect target run before it commits, with loop detection.

## Problem

Before this change, a guard that redirected from route A to route B skipped B's guards. The router entered the `committing/redirect` phase before calling `navTo()`, and the re-entrant `navTo()` saw that phase and skipped the preflight.

```
User -> /admin (guard redirects to /profile)
         /profile has an onboarding guard <- SKIPPED
         Profile renders without onboarding check
```

Vue Router, Angular Router, TanStack Router and React Router all run guards on redirect targets. Apps with chained authorization requirements need it.

## Decision

`_redirect()` evaluates the target's guards on each hop. A set of visited hashes and a depth cap detect loops. The `committing/redirect` phase and its bypass in `navTo()` stay, but only for the final commit after the whole chain resolves.

```
evaluate(A) -> guard redirects to B
  _redirect(B, visited = {hashA})
    evaluate(B, skipLeaveGuards) -> redirects to C
      _redirect(C, visited = {hashA, hashB})
        evaluate(C, skipLeaveGuards) -> allows -> commit C
    evaluate(B, skipLeaveGuards) -> blocks -> whole chain blocked
    evaluate(B, skipLeaveGuards) -> redirects to A -> hashA visited -> loop, blocked
```

### `RedirectChainContext`

A private interface in `Router.ts` that threads the chain state through `_redirect(target, chain)` instead of a growing parameter list:

```typescript
interface RedirectChainContext {
	visited: Set<string>; // hashes whose guards have run
	attemptedHash: string | undefined; // hash of the original navigation (for settlement)
	restoreHash: boolean; // whether to restore the hash on block
	fromRoute: string; // original source route
	fromHash: string; // original source hash
	replace: boolean | undefined; // bReplace of the navTo() that started the chain, true after a hash change
	direction: Direction | undefined; // how the browser got to the entry the target replaces (title history)
	signal: AbortSignal; // shared with the original navigation
	generation: number; // shared with the original navigation
	bag: Map<string, unknown>; // shared with the original navigation
}
```

`_applyPreflightDecision()` and `_applyDecision()` call `_startRedirectChain()` on a `redirect` decision. It seeds `visited` with the hash whose guard redirected and takes the signal, generation and direction from the `NavigationAttempt` that the callers pass in, and the bag from that navigation's guard context.

### Loop detection

`visited` holds hashes, not route names. `A(x=1) -> B -> A(x=2)` is allowed: the hashes differ, and A's guard may decide differently for other parameters. The depth cap (`MAX_REDIRECT_DEPTH = 10`) catches chains whose parameters keep changing.

After resolving the target hash, `_redirect()` checks, in order:

1. The hash is in `visited`: `Log.error("Guard redirect loop detected: <path>")`, block.
2. `visited.size > MAX_REDIRECT_DEPTH`: `Log.error("Guard redirect chain exceeded maximum depth (10): <path>")`, block.
3. Otherwise it adds the hash and evaluates the target's guards.

The origin hash is in the set because its guard already redirected away; returning there would loop. The target is added before its guards run, so a self-redirect (B -> B) is caught at once. The set lives in the chain context, not on the Router, so independent navigations never share it, and it is garbage-collected when the chain ends.

### Leave guards run on the first hop only

The first evaluation (in `navTo()` or `parse()`) already ran the leave guards. Hops pass `skipLeaveGuards: true` to `GuardPipeline.evaluate()` (through `_evaluateGuards(context, true)`), which goes straight to global and route enter guards. `context.fromRoute` keeps the original source route, so guards can still read it. An empty `fromRoute` would also skip leave guards, but it would hide that information from guards, so the option separates the two concerns.

### Guard context on a hop

| Field                              | Value                                       |
| ---------------------------------- | ------------------------------------------- |
| `toRoute`, `toHash`, `toArguments` | The route matching the target hash, per hop |
| `fromRoute`, `fromHash`            | The original source, constant               |
| `signal`, `bag`                    | Shared with the original navigation         |
| `toMeta`, `fromMeta`               | Metadata of the target and the source       |
| `ownerComponent`                   | The router's owner component                |

`_createGuardContext(routeInfo, targetHash, chain.signal, chain)` builds it.

### Applying a hop's decision

`_applyRedirectDecision()` returns at once if the chain's generation is stale. Otherwise:

- `allow`: enters `committing/redirect` and calls `navTo()` with `chain.replace`. The bypass in `navTo()` calls `super.navTo()`, the hash changes and `parse()` commits. If the URL already shows the target hash, nothing is written and `_commitAfterNavTo()` commits directly. With non-empty `componentTargetInfo` the commit waits until UI5 writes the hash (the `awaitingHash` phase), as for a `navTo()`. The committed route is the one that matches the hash, which UI5 displays.
- `block`: `_blockNavigation(chain.attemptedHash, chain.restoreHash)`.
- `redirect`: `_redirect(decision.target, chain)`, the next hop.
- `error`: `_errorNavigation(decision.error, chain.attemptedHash, chain.restoreHash)`.

### Redirect to the current hash

If the target hash equals `_currentHash`, the target's guards still run. When they allow, the navigation settles as `Redirected` without a commit: the route does not match again and no hash is written. A hash change the navigation arrived with is undone (see [Browser history](../../packages/lib/README.md#browser-history)). With `componentTargetInfo`, UI5 sets the nested components' hashes after the settlement, unless a settlement handler has moved the URL on.

### Router phase and cancellation

`_phase` stays `evaluating` for the whole chain and becomes `committing/redirect` only for the final commit. A `navTo()` during an async chain therefore goes through `_cancelPendingNavigation()`: it aborts the shared signal, bumps the generation and settles `Cancelled`. The stale chain's next decision sees the new generation and does nothing.

### Sync and async

- If every guard in the chain returns a plain value, the chain resolves synchronously through recursive `_redirect()` calls.
- From the first hop with a Promise, that hop and all later ones are async. `_applyWhenDecided()` applies the decision and settles `Error` if applying it throws.
- The generation is not bumped between hops. A bump would make the chain look superseded by itself.

## Settlement

The chain is one navigation and settles once:

| Chain outcome                   | Settlement                                 |
| ------------------------------- | ------------------------------------------ |
| Allow at the end                | `Redirected`                               |
| Block on any hop                | `Blocked`                                  |
| A guard throws                  | `Error`, with `error`                      |
| Loop detected                   | `Blocked`, `Log.error` with the chain path |
| Depth cap exceeded              | `Blocked`, `Log.error` with the chain path |
| Unknown target route            | `Blocked`, `Log.warning` with the name     |
| Target without a hash           | `Error`, `Log.error` with the name         |
| Hash changer refuses the target | `Blocked`                                  |

A target whose hash cannot be built (a missing mandatory parameter) fails like a throwing guard: `Error`, in sync and async chains, from `navTo()` and from a hash change. Nothing is thrown to the caller.

## Tests

`test/qunit/router/navigation/RedirectTargetGuards.qunit.ts` covers: the target's guards run; a block or a further redirect on a hop; loops (A -> B -> A, A -> A) and the depth cap, with the chain path in the log; async hops and a superseding navigation; the settlement of each outcome; the hop context (`toRoute` is the target, `fromRoute` the original source); leave guards on the first hop only; a redirect to the current hash; a throwing target guard; an unknown target.

## Not done: an opt-out flag

Guards on redirect targets always run. If a flag is ever needed, it belongs in the `guardRouter` manifest block (for example `evaluateRedirectGuards`).
