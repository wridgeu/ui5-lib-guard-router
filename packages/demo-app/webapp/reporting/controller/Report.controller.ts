import UIComponent from "sap/ui/core/UIComponent";
import Controller from "sap/ui/core/mvc/Controller";

/**
 * Shared controller of the report detail views.
 *
 * @namespace demo.app.reporting.controller
 */
export default class ReportController extends Controller {
	onNavBack(): void {
		UIComponent.getRouterFor(this).navTo("overview");
	}
}
