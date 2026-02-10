import UIComponent from "sap/ui/core/UIComponent";
import JSONModel from "sap/ui/model/json/JSONModel";
import type { GuardRouter, GuardFn } from "ui5/ext/routing/types";
import { createNavigationLogger, createAuthGuard, createDirtyFormGuard, forbiddenGuard } from "./guards";

/**
 * Demo application showcasing all guard registration patterns.
 *
 * This component demonstrates:
 * - Global guards (addGuard) - run for every navigation
 * - Route-specific enter guards (addRouteGuard with function)
 * - Object form guards (addRouteGuard with { beforeEnter, beforeLeave })
 * - Leave guards (addLeaveGuard) - run when leaving a route
 *
 * @namespace demo.app
 */
export default class Component extends UIComponent {
	public static metadata = {
		manifest: "json",
		interfaces: ["sap.ui.core.IAsyncContentCreation"],
	};

	/** Reference to the global navigation logger guard for cleanup */
	private _navigationLogger: GuardFn | null = null;

	init(): void {
		super.init();

		const router = this.getRouter() as unknown as GuardRouter;
		const authModel = this.getModel("auth") as JSONModel;

		// Create a form model for dirty state tracking
		const formModel = new JSONModel({ isDirty: false });
		this.setModel(formModel, "form");

		// ============================================================
		// Pattern 1: Global Guard (addGuard)
		// Runs for EVERY navigation, useful for logging or app-wide checks
		// ============================================================
		this._navigationLogger = createNavigationLogger();
		router.addGuard(this._navigationLogger);

		// ============================================================
		// Pattern 2: Route-specific Enter Guard (addRouteGuard with function)
		// Runs only when navigating TO this specific route
		// ============================================================
		router.addRouteGuard("forbidden", forbiddenGuard);

		// ============================================================
		// Pattern 3: Object Form Guard (addRouteGuard with config object)
		// Registers both enter AND leave guards in a single call
		// This is the recommended pattern when a route needs both guard types
		// ============================================================
		router.addRouteGuard("protected", {
			beforeEnter: createAuthGuard(authModel),
			beforeLeave: createDirtyFormGuard(formModel),
		});

		router.initialize();
	}

	/**
	 * Clean up registered guards on component destruction.
	 *
	 * Router.destroy() automatically clears all guards, so this explicit cleanup
	 * is optional in most cases. It's shown here as a defensive best practice.
	 *
	 * Note: In FLP with sap-keep-alive enabled, destroy() is only called when
	 * navigating to the launchpad home page, not when switching between apps.
	 */
	destroy(): void {
		const router = this.getRouter() as unknown as GuardRouter;

		// Remove global guard
		if (this._navigationLogger) {
			router.removeGuard(this._navigationLogger);
			this._navigationLogger = null;
		}

		super.destroy();
	}
}
