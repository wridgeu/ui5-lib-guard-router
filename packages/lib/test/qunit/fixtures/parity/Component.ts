import UIComponent from "sap/ui/core/UIComponent";
import probe from "./probe";

/**
 * Parent app of the native parity tests: its "shell" route displays a child component as a
 * routing target. The tests replace the router class and the child of the manifest per run.
 * @namespace ui5.guard.router.qunit.fixtures.parity
 */
export default class Component extends UIComponent {
	static readonly metadata = {
		manifest: "json",
		interfaces: ["sap.ui.core.IAsyncContentCreation"],
	};

	override init(): void {
		super.init();
		probe.created?.(this);
		this.getRouter().initialize();
	}
}
