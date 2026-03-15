import UIComponent from "sap/ui/core/UIComponent";
import JSONModel from "sap/ui/model/json/JSONModel";
import type { GuardRouter, GuardFn } from "ui5/guard/router/types";
import { createNavigationLogger, createAsyncPermissionGuard, createDirtyFormGuard, forbiddenGuard } from "./guards";

/**
 * Demo application component showcasing guard registration patterns.
 *
 * Component-level guards (shown here):
 * - Global guards via addGuard() run for every navigation.
 * - Route-specific enter guards via addRouteGuard() with a function.
 * - Object-form guards via addRouteGuard() with { beforeEnter, beforeLeave }.
 *
 * Controller-level guards (see Home.controller.ts):
 * - Standalone leave guards via addLeaveGuard() tied to controller lifecycle.
 *
 * Both patterns are valid. Component-level works well for app-wide concerns;
 * controller-level works well for view-specific state protection.
 *
 * @namespace demo.app
 */
export default class Component extends UIComponent {
	public static metadata = {
		manifest: "json",
		interfaces: ["sap.ui.core.IAsyncContentCreation"],
	};

	/** Reference to the global navigation logger guard for cleanup. */
	private _navigationLogger: GuardFn | null = null;

	override init(): void {
		super.init();

		const router = this.getRouter() as GuardRouter;
		const authModel = this.getModel("auth") as JSONModel;

		// Form model for dirty-state tracking (used by the leave guard below)
		const formModel = new JSONModel({ isDirty: false });
		this.setModel(formModel, "form");

		// Global guard: runs for every navigation, logs the transition.
		// Multiple global guards execute in registration order.
		this._navigationLogger = createNavigationLogger();
		router.addGuard(this._navigationLogger);

		// Route-specific enter guard: always blocks and redirects to "home".
		router.addRouteGuard("forbidden", forbiddenGuard);

		// Object-form guard: registers both enter and leave guards in one call.
		// The async enter guard simulates a permission check with AbortSignal support.
		// The leave guard blocks navigation when the form has unsaved changes.
		router.addRouteGuard("protected", {
			beforeEnter: createAsyncPermissionGuard(authModel),
			beforeLeave: createDirtyFormGuard(formModel),
		});

		router.initialize();
	}

	/**
	 * Clean up registered guards on component destruction.
	 *
	 * Router.destroy() automatically clears all guards, so this explicit
	 * cleanup is optional in most cases. It is shown here as a defensive
	 * best practice.
	 *
	 * Note: in FLP with sap-keep-alive enabled, destroy() is only called
	 * when navigating to the launchpad home page, not when switching apps.
	 */
	override destroy(): void {
		const router = this.getRouter() as GuardRouter;

		if (this._navigationLogger) {
			router.removeGuard(this._navigationLogger);
			this._navigationLogger = null;
		}

		super.destroy();
	}
}
