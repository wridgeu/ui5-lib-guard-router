import UIComponent from "sap/ui/core/UIComponent";
import JSONModel from "sap/ui/model/json/JSONModel";

/**
 * Reports area of the demo app: a nested component with its own guard router.
 *
 * The parent app (`demo.app`) displays it through a routing target of type
 * `Component` and gives its router the hash prefix `reports`. Routes and guards
 * are declared in this component's own manifest; the guard reads the `access`
 * model through `context.ownerComponent`, which is this component.
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
