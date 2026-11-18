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
		this.getRouter().getRoute("employees")?.attachPatternMatched(this._showMeta, this);
	}

	override onExit(): void {
		this.getRouter().getRoute("employees")?.detachPatternMatched(this._showMeta, this);
	}

	private _showMeta(): void {
		const meta = this.getRouter().getRouteMeta("employees");
		(this.byId("employeesMeta") as Text).setText(JSON.stringify(meta));
	}

	/** Navigate to the Employee detail view for a demo employee. */
	onNavToEmployee(): void {
		this.getRouter().navTo("employee", { id: "42" });
	}

	/** Update the employees route metadata at runtime and refresh the display. */
	onUpdateMeta(): void {
		const router = this.getRouter();
		router.setRouteMeta("employees", { section: "hr", requiresAuth: true, updatedAt: new Date().toISOString() });
		const meta = router.getRouteMeta("employees");
		(this.byId("employeesMeta") as Text).setText(JSON.stringify(meta));
	}
}
