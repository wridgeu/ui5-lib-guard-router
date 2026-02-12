import Controller from "sap/ui/core/mvc/Controller";
import UIComponent from "sap/ui/core/UIComponent";
import JSONModel from "sap/ui/model/json/JSONModel";
import type { GuardRouter, LeaveGuardFn } from "ui5/ext/routing/types";
import { createHomeLeaveLogger } from "../guards";

/**
 * Controller for the Home view.
 *
 * Demonstrates controller-level guard registration as an alternative to
 * component-level guards. This pattern is useful when:
 * - The guard logic is specific to one view/controller
 * - The controller manages state that needs protection
 * - You want guard lifecycle tied to controller lifecycle
 *
 * Compare with Component.ts which shows component-level guard registration.
 * Both patterns are valid; choose based on where the guarded state lives.
 *
 * @namespace demo.app.controller
 */
export default class HomeController extends Controller {
	/** Reference to the leave guard for cleanup in onExit */
	private _leaveGuard: LeaveGuardFn | null = null;

	onInit(): void {
		// ============================================================
		// Controller-level Guard Registration (addLeaveGuard)
		// Demonstrates the standalone addLeaveGuard() API
		// Guard is registered when controller initializes
		// ============================================================
		const router = (this.getOwnerComponent() as UIComponent).getRouter() as unknown as GuardRouter;
		this._leaveGuard = createHomeLeaveLogger();
		router.addLeaveGuard("home", this._leaveGuard);
	}

	onToggleLogin(): void {
		const model = (this.getOwnerComponent() as UIComponent).getModel("auth") as JSONModel;
		const isLoggedIn = model.getProperty("/isLoggedIn");
		model.setProperty("/isLoggedIn", !isLoggedIn);
	}

	onNavToProtected(): void {
		(this.getOwnerComponent() as UIComponent).getRouter().navTo("protected");
	}

	onNavToForbidden(): void {
		(this.getOwnerComponent() as UIComponent).getRouter().navTo("forbidden");
	}

	/**
	 * Clean up the leave guard when the controller is destroyed.
	 *
	 * This is important for controller-level guards to prevent:
	 * - Memory leaks from orphaned guard references
	 * - Guards executing after their controller is gone
	 *
	 * Note: If using XMLView with viewId caching, onExit may not be called
	 * until the view is actually destroyed. Consider this for your cleanup strategy.
	 */
	onExit(): void {
		if (this._leaveGuard) {
			const router = (this.getOwnerComponent() as UIComponent).getRouter() as unknown as GuardRouter;
			router.removeLeaveGuard("home", this._leaveGuard);
			this._leaveGuard = null;
		}
	}
}
