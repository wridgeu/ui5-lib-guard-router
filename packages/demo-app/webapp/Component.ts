import UIComponent from "sap/ui/core/UIComponent";
import JSONModel from "sap/ui/model/json/JSONModel";
import type { GuardRouter } from "ui5/guard/router/types";
import RuntimeCoordinator from "./demo/RuntimeCoordinator";
import { createRuntimeModel } from "./model/runtime";

/**
 * Demo application component showcasing declarative and programmatic guard patterns.
 *
 * Primary guards (global logger, route enter/leave guards) are declared in
 * `manifest.json` under `sap.ui5.routing.config.guardRouter.guards`. The
 * component only sets up runtime infrastructure (models, coordinator) and
 * calls `router.initialize()`.
 *
 * Controller-level guards (e.g. Home leave logger) are registered
 * programmatically in their respective controllers to demonstrate
 * runtime guard management alongside the declarative approach.
 *
 * @namespace demo.app
 */
export default class Component extends UIComponent {
	public static metadata = {
		manifest: "json",
		interfaces: ["sap.ui.core.IAsyncContentCreation"],
	};

	private _runtimeCoordinator: RuntimeCoordinator | null = null;

	override init(): void {
		super.init();

		const router = this.getRouter() as GuardRouter;
		const runtimeModel = createRuntimeModel();
		const formModel = new JSONModel({ isDirty: false });

		this.setModel(runtimeModel, "runtime");
		this.setModel(formModel, "form");

		this._runtimeCoordinator = new RuntimeCoordinator(runtimeModel, formModel);

		router.initialize();
		this._runtimeCoordinator.start(router);
	}

	override destroy(): void {
		this._runtimeCoordinator?.destroy();
		this._runtimeCoordinator = null;

		super.destroy();
	}
}
