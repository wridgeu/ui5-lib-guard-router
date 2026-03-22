# Guards on Redirect Targets

**Issue:** [#52](https://github.com/wridgeu/ui5-lib-guard-router/issues/52)
**Status:** Implemented
**Change type:** Feature -- guards now evaluate on redirect targets with loop detection.

## Problem

When a guard redirects from route A to route B, route B's guards are skipped entirely.
The router enters the `committing/redirect` phase before calling `navTo()`, and the
re-entrant `navTo()` sees the committing phase and bypasses preflight guard evaluation.

```
User -> /admin (guard redirects to /profile)
         /profile has an onboarding guard <- SKIPPED
         Profile renders without onboarding check
```

Vue Router, Angular Router, TanStack Router, and React Router all evaluate guards on
redirect targets. This library does not. The current bypass is documented as intentional
(infinite loop risk) in `docs/reference/architecture.md`, but it is a real behavioral gap
for apps with chained authorization requirements.

## Solution: Recursive `_redirect` with Visited Set

Remove the guard bypass during redirect chains. When a guard returns a redirect, evaluate
the target route's guards before committing. Use a visited set (tracking resolved hashes)
and a depth cap to detect loops.

### Approach

The `committing/redirect` phase and its bypass in the `navTo()` override are **kept**
but only used for the **final commit step** after the entire redirect chain resolves.

Changes are localized to two files:

- **`Router.ts`** -- Refactor `_redirect()` to evaluate guards on each hop.
- **`GuardPipeline.ts`** -- Add `skipLeaveGuards` option to `evaluate()`.

No changes to `types.ts` or `NavigationOutcome.ts`. No new files.

### Redirect Chain Flow

```
evaluate(context for A) -> guard redirects to B
  _redirect(B, visited = {hashA})
    evaluate(context for B, skipLeaveGuards) -> guard redirects to C
      _redirect(C, visited = {hashA, hashB})
        evaluate(context for C, skipLeaveGuards) -> allows
          enter committing/redirect phase
          commit C
    evaluate(context for B, skipLeaveGuards) -> blocks
      _blockNavigation() -- entire chain blocked
    evaluate(context for B, skipLeaveGuards) -> redirects to A
      hashA is in visited set -> BLOCK (loop detected)
```

### New `_redirect` Signature

```typescript
private _redirect(
    target: string | GuardRedirect,
    chain: RedirectChainContext,
): void
```

The old positional parameters (`attemptedHash`, `restoreHash`) are folded into
`RedirectChainContext`. The method is always called with a chain context -- there
is no backward-compatible optional form.

### `RedirectChainContext`

Threads state through the chain without a growing parameter list. Defined as a
private interface in `Router.ts`, alongside the existing `NavigationAttempt` and
`RouterPhase` types.

```typescript
interface RedirectChainContext {
	visited: Set<string>; // hashes whose guards have been evaluated
	attemptedHash: string | undefined; // original navigation's hash (for settlement)
	restoreHash: boolean; // whether to restore hash on block
	fromRoute: string; // original source route (user's current)
	fromHash: string; // original source hash
	signal: AbortSignal; // shared signal from original navigation
	generation: number; // shared generation counter
}
```

**Visited set tracks hashes**, not route names. This is more precise:
`A(x=1) -> B -> A(x=2)` is allowed because the hashes differ and the guard for A
may make a different decision with different parameters. The depth cap catches
degenerate cases where parameters keep varying.

### Loop Detection

```typescript
const MAX_REDIRECT_DEPTH = 10;

// At the top of _redirect, two separate checks:
if (targetHash !== null && chain.visited.has(targetHash)) {
    Log.error(`Guard redirect loop detected: ${[...chain.visited, targetHash].join(" -> ")}`, ...);
    this._blockNavigation(chain.attemptedHash, chain.restoreHash);
    return;
}
if (chain.visited.size > MAX_REDIRECT_DEPTH) {
    Log.error(`Guard redirect chain exceeded maximum depth (${MAX_REDIRECT_DEPTH}): ...`, ...);
    this._blockNavigation(chain.attemptedHash, chain.restoreHash);
    return;
}
if (targetHash !== null) {
    chain.visited.add(targetHash);
}
```

### Visited Set Lifecycle

- **Created** at the call site (`_applyPreflightDecision` / `_applyDecision`) when
  the initial guard decision is "redirect". Seeded with the hash of the route whose
  guard produced the redirect (not the redirect target). This hash belongs in the set
  because its guards already ran -- returning to it would re-evaluate the same guard
  that already redirected away, creating a loop.
- **Grown** inside `_redirect`: the redirect target's hash is added before evaluating
  its guards, so a self-redirect (B -> B) is caught immediately.
- **Threaded** through recursive `_redirect` calls as part of `RedirectChainContext`.
- **Released** when the chain resolves (allow/block/loop). The `Set` is a local variable
  on the stack -- it is garbage-collected when the chain's call frames (sync) or Promise
  chain (async) complete. No manual cleanup needed.
- **Not stored** as instance state on the Router. Each redirect chain has its own
  isolated visited set. Independent navigations never share or leak state.

### Leave Guards

Leave guards run **only on the first hop**. The initial `_pipeline.evaluate()` call
(in `navTo`/`parse`) already ran leave guards as part of producing the redirect decision.
Redirect chain hops skip them.

`GuardPipeline.evaluate()` gains an optional second parameter:

```typescript
evaluate(
    context: GuardContext,
    options?: { skipLeaveGuards?: boolean },
): GuardDecision | Promise<GuardDecision>
```

When `skipLeaveGuards: true`, the pipeline skips leave guard lookup and goes straight
to global-enter -> route-enter, regardless of whether `context.fromRoute` is non-empty.
`context.fromRoute` still contains the original source route so guard functions can read
it -- the option decouples "which route is the user on" (informational, for guard logic)
from "should we run leave guards" (pipeline control). Do NOT solve this by passing an
empty `fromRoute`; that would hide context from guard functions.

### Guard Context on Redirect Hops

| Field         | Value                                          |
| ------------- | ---------------------------------------------- |
| `toRoute`     | Redirect target (changes each hop)             |
| `toHash`      | Redirect target's hash (changes each hop)      |
| `toArguments` | Redirect target's parsed parameters (each hop) |
| `fromRoute`   | Original source route (constant across chain)  |
| `fromHash`    | Original source hash (constant across chain)   |
| `signal`      | Shared AbortSignal from original navigation    |

### `_redirect` Method Body (Pseudocode)

```typescript
private _redirect(target: string | GuardRedirect, chain: RedirectChainContext): void {
    // 1. Resolve target route and hash
    const targetName = typeof target === "string" ? target : target.route;
    const targetParameters = typeof target === "string" ? {} : (target.parameters ?? {});
    const targetRoute = this.getRoute(targetName);
    // ... resolve targetHash via targetRoute.getURL(targetParameters) ...

    // 2. Loop detection (two separate checks)
    if (targetHash !== null && chain.visited.has(targetHash)) {
        Log.error(`Guard redirect loop detected: ${[...chain.visited, targetHash].join(" -> ")}`, ...);
        this._blockNavigation(chain.attemptedHash, chain.restoreHash);
        return;
    }
    if (chain.visited.size > MAX_REDIRECT_DEPTH) {
        Log.error(`Guard redirect chain exceeded maximum depth (${MAX_REDIRECT_DEPTH}): ...`, ...);
        this._blockNavigation(chain.attemptedHash, chain.restoreHash);
        return;
    }
    if (targetHash !== null) {
        chain.visited.add(targetHash);
    }

    // 3. Unknown route / unresolvable hash: attempt navTo, fall back to blocked
    if (targetHash === null) {
        // ... enter committing/redirect, call navTo, check if settlement occurred ...
        return;
    }

    // 4. Build guard context for the redirect target
    const routeInfo = this.getRouteInfoByHash(targetHash);
    const context: GuardContext = {
        toRoute: routeInfo?.name ?? "",
        toHash: targetHash,
        toArguments: routeInfo?.arguments ?? {},
        fromRoute: chain.fromRoute,    // original source, constant
        fromHash: chain.fromHash,      // original source, constant
        signal: chain.signal,          // shared signal
    };

    // 5. Evaluate guards (skip leave guards -- they already ran on first hop)
    const decision = this._pipeline.evaluate(context, { skipLeaveGuards: true });

    // 6. Handle sync result
    if (!isPromiseLike(decision)) {
        this._applyRedirectDecision(decision, target, targetHash, chain);
        return;
    }

    // 7. Handle async result with generation check
    decision
        .then((d: GuardDecision) => {
            if (chain.generation !== this._parseGeneration) return; // superseded
            this._applyRedirectDecision(d, target, targetHash, chain);
        })
        .catch((error: unknown) => {
            if (chain.generation !== this._parseGeneration) return;
            Log.error(`Guard pipeline failed during redirect chain, blocking`, String(error), ...);
            this._blockNavigation(chain.attemptedHash, chain.restoreHash);
        });
}

private _applyRedirectDecision(
    decision: GuardDecision,
    target: string | GuardRedirect,
    targetHash: string,
    chain: RedirectChainContext,
): void {
    switch (decision.action) {
        case "allow": {
            // Enter committing/redirect for the final target.
            // this.navTo() sees the committing/redirect phase and calls super.navTo()
            // directly (existing bypass), which changes the hash and triggers parse(),
            // which sees committing and calls _commitNavigation().
            const targetName = typeof target === "string" ? target : target.route;
            this._phase = { kind: "committing", hash: targetHash, route: targetName, origin: "redirect" };
            if (typeof target === "string") {
                this.navTo(target, {}, {}, true);
            } else {
                this.navTo(target.route, target.parameters ?? {}, target.componentTargetInfo, true);
            }
            // Safety net: if navTo didn't produce a settlement (e.g. unknown route
            // or redirect to current hash where HashChanger doesn't fire), handle it.
            // The redirectsToCurrentHash path is kept because the HashChanger does
            // not fire hashChanged for a same-hash navTo.
            break;
        }
        case "block":
            this._blockNavigation(chain.attemptedHash, chain.restoreHash);
            break;
        case "redirect":
            // Recurse into next hop
            this._redirect(decision.target, chain);
            break;
    }
}
```

### Router Phase During Redirect Chain

`_phase` stays as `evaluating` throughout the redirect chain. It only transitions
to `committing/redirect` for the final commit step (in `_applyRedirectDecision` on
"allow").

This is important for cancellation: if external code calls `navTo()` during an async
redirect chain, `_cancelPendingNavigation()` sees `_phase.kind === "evaluating"`,
aborts the shared signal, bumps the generation, and flushes a `Cancelled` settlement.
The async chain's `.then()` callback checks `chain.generation !== this._parseGeneration`
and discards the stale result.

### Redirect to Current Hash

When a redirect target's hash equals `_currentHash` (the user is already on the
target), the redirect target's guards are evaluated normally. If they allow, the
chain commits with `NavigationOutcome.Redirected`. The `redirectsToCurrentHash`
safety net in `_applyRedirectDecision` is kept because UI5's `HashChanger` does
not fire `hashChanged` for a same-hash `navTo()`, so the normal commit path
(parse → commitNavigation) would not trigger without it.

