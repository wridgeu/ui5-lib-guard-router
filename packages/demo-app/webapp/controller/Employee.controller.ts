import type { GuardRouter } from "ui5/guard/router/types";
import Text from "sap/m/Text";
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
		const router = this.getRouter<GuardRouter>();
		router.getRoute("employee")?.attachPatternMatched(() => {
			const meta = router.getRouteMeta("employee");
			(this.byId("employeeMeta") as Text).setText(JSON.stringify(meta));
		});
	}

	onNavBack(): void {
		this.getRouter<GuardRouter>().navTo("employees");
	}
}
