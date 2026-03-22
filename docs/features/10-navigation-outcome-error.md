# NavigationOutcome.Error

## Context

Issue #50: distinguish guard errors from intentional blocks.

When a guard throws (sync) or rejects (async), the pipeline catches the error, logs it, and returns `{ action: "block" }`. The settlement outcome is `NavigationOutcome.Blocked`. The application cannot distinguish between:

- **Intentional block**: guard returned `false` (user not authorized)
- **Guard failure**: guard threw an error (fetch failed, bug in guard code)

These require different UX. "Access denied" is not "something went wrong."

## Decision

Add `NavigationOutcome.Error` to the enum and an optional `error` field on `NavigationResult`. The error field carries the raw thrown/rejected value (`unknown`) — no wrapping or structured envelope.

### Why raw passthrough (`error?: unknown`) instead of a structured envelope?

A structured envelope (e.g., `{ guardIndex, phase, originalError }`) was considered but rejected:

- `guardIndex` is positional and fragile — meaningless if guards are added/removed dynamically
- `phase` (`"enter"` / `"leave"`) leaks pipeline internals into the public API
- The Router's `.catch()` handlers in `navTo()` and `parse()` catch pipeline promise failures where no guard metadata is available, requiring a fallback shape that undermines the structure
- Console logging already provides full diagnostics (guard index, phase, route) for debugging
- The consumer's typical action is `String(result.error)` for display or forwarding to an error tracking service — both need the raw value

## Type changes

### NavigationOutcome

`packages/lib/src/NavigationOutcome.ts`

```typescript
const NavigationOutcome = Object.freeze({
	Committed: "committed",
	Bypassed: "bypassed",
	Blocked: "blocked",
	Redirected: "redirected",
	Cancelled: "cancelled",
	Error: "error", // NEW
});
```

### GuardDecision

`packages/lib/src/GuardPipeline.ts`

New variant added to the discriminated union:

```typescript
export type GuardDecision =
	| { action: "allow" }
	| { action: "block" }
	| { action: "redirect"; target: string | GuardRedirect }
	| { action: "error"; error: unknown }; // NEW
```

### NavigationResult

`packages/lib/src/types.ts`

```typescript
export interface NavigationResult {
	status: NavigationOutcome;
	route: string;
	hash: string;
	error?: unknown; // NEW — present when status is Error
}
```

All changes are additive. No existing types change shape.

## GuardPipeline changes

### File

`packages/lib/src/GuardPipeline.ts`

### Error decision instead of silent block

The pipeline currently catches guard errors and returns `false`, which `evaluate()` maps to `{ action: "block" }`. The three catch blocks change to return `{ action: "error", error }` directly — a new variant of `GuardDecision`.

**`_runGuards()` catch block** — sync enter guard throws:

Currently returns `false`. Changes to return `{ action: "error", error }`. Return type widens from `GuardResult` to `GuardResult | GuardDecision` (specifically the error variant).

**`_runLeaveGuards()` catch block** — sync leave guard throws:

Currently returns `false` (`boolean`). Changes to return `{ action: "error", error }`. Return type widens from `boolean` to `boolean | GuardDecision`.

**`_continueGuardsAsync()` catch block** — async guard throws/rejects:

Currently returns `false`. Changes to return `{ action: "error", error }`. The existing `!context.signal.aborted` check is preserved — when the signal is already aborted, the error is expected and the method returns `false` (plain block), not an error decision. This keeps the existing behavior where cancelled navigations don't surface as errors.

### `evaluate()` changes

Both the leave-guard and enter-guard result paths need the same passthrough logic: if the result already has an `action` property (i.e., it is a `GuardDecision`), return it directly instead of mapping it.

**Leave-guard path:** The sync check `if (leaveResult !== true) return { action: "block" }` and the async `.then` callback `if (allowed !== true) return { action: "block" }` must first check whether the result is already a `GuardDecision` (the error variant) and pass it through. Without this, a leave-guard error decision would be silently converted to a plain block.

**Enter-guard path:** The `processEnterResult` function that maps `true`/`false`/`string`/`GuardRedirect` to decisions must also check for an existing `GuardDecision` and pass it through.

Updated result normalization:

