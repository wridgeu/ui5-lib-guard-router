import type { GuardRouter } from "ui5/guard/router/types";
import type Text from "sap/m/Text";
import BaseController from "./BaseController";

/**
 * Controller for the Employee detail view.
 *
 * Demonstrates inherited route metadata via `pattern-tree` inheritance.
 * The employee route inherits metadata from the parent employees route
 * because its pattern (`employees/{id}`) extends the parent pattern (`employees`).
 *
 * @namespace demo.app.controller
 */
export default class EmployeeController extends BaseController {
	override onInit(): void {
		this.getRouter<GuardRouter>().getRoute("employee")?.attachPatternMatched(this._showMeta, this);
	}

	override onExit(): void {
		this.getRouter<GuardRouter>().getRoute("employee")?.detachPatternMatched(this._showMeta, this);
	}

	private _showMeta(): void {
		const meta = this.getRouter<GuardRouter>().getRouteMeta("employee");
		(this.byId("employeeMeta") as Text).setText(JSON.stringify(meta));
	}

	/** Navigate back to the Employees list. */
	onNavBack(): void {
		this.getRouter<GuardRouter>().navTo("employees");
	}
}
