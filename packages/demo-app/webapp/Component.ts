import UIComponent from "sap/ui/core/UIComponent";
import JSONModel from "sap/ui/model/json/JSONModel";
import type { GuardFn, GuardRouter } from "ui5/guard/router/types";
import RuntimeCoordinator from "./demo/RuntimeCoordinator";
import { createNavigationLogger, createAsyncPermissionGuard, createDirtyFormGuard, forbiddenGuard } from "./guards";
import { createRuntimeModel } from "./model/runtime";

/**
 * Demo application component showcasing guard registration patterns.
 *
 * @namespace demo.app
 */
export default class Component extends UIComponent {
	public static metadata = {
		manifest: "json",
		interfaces: ["sap.ui.core.IAsyncContentCreation"],
	};

	private _navigationLogger: GuardFn | null = null;

	private _runtimeCoordinator: RuntimeCoordinator | null = null;

	override init(): void {
		super.init();

		const router = this.getRouter() as GuardRouter;
		const authModel = this.getModel("auth") as JSONModel;
		const runtimeModel = createRuntimeModel();
		const formModel = new JSONModel({ isDirty: false });

		this.setModel(runtimeModel, "runtime");
		this.setModel(formModel, "form");

		this._runtimeCoordinator = new RuntimeCoordinator(runtimeModel, formModel);

		this._navigationLogger = createNavigationLogger();
		router.addGuard(this._navigationLogger);

		router.addRouteGuard("forbidden", forbiddenGuard);
		router.addRouteGuard("protected", {
			beforeEnter: createAsyncPermissionGuard(authModel),
			beforeLeave: createDirtyFormGuard(formModel),
		});

		this._runtimeCoordinator.start();
		router.initialize();
	}

	override destroy(): void {
		const router = this.getRouter() as GuardRouter;

		this._runtimeCoordinator?.destroy();
		this._runtimeCoordinator = null;

		if (this._navigationLogger) {
			router.removeGuard(this._navigationLogger);
			this._navigationLogger = null;
		}

		super.destroy();
	}
}
