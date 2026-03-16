import JSONModel from "sap/ui/model/json/JSONModel";
import BaseController from "./BaseController";

/**
 * Controller for the Protected view.
 *
 * The enter and leave guards for this route are registered in Component.ts
 * using the object form of addRouteGuard({ beforeEnter, beforeLeave }).
 * The form model is also created and owned by the Component, showing how
 * guards can be centralized at the component level while controllers
 * focus on view logic.
 *
 * @namespace demo.app.controller
 */
export default class ProtectedController extends BaseController {
	onNavBack(): void {
		this.getRouter().navTo("home");
	}

	onClearDirtyAndNavHome(): void {
		this.getModel<JSONModel>("form").setProperty("/isDirty", false);
		this.createScenarioRunner().recordAction("Cleared dirty state and returned to Home");
		this.getRouter().navTo("home");
	}
}
