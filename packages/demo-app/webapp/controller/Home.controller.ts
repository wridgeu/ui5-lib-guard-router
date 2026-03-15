import JSONModel from "sap/ui/model/json/JSONModel";
import type { GuardRouter, LeaveGuardFn } from "ui5/guard/router/types";
import BaseController from "./BaseController";
import { createHomeLeaveLogger } from "../guards";

/**
 * Controller for the Home view.
 *
 * @namespace demo.app.controller
 */
export default class HomeController extends BaseController {
	private _leaveGuard: LeaveGuardFn | null = null;

	override onInit(): void {
		const router = this.getRouter<GuardRouter>();
		this._leaveGuard = createHomeLeaveLogger();
		router.addLeaveGuard("home", this._leaveGuard);
	}

	onToggleLogin(): void {
		const model = this.getModel<JSONModel>("auth");
		const isLoggedIn = model.getProperty("/isLoggedIn");
		model.setProperty("/isLoggedIn", !isLoggedIn);
	}

	onNavToProtected(): void {
		this.getRouter().navTo("protected");
	}

	onNavToForbidden(): void {
		this.getRouter().navTo("forbidden");
	}

	override onExit(): void {
		if (this._leaveGuard) {
			const router = this.getRouter<GuardRouter>();
			router.removeLeaveGuard("home", this._leaveGuard);
			this._leaveGuard = null;
		}
	}
}