### Settlement

The entire chain is one logical navigation. Only one settlement is flushed:

| Chain outcome   | Settlement                                                |
| --------------- | --------------------------------------------------------- |
| Allow (end)     | `NavigationOutcome.Redirected`                            |
| Block (any hop) | `NavigationOutcome.Blocked`                               |
| Loop detected   | `NavigationOutcome.Blocked` + `Log.error` with chain path |

No intermediate settlements for redirect hops.

### Sync/Async Handling

- If all guards in the chain return plain values, the entire chain resolves
  synchronously in one tick via recursive `_redirect` calls on the call stack.
- When any guard returns a Promise, that hop and all subsequent hops become async.
  Each async hop checks `generation !== this._parseGeneration` before proceeding.
- The chain shares the original navigation's generation counter. It is **not bumped**
  between hops -- bumping would make the chain think it was superseded by itself.
- The shared `AbortSignal` is aborted when superseded, so guards doing async work
  can bail out.

### Call Sites

Both `_applyPreflightDecision` and `_applyDecision` create the initial chain context
when the guard decision is "redirect":

**Preflight path** (`_applyPreflightDecision`):

```typescript
case "redirect": {
    const { attempt } = this._phase as PhaseEvaluating;
    const visited = new Set<string>();
    visited.add(targetHash); // hash of the route whose guard redirected
    this._redirect(decision.target, {
        visited,
        attemptedHash: targetHash,
        restoreHash: false, // preflight: hash was never changed
        fromRoute: this._currentRoute,
        fromHash: this._currentHash ?? "",
        signal: attempt.controller.signal,
        generation: attempt.generation,
    });
    break;
}
```

