# Alternative 3: Conditional Rendering (No Routing for Auth State)

## Approach

Remove authentication state from the routing system entirely. Use model binding and visibility to toggle between "not logged in" and "app content" without creating any history entries.

```xml
<!-- Main.view.xml -->
<mvc:View xmlns="sap.m" xmlns:mvc="sap.ui.core.mvc">

    <!-- Gate: shown when NOT logged in -->
    <Page showHeader="false"
          visible="{= !${auth>/isLoggedIn} }">
        <IllustratedMessage
            illustrationType="sapIllus-NoData"
            title="Please Log In"
            description="Select a work center to continue" />
    </Page>

    <!-- App: shown when logged in -->
    <App id="app" visible="{= ${auth>/isLoggedIn} }">
        <!-- NavContainer with routed pages -->
    </App>

</mvc:View>
```

```typescript
// Component.ts -- simplified, no navigation for login state
init(): void {
    super.init();
    // Router handles only authenticated routes
    this.getRouter().initialize();
    // Login state changes toggle visibility via model binding
}
```

The manifest routing config only contains authenticated routes:

```json
{
	"routing": {
		"routes": [
			{ "name": "dashboard", "pattern": "", "target": "dashboard" },
			{ "name": "settings", "pattern": "settings", "target": "settings" }
		]
	}
}
```

## How It Works

1. The login gate and app content are sibling controls in the root view
2. Their `visible` property is bound to a model property (e.g., `auth>/isLoggedIn`)
3. When not logged in: gate is visible, app is hidden (but still in DOM as `display:none`)
4. When logged in: gate is hidden, app is visible
5. No `navTo()` calls, no hash changes, no history entries for login state transitions

## Pros

- **Simplest possible solution**: Model binding handles everything
- **Zero history pollution**: No navigation occurs for login/logout transitions
- **No flash**: Visibility binding is synchronous; the wrong view is never rendered
- **No dependencies**: Uses only standard UI5 binding
- **No framework extensions**: Standard `sap.m` controls

## Cons

- **Only works for binary state** (logged in / not logged in): Cannot handle multi-route guards, role-based access, or conditional access per route.
- **Not generalizable**: Each app must implement its own visibility binding
- **Routing features lost**: No deep linking to the login page, no URL history for login state
- **App content exists in DOM**: Even when hidden, the `<App>` control and its children exist in the DOM. Not a security concern (client-side code is never secure) but may use unnecessary memory.
- **No route-level guards**: If you have both a login gate AND per-route permission checks, this approach only solves the login gate. You still need guards for per-route protection.

## Variant: Custom Control (LoginGateContainer)

Encapsulate the visibility logic in a reusable custom control:

```xml
<ewmLib:LoginGateContainer
    eventChannel="ewm.workcenter"
    gateTitle="{i18n>notLoggedInTitle}">
    <App id="app" />
</ewmLib:LoginGateContainer>
```

This is described in detail in [wridgeu/ui5-poc-ewm-one-login#1](https://github.com/wridgeu/ui5-poc-ewm-one-login/issues/1) as "Approach B".

## When to Use

- Login/logout is the ONLY state that needs guarding
- You don't need per-route permission checks
- The app has a simple two-state model (authenticated vs not)
- You want the absolute minimum code change

## Comparison with This Repository's Approach

| Aspect                  | Conditional Rendering    | `ui5.guard.router`            |
| ----------------------- | ------------------------ | ----------------------------- |
| History pollution       | None                     | None (guards use replaceHash) |
| Flash of content        | None                     | None                          |
| Per-route guards        | Not supported            | Full support                  |
| Async conditions        | Not applicable           | Supported                     |
| Deep linking            | Limited                  | Full                          |
| Code complexity         | Very low                 | Low-medium                    |
| Generalizability        | Single binary state only | Any condition, any route      |
| Browser back protection | Inherent (no nav)        | Via guard re-evaluation       |

## References

- [wridgeu/ui5-poc-ewm-one-login#1](https://github.com/wridgeu/ui5-poc-ewm-one-login/issues/1): Approaches A and B
