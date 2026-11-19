import Component from "sap/ui/core/Component";
import UIComponent from "sap/ui/core/UIComponent";
import Controller from "sap/ui/core/mvc/Controller";
import History from "sap/ui/core/routing/History";

/**
 * Controller for the report overview of the nested reporting component.
 *
 * @namespace demo.app.reporting.controller
 */
export default class OverviewController extends Controller {
	onNavToSales(): void {
		UIComponent.getRouterFor(this).navTo("sales");
	}

	onNavToConfidential(): void {
		UIComponent.getRouterFor(this).navTo("confidential");
	}

	/**
	 * Leave the nested component: one step back in the browser history; entered by deep
	 * link, replace the entry with "home", a route of the parent app's router.
	 */
	onNavBack(): void {
		if (History.getInstance().getPreviousHash() !== undefined) {
			window.history.go(-1);
			return;
		}
		const component = this.getOwnerComponent();
		const parent = component && Component.getOwnerComponentFor(component);
		if (!(parent instanceof UIComponent)) {
			throw new Error("The reporting component has no parent app to navigate back to");
		}
		parent.getRouter().navTo("home", {}, true);
	}
}
