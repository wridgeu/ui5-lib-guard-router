import UIComponent from "sap/ui/core/UIComponent";
import JSONModel from "sap/ui/model/json/JSONModel";
import GuardRouterClass from "ui5/guard/router/Router";
import RuntimeCoordinator from "./demo/RuntimeCoordinator";
import { adminGuard, createAsyncPermissionGuard } from "./guards";
import { createRuntimeModel } from "./model/runtime";

/**
 * Demo application component showcasing both declarative and programmatic
 * guard patterns side by side.
 *
 * **Declarative** (manifest.json `guardRouter.guards`):
 * - Global navigation logger (`"*"`)
 * - `blocked`, `forbidden` and `team` enter guards (shorthand array syntax)
 * - `protected` leave guard (object form with `leave`)
 *
 * **Programmatic** (registered here in `init()`):
 * - `admin` redirect guard -- demonstrates `addRouteGuard()` with a sync function
 * - `protected` enter guard -- demonstrates `addRouteGuard()` with an async
 *   permission check that closes over the auth model
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

	// No initializers: they would run after the UIComponent constructor, which calls init().
	private _runtimeCoordinator?: RuntimeCoordinator;

	override init(): void {
		super.init();

		// The manifest sets routerClass to ui5.guard.router.Router and declares the auth model.
		const router = this.getRouter();
		if (!(router instanceof GuardRouterClass)) {
			throw new TypeError("The router is not a ui5.guard.router.Router");
		}
		const authModel = this.getModel("auth");
		if (!(authModel instanceof JSONModel)) {
			throw new TypeError('Model "auth" is not a JSONModel');
		}
		const runtimeModel = createRuntimeModel();
		const formModel = new JSONModel({ isDirty: false });

		this.setModel(runtimeModel, "runtime");
		this.setModel(formModel, "form");

		// The permission guard closes over the auth model. Manifest guards reach the
		// component through context.ownerComponent instead.
		router.addRouteGuard("admin", adminGuard);
		router.addRouteGuard("protected", createAsyncPermissionGuard(authModel));

		this._runtimeCoordinator = new RuntimeCoordinator(runtimeModel, formModel);

		// Listen before initialize(): with all guard modules loaded, the first navigation settles inside it.
		this._runtimeCoordinator.start(router);
		router.initialize();
	}

	/**
	 * The launchpad hides the app and keeps it (`sap-keep-alive`). The manifest declares
	 * `sap.ui5/keepAlive/supported`, so UI5 stops the router and calls this hook.
	 */
	override onDeactivate(): void {
		this._runtimeCoordinator?.deactivate();
	}

	/** The launchpad shows the kept app again: UI5 has initialized the router. */
	override onActivate(): void {
		this._runtimeCoordinator?.activate();
	}

	override exit(): void {
		this._runtimeCoordinator?.destroy();
		this._runtimeCoordinator = undefined;
	}
}
