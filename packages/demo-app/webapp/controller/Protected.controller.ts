import Controller from "sap/ui/core/mvc/Controller";
import UIComponent from "sap/ui/core/UIComponent";
import JSONModel from "sap/ui/model/json/JSONModel";
import type { GuardRouter, LeaveGuardFn } from "ui5/ext/routing/types";
import { createDirtyFormGuard } from "../guards";

/**
 * @namespace demo.app.controller
 */
export default class ProtectedController extends Controller {
	private _leaveGuard!: LeaveGuardFn;

	onInit(): void {
		const formModel = new JSONModel({ isDirty: false });
		this.getView()!.setModel(formModel, "form");

		const router = (this.getOwnerComponent() as UIComponent).getRouter() as unknown as GuardRouter;
		this._leaveGuard = createDirtyFormGuard(formModel);
		router.addLeaveGuard("protected", this._leaveGuard);
	}

	onNavBack(): void {
		(this.getOwnerComponent() as UIComponent).getRouter().navTo("home");
	}

	onExit(): void {
		const router = (this.getOwnerComponent() as UIComponent).getRouter() as unknown as GuardRouter;
		router.removeLeaveGuard("protected", this._leaveGuard);
	}
}
