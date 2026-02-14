# Research: Native UI5 NavContainer "navigate" Event with preventDefault

> **Date**: 2026-02-09
> **Context**: Investigating native UI5 approaches to preventing navigation using the NavContainer's `navigate` event, as discussed in Stack Overflow and demonstrated by boghyon.

## Summary

UI5's `sap.m.NavContainer` (which `sap.m.App` extends) fires a `navigate` event that can be intercepted to prevent page transitions by calling `event.preventDefault()`. This is a native mechanism available since UI5 1.7.1.

**Important distinction**: This event is on the **NavContainer/App control**, not on the Router. It fires when the NavContainer is about to display a different page, which happens _after_ the Router has already matched a route and instructed the Target to display a view.

**Key limitation**: This approach is synchronous-only and operates at the wrong layer — by the time the NavContainer fires `navigate`, the Router has already matched the route. It cannot prevent the hash change or route matching, only the visual page transition.

## Source References

- [Stack Overflow: Preventing router from navigating](https://stackoverflow.com/questions/29165700/preventing-router-from-navigating/29167292#29167292)
- [Plunker: Navigation prevention example by boghyon](https://embed.plnkr.co/plunk/wp6yes)
- [GitHub Issue #3411: How to interrupt/override ongoing routing?](https://github.com/SAP/openui5/issues/3411)
- [sap.m.NavContainer API — navigate event](https://sdk.openui5.org/api/sap.m.NavContainer%23events/navigate)

## The NavContainer "navigate" Event

### API Details

The `navigate` event (since 1.7.1) is fired on `sap.m.NavContainer` when navigation between two pages has been triggered, before any transition starts.

**Event parameters:**

- `from` / `fromId` — The page being navigated away from
- `to` / `toId` — The page being navigated to
- `firstTime` — Whether the target page has been shown before
- `isTo` — Forward navigation via `to()`
- `isBack` — Back navigation via `back()`
- `isBackToTop` — Navigation to root via `backToTop()`
- `isBackToPage` — Navigation to specific page via `backToPage()`
- `direction` — One of "to", "back", "backToPage", "backToTop"

From the API docs:

> "This event can be aborted by the application with preventDefault(), which means that there will be no navigation."

### Basic Pattern

```xml
<!-- App.view.xml -->
<App id="app" navigate=".onNavigate">
    <pages>
        <!-- pages here -->
    </pages>
</App>
```

```javascript
// App.controller.js
onNavigate: function(oEvent) {
    const navModel = this.getOwnerComponent().getModel("nav");
    if (navModel.getProperty("/prevent")) {
        oEvent.preventDefault();

        // Must manually restore browser history since hash already changed
        const { isBack, isBackToPage, isBackToTop } = oEvent.getParameters();
        if (isBack || isBackToPage || isBackToTop) {
            window.history.go(1);  // Undo the back navigation
        } else {
            window.history.go(-1); // Undo the forward navigation
        }
    }
}
```

### Critical Limitations

1. **Wrong layer**: The NavContainer's `navigate` event fires when the Target instructs the NavContainer to display a page. By this point:
    - The browser hash has already changed
    - The Router has matched the route and fired `beforeRouteMatched`
    - The Target has resolved the view to display

    By calling `preventDefault()`, you stop the page transition in the NavContainer, but the route has technically already matched.

2. **Manual history management**: Since the browser hash has already changed, you must manually call `window.history.go()` to restore the previous URL.

3. **Synchronous only**: The check must complete synchronously. No async permission checks.

## Router Events (What They Can't Do)

The Router has a `beforeRouteMatched` event (since 1.46.1), but unlike NavContainer's `navigate` event, it does not have `allowPreventDefault: true` in its metadata. The event is informational — it fires "before the corresponding target is loaded and placed" but provides no mechanism to abort the navigation:

```javascript
// beforeRouteMatched is informational only — no preventDefault support
router.attachBeforeRouteMatched(function (oEvent) {
	// You can read route info here, but cannot prevent navigation
	console.log("About to display route:", oEvent.getParameter("name"));
});
```

To actually prevent navigation, you must either:

- Check conditions before calling `navTo()` (application-level)
- Use NavContainer's `navigate` event (limited, as discussed)
- Override `Router.parse()` (what this library does)

## Comparison with This Library

| Aspect                  | Native NavContainer `navigate`   | This Library (`ui5.guard.router`)   |
| ----------------------- | -------------------------------- | ----------------------------------- |
| Intercept layer         | NavContainer (after route match) | Router.parse() (before route match) |
| Prevents route matching | No                               | Yes                                 |
| Prevents hash change    | No (must restore manually)       | Yes (automatic)                     |
| Async support           | No                               | Yes (guards can return Promises)    |
| Route-specific guards   | No (check page ID manually)      | Built-in (`addRouteGuard`)          |
| Leave guards            | No                               | Built-in (`addLeaveGuard`)          |
| Redirect support        | Manual (`navTo` after prevent)   | Built-in (return route name)        |
| History management      | Manual (`history.go`)            | Automatic                           |
| AbortSignal for cleanup | No                               | Yes                                 |

## The `beforeRouteMatched` Discussion

In GitHub issue #3411, Florian Vogt (UI5 team member) discussed the possibility of adding `preventDefault()` support to `beforeRouteMatched`:

```javascript
// Proposed (not implemented) API
router.attachBeforeRouteMatched(
	function (oEvent) {
		if (!this.hasAccess()) {
			oEvent.preventDefault();
		}
	}.bind(this),
);
```

**Status**: This was discussed but noted to have the synchronous limitation — "would require the hasAccess method to return synchronously" without async backend calls. As of UI5 1.144.0, `beforeRouteMatched` still does not support `preventDefault()`.

## When to Use the Native Approach

The NavContainer `navigate` event approach may be acceptable when:

- You only need synchronous checks (no backend calls)
- You're okay with the route technically matching (just hiding the view)
- You can tolerate brief content flashes
- You want to avoid additional library dependencies

For production applications requiring:

- Async permission checks
- True navigation prevention (before route matching)
- Clean history management
- No content flashes

...consider using this library or a similar Router-level interception approach.

## Why This Library Exists

The native `navigate` event approach has fundamental architectural limitations:

1. **Too late in the pipeline**: By the time NavContainer fires `navigate`, the damage is done — hash changed, route matched, views potentially created.

2. **No async support**: Modern apps often need to check permissions via API calls.

3. **Manual everything**: History management, redirect logic, leave guard implementation — all manual.

4. **Wrong abstraction**: NavContainer is a UI control for page transitions. Navigation guards belong at the routing layer.

This library (`ui5.guard.router`) addresses all of these by intercepting at `Router.parse()`, the single entry point for all navigation, before any route matching begins.
