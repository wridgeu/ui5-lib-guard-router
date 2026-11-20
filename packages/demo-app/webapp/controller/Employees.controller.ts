import JSONModel from "sap/ui/model/json/JSONModel";
import BaseController from "./BaseController";

/**
 * Controller for the Employees view.
 *
 * Demonstrates `getRouteMeta()` and `setRouteMeta()` for reading and
 * updating route metadata at runtime.
 *
 * @namespace demo.app.controller
 */
export default class EmployeesController extends BaseController {
	override onInit(): void {
		this.getRouter().getRoute("employees")?.attachPatternMatched(this._showMeta, this);
	}

	override onExit(): void {
		this.getRouter().getRoute("employees")?.detachPatternMatched(this._showMeta, this);
	}

	private _showMeta(): void {
		const meta = this.getRouter().getRouteMeta("employees");
		this.getModel("runtime", JSONModel).setProperty("/employeesMeta", JSON.stringify(meta));
	}

	/** Navigate to the Employee detail view for a demo employee. */
	onNavToEmployee(): void {
		this.getRouter().navTo("employee", { id: "42" });
	}

	/** Update the employees route metadata at runtime and refresh the display. */
	onUpdateMeta(): void {
		this.getRouter().setRouteMeta("employees", {
			section: "hr",
			requiresAuth: true,
			updatedAt: new Date().toISOString(),
		});
		this._showMeta();
	}
}
