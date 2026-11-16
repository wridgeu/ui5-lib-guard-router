import type { GuardRouter } from "ui5/guard/router/types";
import type Text from "sap/m/Text";
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
		this.getRouter<GuardRouter>().getRoute("employees")?.attachPatternMatched(this._showMeta, this);
	}

	override onExit(): void {
		this.getRouter<GuardRouter>().getRoute("employees")?.detachPatternMatched(this._showMeta, this);
	}

	private _showMeta(): void {
		const meta = this.getRouter<GuardRouter>().getRouteMeta("employees");
		(this.byId("employeesMeta") as Text).setText(JSON.stringify(meta));
	}

	/** Navigate to the Employee detail view for a demo employee. */
	onNavToEmployee(): void {
		this.getRouter<GuardRouter>().navTo("employee", { id: "42" });
	}

	/** Update the employees route metadata at runtime and refresh the display. */
	onUpdateMeta(): void {
		const router = this.getRouter<GuardRouter>();
		router.setRouteMeta("employees", { section: "hr", requiresAuth: true, updatedAt: new Date().toISOString() });
		const meta = router.getRouteMeta("employees");
		(this.byId("employeesMeta") as Text).setText(JSON.stringify(meta));
	}

	/** Navigate back to the Home view. */
	onNavBack(): void {
		this.getRouter<GuardRouter>().navTo("home");
	}
}