**Parse path** (`_applyDecision`):

```typescript
case "redirect": {
    const { attempt } = this._phase as PhaseEvaluating;
    const visited = new Set<string>();
    visited.add(hash); // hash of the route whose guard redirected
    this._redirect(decision.target, {
        visited,
        attemptedHash: hash,
        restoreHash: true, // parse: hash already changed, restore on block
        fromRoute: this._currentRoute,
        fromHash: this._currentHash ?? "",
        signal: attempt.controller.signal,
        generation: attempt.generation,
    });
    break;
}
```

The signal and generation come from the `NavigationAttempt` created by `navTo()`
or `parse()` at the start of the navigation. They must be captured and threaded
into the chain context -- the `_phase` field may still be `evaluating` with the
attempt accessible.

### Architecture Doc Update

Remove or update the "Redirect targets bypass guards" section in
`docs/reference/architecture.md` and the limitations section in the library README.

## Test Cases

1. Redirect target's guards are evaluated (basic case)
2. Redirect target's guard blocks -> entire chain blocked
3. Redirect target's guard redirects again -> chain follows (A -> B -> C)
4. Redirect loop (A -> B -> A) detected and blocked
5. Max depth (10 redirects) exceeded and blocked
6. Async guards in redirect chain work correctly
7. Superseding navigation during async redirect chain cancels the chain
8. Settlement outcome is `Redirected` for successful chain, `Blocked` for failed
9. Loop detection log message includes the full chain path
10. Guard on redirect target receives correct context (toRoute = redirect target, fromRoute = original source)
11. Leave guards run only on first hop, not on each redirect hop
12. Redirect to current hash: guards evaluate, chain commits with `Redirected`
13. Guard on redirect target throws -> entire chain blocked (pipeline error handling)
14. Redirect target is unknown route -> chain blocked with warning (existing safety net)
15. Self-redirect (A -> A with same hash) detected as loop immediately

## Opt-In Configuration (Deferred)

The initial implementation is always-on (no opt-in flag). The opt-in configuration
(e.g., `evaluateRedirectGuards`) will be added once PR #49 (declarative manifest guard
configuration) is merged, since #49 introduces the declarative config surface where
this option naturally belongs.
