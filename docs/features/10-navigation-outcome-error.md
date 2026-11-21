# NavigationOutcome.Error

> **Status**: Implemented (1.4.0). Guard errors settle as `NavigationOutcome.Error`, distinct from `Blocked`.

## Context

Issue #50. A guard that throws or rejects used to settle as `NavigationOutcome.Blocked`. The app could not tell an intentional block (the guard returned `false`) from a failure (a fetch failed, a bug in the guard). These need different UX: "Access denied" is not "Something went wrong".

## Decision

Add `NavigationOutcome.Error` and an optional `error` field on `NavigationResult`. The field carries the raw thrown or rejected value (`unknown`), without a wrapper.

### Why the raw value instead of a structured envelope?

An envelope such as `{ guardIndex, phase, originalError }` was rejected:

- `guardIndex` is positional. It means nothing once guards are added or removed at runtime.
- `phase` (`"enter"` / `"leave"`) leaks pipeline internals into the public API.
- Some failures happen outside any guard (applying an async decision, a redirect target without a valid hash). They have no guard metadata, so the envelope would need a fallback shape.
- The console log already names the guard index, the guard name and the route.
- Consumers display `String(result.error)` or forward the value to an error tracker. Both need the raw value.

## Types

All changes are additive.

```typescript
// NavigationOutcome.ts
Error: "error", // @since 1.4.0

// GuardPipeline.ts
export type GuardDecision =
	| { action: "allow" }
	| { action: "block" }
	| { action: "redirect"; target: string | GuardRedirect }
	| { action: "error"; error: unknown };

// types.ts
export interface NavigationResult {
	status: NavigationOutcome;
	route: string;
	hash: string;
	error?: unknown; // present when status is Error
}
```

`library.ts` registers the imported `NavigationOutcome` object with `DataType.registerEnum`, so the new value needs no change there.

## Pipeline

`_runGuards()` and `_continueGuardsAsync()` catch a guard's error, log it with `Log.error` and re-throw it. `evaluate()` catches the re-thrown error (sync `try/catch`, async `.catch()`) and returns `{ action: "error", error }`. Because the error leaves the guard loops as an exception, no loop needs to pass a decision object through.

If the context's signal is already aborted, the catch returns `false` without logging. The navigation was cancelled, so its error is expected and settles nothing.

The other decisions are in [09, Evaluation](./09-guard-pipeline-extraction.md#evaluation). The row this feature added: a guard that throws after the signal aborted gives `{ action: "block" }` without a log.

## Router

`_errorNavigation(error, attemptedHash?, restoreHash = true)` is the counterpart of `_blockNavigation()`. It sets the phase to idle and settles `{ status: Error, route, hash, error }` through `_settleUncommitted()`. The hash is restored before the settlement fires, so handlers run on the final URL. The exception is a first navigation (nothing committed yet) on a non-empty hash: the settlement fires first, then the empty hash is restored and parsed as a navigation of its own.

Each decision switch has a `case "error"`:

- `_applyDecision()` (hash change): `_errorNavigation(decision.error, hash)`.
- `_applyPreflightDecision()` (`navTo`): `_errorNavigation(decision.error, targetHash, attempt.restoreHash)`. The preflight never changes the hash; it restores it only after superseding a pending hash change.
- `_applyRedirectDecision()` (a redirect hop, see [11](./11-guards-on-redirect-targets.md)): `_errorNavigation(decision.error, chain.attemptedHash, chain.restoreHash)`.

The pipeline turns every guard failure into a decision, so its Promise never rejects. `_applyWhenDecided()` instead guards the application of an async decision: an error thrown there is logged (`Navigation failed after its guards had settled`) and settles the navigation as `Error` if it has not settled yet. `_redirect()` reports a redirect target without a valid hash through `_errorNavigation()` itself.

`navigationSettled()`, the `navigationSettled` event and the idle replay of `_lastSettlement` pass the full `NavigationResult`, so `error` reaches them without changes.

## App usage

```typescript
const result = await router.navigationSettled();
switch (result.status) {
	case NavigationOutcome.Blocked:
		MessageToast.show("Access denied");
		break;
	case NavigationOutcome.Error:
		MessageBox.error("Navigation failed: " + String(result.error));
		break;
}
```

## Tests

- `test/qunit/unit/GuardPipelineAsync.qunit.ts`: throws and rejections give an `error` decision and are logged; `false` still gives `block`.
- `test/qunit/router/settlement/SettlementErrors.qunit.ts` and the router suites: each failure settles as `Error` with `result.error`; `false` still settles as `Blocked`; `error` is absent on other outcomes; the event and the idle replay carry it.

## Compatibility

Additive: a new enum value, a new optional field, a new decision variant. A guard that throws still keeps the previous route; only the settlement status changes from `Blocked` to `Error`.
