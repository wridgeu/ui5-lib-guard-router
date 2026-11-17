import Component from "sap/ui/core/Component";
import UIComponent from "sap/ui/core/UIComponent";
import Controller from "sap/ui/core/mvc/Controller";

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

	/** Leave the nested component: "home" is a route of the parent app's router. */
	onNavHome(): void {
		const component = this.getOwnerComponent();
		const parent = component && Component.getOwnerComponentFor(component);
		if (parent instanceof UIComponent) {
			parent.getRouter().navTo("home");
		}
	}
}
