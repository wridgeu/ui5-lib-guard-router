import JSONModel from "sap/ui/model/json/JSONModel";
import type { GuardRouter, LeaveGuardFn } from "ui5/guard/router/types";
import BaseController from "./BaseController";
import { createHomeLeaveLogger } from "../guards";

/**
 * Controller for the Home view.
 *
 * Demonstrates controller-level guard registration as an alternative to
 * the component-level guards shown in Component.ts. This pattern is useful when:
 * - The guard logic is specific to one view or controller.
 * - The controller manages state that needs protection.
 * - You want the guard lifecycle tied to the controller lifecycle.
 *
 * @namespace demo.app.controller
 */
export default class HomeController extends BaseController {
	/** Reference to the leave guard for cleanup in onExit. */
	private _leaveGuard: LeaveGuardFn | null = null;

	override onInit(): void {
		// Register a standalone leave guard via addLeaveGuard().
		// The guard is registered when the controller initializes and
		// removed when it is destroyed (see onExit below).
		const router = this.getRouter<GuardRouter>();
		this._leaveGuard = createHomeLeaveLogger();
		router.addLeaveGuard("home", this._leaveGuard);
	}

	onToggleLogin(): void {
		const model = this.getModel<JSONModel>("auth");
		const isLoggedIn = model.getProperty("/isLoggedIn");
		model.setProperty("/isLoggedIn", !isLoggedIn);
		this.getDemoScenarioRunner().recordAction(isLoggedIn ? "User logged out" : "User logged in");
	}

	onNavToProtected(): void {
		this.getDemoScenarioRunner().recordAction('Triggered router.navTo("protected")');
		this.getRouter().navTo("protected");
	}

	onNavToForbidden(): void {
		this.getDemoScenarioRunner().recordAction('Triggered router.navTo("forbidden")');
		this.getRouter().navTo("forbidden");
	}

	onDirectHashToProtected(): void {
		this.getDemoScenarioRunner().goToProtectedByHash();
	}

	onDirectHashToForbidden(): void {
		this.getDemoScenarioRunner().goToForbiddenByHash();
	}

	onDirectHashToMissing(): void {
		this.getDemoScenarioRunner().goToMissingRouteByHash();
	}

	onRapidHashSequence(): void {
		this.getDemoScenarioRunner().runRapidHashSequence();
	}

	/**
	 * Clean up the leave guard when the controller is destroyed.
	 *
	 * Important for controller-level guards to prevent:
	 * - Memory leaks from orphaned guard references.
	 * - Guards executing after their controller is gone.
	 *
	 * Note: with XMLView caching (viewId), onExit may not fire until the
	 * view is actually destroyed. Keep this in mind for your cleanup strategy.
	 */
	override onExit(): void {
		if (this._leaveGuard) {
			const router = this.getRouter<GuardRouter>();
			router.removeLeaveGuard("home", this._leaveGuard);
			this._leaveGuard = null;
		}
	}
}
