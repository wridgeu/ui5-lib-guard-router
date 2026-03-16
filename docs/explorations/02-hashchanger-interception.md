# Alternative 2: HashChanger Interception

## Approach

Intercept hash changes at the `HashChanger` level, the absolute earliest point before the router even receives the new hash.

```typescript
// Component.ts
init(): void {
    super.init();

    const hashChanger = HashChanger.getInstance();
    const originalSetHash = hashChanger.setHash.bind(hashChanger);
    const originalReplaceHash = hashChanger.replaceHash.bind(hashChanger);

    hashChanger.setHash = (hash: string) => {
        if (this._shouldBlock(hash)) {
            // Don't set the hash at all
            return;
        }
        originalSetHash(hash);
    };

    hashChanger.replaceHash = (hash: string) => {
        if (this._shouldBlock(hash)) {
            return;
        }
        originalReplaceHash(hash);
    };

    this.getRouter().initialize();
}

private _shouldBlock(hash: string): boolean {
    // Check permissions based on the hash pattern
    if (hash.startsWith("protected") && !this.isLoggedIn()) {
        return true;
    }
    return false;
}
```

A more sophisticated variant intercepts at the `hashChanged` event level:

```typescript
const hashChanger = HashChanger.getInstance();

// Override fireHashChanged to intercept before router receives it
const originalFire = hashChanger.fireHashChanged.bind(hashChanger);
hashChanger.fireHashChanged = (newHash: string, oldHash: string) => {
	if (this._guardCheck(newHash, oldHash)) {
		originalFire(newHash, oldHash);
	} else {
		// Restore old hash silently
		window.location.hash = oldHash ? "#" + oldHash : "";
	}
};
```

## How It Works

1. Monkey-patches `HashChanger` methods
2. Intercepts hash changes before they reach any router
3. Can block or modify the hash before the router's `parse()` is called

## Pros

- Intercepts at the absolute earliest point, before any router processing
- No view creation, no events, no flash
- Can work with any router (standard, mobile, custom)
- Can intercept both programmatic navigation and browser events

## Cons

- **HashChanger is a singleton**: Monkey-patching affects ALL routers in the application. In Fiori launchpad scenarios with multiple apps/components, this is dangerous.
- **Breaks encapsulation**: @jversignify noted in [SAP/openui5#3411](https://github.com/SAP/openui5/issues/3411#issuecomment-1005815277): _"From an encapsulation point of view, this approach is bad practice, but I don't see an alternative."_
- **Fragile across versions**: HashChanger internals have changed across UI5 versions. Method signatures, event names, and internal state management are not guaranteed stable.
- **No route awareness**: The HashChanger only knows about raw hash strings, not route names. You must parse route patterns yourself to make decisions.
- **Complex cleanup**: When the component is destroyed, you must restore the original methods. If multiple components monkey-patch the same methods, cleanup order matters.
- **Doesn't catch browser back/forward in all cases**: `history.back()` fires `popstate` which eventually reaches `hashChanged`, but the hash has already changed in the URL bar by the time your interceptor runs.

## Cross-Application Navigation Variant

@jversignify's approach for SAP Fiori Launchpad inter-app navigation:

```javascript
oXAppNavService = sap.ushell.Container.getService("CrossApplicationNavigation");
oXAppNavService.toExternalOriginal = oXAppNavService.toExternal;
oXAppNavService.toExternal = function (oArgs, oComponent) {
	if (confirm("Navigate away? Unsaved changes will be lost.")) {
		oXAppNavService.toExternalOriginal(oArgs, oComponent);
	}
};
```

This is a variant of the same approach applied to FLP cross-app navigation rather than intra-app routing.

## When to Use

- When you need to intercept ALL navigation including cross-component
- As a last resort when no router-level solution is available
- For "dirty form" protection across the entire application
- When you explicitly control the entire application lifecycle (no FLP, no multi-component scenarios)

## Comparison with This Repository's Approach

| Aspect              | HashChanger Interception      | `ui5.guard.router`                     |
| ------------------- | ----------------------------- | -------------------------------------- |
| Interception point  | Before router                 | Inside router (`parse()`)              |
| Scope               | All routers (global)          | Single router instance                 |
| Route awareness     | Must parse manually           | Route name available in context        |
| Component isolation | Poor (singleton)              | Good (per-component)                   |
| Cleanup             | Complex (restore originals)   | Automatic (router.destroy)             |
| API stability       | Internal APIs                 | Internal API (parse), but less fragile |
| Async support       | Difficult (sync interception) | Native (generation counter)            |
| FLP compatibility   | Risky                         | Safe (scoped to own router)            |

## References

- [SAP/openui5#3411 comment](https://github.com/SAP/openui5/issues/3411#issuecomment-1005815277): @jversignify's CrossApplicationNavigation interception
- [SAP/openui5#3411 comment](https://github.com/SAP/openui5/issues/3411#issuecomment-1012948097): UI5 team acknowledges HashChanger override as "bad practice"
