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
		this.getRouter().getRoute("employee")?.attachPatternMatched(this._showMeta, this);
	}

	override onExit(): void {
		this.getRouter().getRoute("employee")?.detachPatternMatched(this._showMeta, this);
	}

	private _showMeta(): void {
		const meta = this.getRouter().getRouteMeta("employee");
		(this.byId("employeeMeta") as Text).setText(JSON.stringify(meta));
	}

	override onNavBack(): void {
		this.navBack("employees");
	}
}
