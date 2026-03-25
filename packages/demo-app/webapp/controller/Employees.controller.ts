import type { GuardRouter } from "ui5/guard/router/types";
import Text from "sap/m/Text";
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
		const router = this.getRouter<GuardRouter>();
		router.getRoute("employees")?.attachPatternMatched(() => {
			const meta = router.getRouteMeta("employees");
			(this.byId("employeesMeta") as Text).setText(JSON.stringify(meta));
		});
	}

	onNavToEmployee(): void {
		this.getRouter<GuardRouter>().navTo("employee", { id: "42" });
	}

	onUpdateMeta(): void {
		const router = this.getRouter<GuardRouter>();
		router.setRouteMeta("employees", { section: "hr", requiresAuth: true, updatedAt: new Date().toISOString() });
		const meta = router.getRouteMeta("employees");
		(this.byId("employeesMeta") as Text).setText(JSON.stringify(meta));
	}

	onNavBack(): void {
		this.getRouter<GuardRouter>().navTo("home");
	}
}
