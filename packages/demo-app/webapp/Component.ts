import UIComponent from "sap/ui/core/UIComponent";
import JSONModel from "sap/ui/model/json/JSONModel";
import type { GuardRouter, GuardFn } from "ui5/guard/router/types";
import { createNavigationLogger, createAsyncPermissionGuard, createDirtyFormGuard, forbiddenGuard } from "./guards";

/**
 * Demo application component.
 *
 * @namespace demo.app
 */
export default class Component extends UIComponent {
	public static metadata = {
		manifest: "json",
		interfaces: ["sap.ui.core.IAsyncContentCreation"],
	};

	private _navigationLogger: GuardFn | null = null;

	override init(): void {
		super.init();

		const router = this.getRouter() as GuardRouter;
		const authModel = this.getModel("auth") as JSONModel;

		const formModel = new JSONModel({ isDirty: false });
		this.setModel(formModel, "form");

		this._navigationLogger = createNavigationLogger();
		router.addGuard(this._navigationLogger);
		router.addRouteGuard("forbidden", forbiddenGuard);
		router.addRouteGuard("protected", {
			beforeEnter: createAsyncPermissionGuard(authModel),
			beforeLeave: createDirtyFormGuard(formModel),
		});

		router.initialize();
	}

	override destroy(): void {
		const router = this.getRouter() as GuardRouter;

		if (this._navigationLogger) {
			router.removeGuard(this._navigationLogger);
			this._navigationLogger = null;
		}

		super.destroy();
	}
}
