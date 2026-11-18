import UIComponent from "sap/ui/core/UIComponent";
import Controller from "sap/ui/core/mvc/Controller";
import History from "sap/ui/core/routing/History";

/**
 * Shared controller of the report detail views.
 *
 * @namespace demo.app.reporting.controller
 */
export default class ReportController extends Controller {
	/** One step back in the browser history; entered by deep link, replace the entry with the overview. */
	onNavBack(): void {
		if (History.getInstance().getPreviousHash() !== undefined) {
			window.history.go(-1);
		} else {
			UIComponent.getRouterFor(this).navTo("overview", {}, true);
		}
	}

	onNavToOverview(): void {
		UIComponent.getRouterFor(this).navTo("overview");
	}
}
