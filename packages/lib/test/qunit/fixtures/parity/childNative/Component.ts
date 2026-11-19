import UIComponent from "sap/ui/core/UIComponent";
import probe from "../probe";

/**
 * Child component of the native parity tests: routed by the native sap.m.routing.Router.
 * @namespace ui5.guard.router.qunit.fixtures.parity.childNative
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
