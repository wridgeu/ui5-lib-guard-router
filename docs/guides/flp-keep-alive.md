# Keep-alive apps in the Fiori launchpad: dirty-state provider

A component that deregisters its dirty-state provider while the launchpad keeps it hidden. How the launchpad hides and shows a kept app: [Keep-alive apps](../../packages/lib/README.md#keep-alive-apps).

The launchpad asks every registered provider on each navigation, also the provider of a hidden app embedded in the launchpad page. The user is then asked about unsaved data of an app they are not in. Deregister the provider while the app is hidden.

The example needs `"keepAlive": { "supported": true }` in the manifest. Without it, UI5 does not call `onDeactivate()` and `onActivate()`, and the provider stays registered. It uses `sap/ushell/navigation/DirtyState` (SAPUI5 1.146 and later); before 1.146 the same two functions are on `sap/ushell/Container`.

```typescript
import UIComponent from "sap/ui/core/UIComponent";
import DirtyState from "sap/ushell/navigation/DirtyState";
import type JSONModel from "sap/ui/model/json/JSONModel";

type DirtyStateProvider = (context?: { isCrossAppNavigation?: boolean }) => boolean;

export default class Component extends UIComponent {
	public static metadata = { manifest: "json" };

	// No initializer: it would run after init(), which the UIComponent constructor calls.
	private _dirtyProvider?: DirtyStateProvider;

	override init(): void {
		super.init();
		const form = this.getModel("form") as JSONModel;
		this._dirtyProvider = (context) =>
			context?.isCrossAppNavigation !== false && form.getProperty("/isDirty") === true;
		this.onActivate();
		this.getRouter().initialize();
	}

	// Hidden: the launchpad would still ask the provider when the user navigates between other apps.
	override onDeactivate(): void {
		if (this._dirtyProvider) DirtyState.deregisterDirtyStateProvider(this._dirtyProvider);
	}

	override onActivate(): void {
		if (this._dirtyProvider) DirtyState.registerDirtyStateProvider(this._dirtyProvider);
	}

	override exit(): void {
		this.onDeactivate();
	}
}
```

> [!WARNING]
> `UIComponent` calls `init()` from its constructor. TypeScript class field initializers run after that constructor and overwrite what `init()` stored: with `private _dirtyProvider: DirtyStateProvider | null = null`, `onDeactivate()` and `exit()` find nothing to deregister. The same applies to guards that `init()` registers and `exit()` removes. Declare such fields without an initializer: `ui5-tooling-transpile` (Babel 7, `allowDeclareFields: false`) emits nothing for them. tsc with `useDefineForClassFields` (the default from target ES2022) and Babel with `allowDeclareFields: true` still emit them as `undefined`; there, write `declare private _dirtyProvider: DirtyStateProvider | undefined;`, which Babel 7 with its default options rejects.

An app that the launchpad runs in an iframe is hidden and shown the same way, but its provider is asked by the app runtime inside the iframe, not by the shell, see [Keep-alive in an iframe](../reference/architecture.md#keep-alive-in-an-iframe). `packages/demo-app/test/flp/flp-iframe-keep-alive.e2e.ts` runs the demo app that way. The launchpad internals are in [FLP Integration, Keep-alive](../reference/architecture.md#keep-alive).
