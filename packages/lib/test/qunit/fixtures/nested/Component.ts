import UIComponent from "sap/ui/core/UIComponent";

/**
 * Parent test app: its "shell" route displays the child component as a routing target.
 * @namespace ui5.guard.router.qunit.fixtures.nested
 */
export default class Component extends UIComponent {
	static readonly metadata = {
		manifest: "json",
		interfaces: ["sap.ui.core.IAsyncContentCreation"],
	};

	override init(): void {
		super.init();
		this.getRouter().initialize();
	}
}