| Guard returns / pipeline catches | Pipeline decision                          |
| -------------------------------- | ------------------------------------------ |
| `true`                           | `{ action: "allow" }`                      |
| `false`                          | `{ action: "block" }`                      |
| non-empty string                 | `{ action: "redirect", target: <string> }` |
| `GuardRedirect` object           | `{ action: "redirect", target: <object> }` |
| any other value                  | logs warning, `{ action: "block" }`        |
| guard throws/rejects             | `{ action: "error", error: <thrown> }`     |
| guard throws after signal abort  | `{ action: "block" }` (unchanged)          |

### Logging

`Log.error()` calls stay in all catch blocks. Errors are still logged to the console regardless of whether the decision is `"error"` or `"block"` (abort case).

## Router changes

### File

`packages/lib/src/Router.ts`

### New method: `_errorNavigation()`

```typescript
private _errorNavigation(error: unknown, attemptedHash?: string, restoreHash = true): void
```

Parallel to `_blockNavigation()`. Same structure:

- Clears phase to idle
- Optionally restores browser hash to previous state
- Flushes settlement with `{ status: NavigationOutcome.Error, route, hash, error }`

### `_applyDecision()` and `_applyPreflightDecision()`

Add `case "error"` to the existing switch on `decision.action`:

- `_applyDecision()`: calls `_errorNavigation(decision.error, hash)` (with default `restoreHash: true`)
- `_applyPreflightDecision()`: calls `_errorNavigation(decision.error, targetHash, false)` (hash was never changed in preflight)

### `.catch()` handlers in `navTo()` and `parse()`

These currently call `_blockNavigation()` when the pipeline promise fails. They change to call `_errorNavigation()` instead — a pipeline promise rejection is an error, not an intentional block.

### Unchanged

- `navigationSettled()` — already passes through the full `NavigationResult`, the new `error` field flows naturally
- `navigationSettled` event — same, carries the full result
- `_lastSettlement` — stores full `NavigationResult`, idle replay returns Error status with error field when the last settlement was an error
- `_blockNavigation()` — unchanged, still used for intentional blocks
- All other Router methods and state management

## library.ts

### File

`packages/lib/src/library.ts`

The `DataType.registerEnum` call passes the imported `NavigationOutcome` object, so the new `Error: "error"` value added in `NavigationOutcome.ts` flows through automatically. No code change in `library.ts` itself — verify the new value is registered by confirming the import chain.

## App usage

```typescript
const result = await router.navigationSettled();
switch (result.status) {
	case NavigationOutcome.Committed:
		break;
	case NavigationOutcome.Blocked:
		MessageToast.show("Access denied");
		break;
	case NavigationOutcome.Error:
		MessageBox.error("Navigation failed: " + String(result.error));
		break;
}
```

## Testing

### Existing test updates

Tests in `Router.qunit.ts` and `GuardPipeline.qunit.ts` that currently assert `NavigationOutcome.Blocked` when a guard throws need updating to assert `NavigationOutcome.Error` instead.

### New test cases

**GuardPipeline tests** (`packages/lib/test/qunit/GuardPipeline.qunit.ts`):

1. Sync enter guard that throws → `{ action: "error", error: <thrown> }`
2. Async enter guard that rejects → `{ action: "error", error: <rejected> }`
3. Sync leave guard that throws → `{ action: "error", error: <thrown> }`
4. Guard returning `false` → `{ action: "block" }` (regression — not Error)
5. Guard error after signal abort → `{ action: "block" }` (unchanged behavior)

**Router tests** (`packages/lib/test/qunit/Router.qunit.ts`):

6. Sync guard throw → `NavigationOutcome.Error` with error on result
7. Async guard reject → `NavigationOutcome.Error` with error on result
8. Leave guard throw → `NavigationOutcome.Error` with error on result
9. Guard returning `false` → `NavigationOutcome.Blocked` (regression)
10. `result.error` is `undefined` for non-error settlements (Committed, Blocked, Redirected, etc.)
11. `navigationSettled` event carries the error field
12. Idle replay after error → returns Error status with error

## Scope

- Additive change: new enum value, new optional field, new decision variant
- No breaking changes to existing API
- Existing guards and settlement consumers continue to work unchanged
- Guards that throw still block navigation (same behavior), just with a different settlement status

## Dependencies

None. Built on the extracted `GuardPipeline` from #48.
