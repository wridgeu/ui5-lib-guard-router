import UIComponent from "sap/ui/core/UIComponent";

/**
 * Child test component: displayed by a route of the parent, with its own guarded routes.
 * @namespace ui5.guard.router.qunit.fixtures.nested.child
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
