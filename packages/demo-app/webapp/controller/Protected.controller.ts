import Controller from "sap/ui/core/mvc/Controller";
import UIComponent from "sap/ui/core/UIComponent";

/**
 * Controller for the Protected view.
 *
 * Note: The leave guard for this route is registered in Component.ts using the
 * object form of addRouteGuard({ beforeEnter, beforeLeave }). The form model
 * is also created and owned by the Component, demonstrating how guards can be
 * centralized at the component level while controllers focus on view logic.
 *
 * @namespace demo.app.controller
 */
export default class ProtectedController extends Controller {
	onNavBack(): void {
		(this.getOwnerComponent() as UIComponent).getRouter().navTo("home");
	}
}
