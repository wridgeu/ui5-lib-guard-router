# Alternative 7: Override navTo() Only

## Approach

Override the router's `navTo()` method to run guard checks before triggering navigation.

```typescript
const Router = MobileRouter.extend("custom.Router", {
	navTo: function (routeName, parameters, componentTargetInfo, replace) {
		// Run guard check before navigation
		if (!this._checkGuard(routeName)) {
			return this; // blocked
		}
		return MobileRouter.prototype.navTo.apply(this, arguments);
	},

	_checkGuard: function (routeName) {
		const guards = this._guards.get(routeName) || [];
		for (const guard of guards) {
			const result = guard({ toRoute: routeName });
			if (result !== true) return false;
		}
		return true;
	},
});
```

## How It Works

1. Application code calls `router.navTo("protected")`
2. The override intercepts the call
3. Guard functions are evaluated
4. If all guards return `true`, the original `navTo()` is called
5. If any guard blocks/redirects, the original `navTo()` is never called

## Pros

- **Guards run before hash change**: Since `navTo()` is what triggers the hash change, blocking here means the hash never changes and no history entry is created.
- **Simple implementation**: Override one method, check conditions.
- **Route name available**: Unlike HashChanger interception, you have the route name directly.
- **No view creation on block**: The target view is never loaded.

## Cons

- **Does NOT catch browser back/forward**: When the user presses the browser back button, the browser changes the hash via `popstate`. This triggers `hashChanged` then `parse()`, bypassing `navTo()` entirely. The guard never runs.
- **Does NOT catch direct URL entry**: Typing `#/protected` in the address bar also triggers `hashChanged` → `parse()`.
- **Does NOT catch `HashChanger.setHash()`**: Any code that manipulates the hash directly bypasses `navTo()`.
- **Incomplete coverage**: Only protects the `navTo()` entry point, roughly 50% of actual navigation paths.

### The Coverage Gap Visualized

```
Navigation Entry Points:
                                     navTo Override    parse Override
                                     Catches?          Catches?
router.navTo("protected")           YES               YES
browser back button                  NO                YES
browser forward button               NO                YES
user types URL in address bar        NO                YES
HashChanger.setHash("protected")     NO                YES
window.location.hash = "#protected"  NO                YES
```

## Workaround: Combining navTo + hashChanged Listener

```typescript
const Router = MobileRouter.extend("custom.Router", {
	constructor: function () {
		MobileRouter.prototype.constructor.apply(this, arguments);
		// Also listen to hashChanged for non-navTo navigations
		this.getHashChanger().attachEvent("hashChanged", this._onHashChanged, this);
	},

	navTo: function (routeName, parameters, componentTargetInfo, replace) {
		if (!this._checkGuard(routeName)) return this;
		return MobileRouter.prototype.navTo.apply(this, arguments);
	},

	_onHashChanged: function (event) {
		const newHash = event.getParameter("newHash");
		const route = this._resolveRoute(newHash);
		if (route && !this._checkGuard(route)) {
			// Must restore hash -- but the route is already being processed
			// Race condition: parse() may have already started
			this.getHashChanger().replaceHash(event.getParameter("oldHash"));
		}
	},
});
```

This introduces the exact same problems as the HashChanger interception approach (Alternative 2), plus race conditions between the `hashChanged` listener and `parse()`.

## When to Use

- All navigation is strictly through `navTo()` (no browser back, no URL entry, no hash manipulation)
- Useful as a partial solution in controlled environments (e.g., embedded iframes, kiosk mode)
- As a stepping stone before implementing full `parse()` override

## Why This Repository Chose parse() Instead

The `parse()` override was chosen specifically because it catches **all** navigation paths in a single interception point. The `navTo()` approach requires additional mechanisms (hashChanged listener) to cover the remaining paths, creating complexity without full coverage.

From `docs/implementation-approaches.md`:

> **Verdict: Rejected.** Incomplete coverage of navigation entry points.

## Comparison with This Repository's Approach

| Aspect                    | navTo Override              | `ui5.guard.router` (parse) |
| ------------------------- | --------------------------- | -------------------------- |
| Programmatic navTo        | Covered                     | Covered                    |
| Browser back/forward      | NOT covered                 | Covered                    |
| Direct URL entry          | NOT covered                 | Covered                    |
| HashChanger.setHash       | NOT covered                 | Covered                    |
| Implementation complexity | Low                         | Low-medium                 |
| Coverage                  | ~50%                        | ~100%                      |
| Race conditions           | With hashChanged workaround | None (single interception) |
| History on block          | Clean (navTo never called)  | Clean (replaceHash)        |

## References

- [SAP/openui5#3411 comment](https://github.com/SAP/openui5/issues/3411#issuecomment-1000067038): Discussion of where to place guard checks
- [docs/implementation-approaches.md](../implementation-approaches.md): Why navTo override was rejected
