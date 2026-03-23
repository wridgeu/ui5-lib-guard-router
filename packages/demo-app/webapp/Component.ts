import UIComponent from "sap/ui/core/UIComponent";
import JSONModel from "sap/ui/model/json/JSONModel";
import type { GuardFn, GuardRouter } from "ui5/guard/router/types";
import RuntimeCoordinator from "./demo/RuntimeCoordinator";
import { adminGuard, createAsyncPermissionGuard } from "./guards";
import { createRuntimeModel } from "./model/runtime";

/**
 * Demo application component showcasing both declarative and programmatic
 * guard patterns side by side.
 *
 * **Declarative** (manifest.json `guardRouter.guards`):
 * - Global navigation logger (`"*"`)
 * - `blocked` and `forbidden` enter guards (shorthand array syntax)
 * - `protected` leave guard (object form with `leave`)
 *
 * **Programmatic** (registered here in `init()`):
 * - `admin` redirect guard -- demonstrates `addRouteGuard()` with a sync function
 * - `protected` enter guard -- demonstrates `addRouteGuard()` with an async
 *   permission check that closes over the auth model (not possible declaratively)
 *
 * **Controller-level** (Home.controller.ts):
 * - Home leave logger -- demonstrates dynamic registration/removal via
 *   `addLeaveGuard()` / `removeLeaveGuard()` tied to controller lifecycle
 *
 * @namespace demo.app
 */
export default class Component extends UIComponent {
	public static metadata = {
		manifest: "json",
		interfaces: ["sap.ui.core.IAsyncContentCreation"],
	};

	private _runtimeCoordinator: RuntimeCoordinator | null = null;
	private _permissionGuard: GuardFn | null = null;

	override init(): void {
		super.init();

		const router = this.getRouter() as GuardRouter;
		const authModel = new JSONModel({ isLoggedIn: false });
		const runtimeModel = createRuntimeModel();
		const formModel = new JSONModel({ isDirty: false });

		this.setModel(authModel, "auth");
		this.setModel(runtimeModel, "runtime");
		this.setModel(formModel, "form");

		// Programmatic guards: these need component context (model access)
		// that declarative manifest guards don't have via closure.
		router.addRouteGuard("admin", adminGuard);
		this._permissionGuard = createAsyncPermissionGuard(authModel);
		router.addRouteGuard("protected", this._permissionGuard);

		this._runtimeCoordinator = new RuntimeCoordinator(runtimeModel, formModel);

		router.initialize();
		this._runtimeCoordinator.start(router);
	}

	override destroy(): void {
		this._runtimeCoordinator?.destroy();
		this._runtimeCoordinator = null;
		this._permissionGuard = null;

		super.destroy();
	}
}
