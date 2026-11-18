import UIComponent from "sap/ui/core/UIComponent";
import JSONModel from "sap/ui/model/json/JSONModel";

/**
 * Reports area of the demo app: a nested component with its own guard router, displayed
 * by the `reports` route of the parent app (`demo.app`).
 *
 * @namespace demo.app.reporting
 */
export default class Component extends UIComponent {
	public static metadata = {
		manifest: "json",
		interfaces: ["sap.ui.core.IAsyncContentCreation"],
	};

	override init(): void {
		super.init();
		this.setModel(new JSONModel({ confidentialUnlocked: false }), "access");
		this.getRouter().initialize();
	}
}
