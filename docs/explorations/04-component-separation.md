# Alternative 4: Component Separation (Public + Authenticated Components)

## Approach

Split the application into two separate UI5 Components:

1. A **public component** handling login/authentication
2. An **authenticated component** with the actual application

The public component loads the authenticated component only after successful authentication.

```typescript
// PublicComponent.ts
export default class PublicComponent extends UIComponent {
    init(): void {
        super.init();
        this.getRouter().initialize();
    }
}

// In the public component's LoginController:
async onLogin(): Promise<void> {
    const success = await this.authenticate();
    if (success) {
        // Dynamically load the authenticated component
        const container = this.byId("componentContainer") as ComponentContainer;
        container.setComponent(
            await Component.create({ name: "my.app.authenticated" })
        );
    }
}
```

```xml
<!-- Public component's view -->
<mvc:View xmlns="sap.m" xmlns:core="sap.ui.core" xmlns:mvc="sap.ui.core.mvc">
    <App>
        <Page id="loginPage">
            <!-- Login form -->
        </Page>
    </App>
    <core:ComponentContainer id="componentContainer" />
</mvc:View>
```

## How It Works

1. Only the public component loads initially
2. After authentication, the authenticated component is loaded dynamically
3. The authenticated component has its own router with its own routes
4. If the user is not authenticated, the authenticated component doesn't exist; its code hasn't even been loaded

## Pros

- **Strongest client-side isolation**: The authenticated component's JavaScript, views, and controllers are never loaded until authentication succeeds. A user cannot access them via DevTools.
- **SAP-recommended pattern**: @matz3 in [SAP/openui5#3094](https://github.com/SAP/openui5/issues/3094): _"One approach would be to have 2 separate components, one for the public page / auth dialog and one for the actual application."_
- **Server-side enforceable**: The server can refuse to serve the authenticated component's bundle until a valid session exists.
- **Clean separation of concerns**: Public and authenticated parts have independent routing, models, and lifecycle.

## Cons

- **Significant architectural overhead**: Two components, two manifests, two routing configurations, shared model management across component boundaries.
- **Complex deep linking**: The URL hash space must be partitioned between components. Navigating directly to `#/protected/detail/42` requires the public component to authenticate, load the authenticated component, and forward the hash.
- **Launchpad compatibility concerns**: SAP Fiori Launchpad expects one component per tile. Nested components require careful configuration.
- **Doesn't solve per-route guards**: Within the authenticated component, you still have no route-level guard mechanism. All authenticated routes are equally accessible.
- **Memory and performance**: Two full component lifecycles. The authenticated component may be large and slow to load dynamically.
- **State sharing is complex**: Sharing data between the public and authenticated components requires EventBus, shared models, or other inter-component communication patterns.

## Variant: Component Reuse with Component Routing

UI5's router supports nested component targets:

```json
{
	"routing": {
		"targets": {
			"authenticatedApp": {
				"type": "Component",
				"name": "my.app.authenticated",
				"id": "authenticatedComponent"
			}
		}
	}
}
```

This is cleaner than manual `ComponentContainer` management but still doesn't solve per-route guards within the nested component.

## When to Use

- When security requirements demand that unauthenticated users cannot access any application code (views, controllers, even JS bundles)
- When the public and authenticated parts have fundamentally different UX
- When server-side enforcement of component loading is possible
- In environments where the SAP Application Router or XSUAA can be configured to enforce component-level authorization

## Comparison with This Repository's Approach

| Aspect                | Component Separation     | `ui5.guard.router` |
| --------------------- | ------------------------ | ------------------ |
| Auth code isolation   | Strong (code not loaded) | None (UX-only)     |
| Per-route guards      | Not solved               | Full support       |
| Deep linking          | Complex                  | Simple             |
| Implementation effort | High                     | Low                |
| FLP compatibility     | Requires care            | Standard           |
| Server-side enforced  | Can be                   | Cannot be          |
| Async guard support   | N/A                      | Yes                |

## References

- [SAP/openui5#3094 comment](https://github.com/SAP/openui5/issues/3094#issuecomment-737976447): SAP recommends component separation for auth
- [SAP BTP XSUAA](https://community.sap.com/t5/technology-blogs-by-members/demystifying-approuter-xsuaa-and-idp-in-btp-cf-environment/ba-p/13517688): Server-side auth enforcement
- [SAP Application Router](https://community.sap.com/t5/technology-blogs-by-sap/sap-application-router/ba-p/13393550): Request-level auth
