import JSONModel from "sap/ui/model/json/JSONModel";
import BaseController from "./BaseController";

/**
 * Controller for the Protected view.
 *
 * This route is guarded by two independent registrations:
 * - **Enter guard** (programmatic): `createAsyncPermissionGuard()` registered
 *   in `Component.ts` via `addRouteGuard("protected", guard)`.
 * - **Leave guard** (declarative): `guards/dirtyFormGuard.ts` declared in
 *   `manifest.json` under `guardRouter.guards.protected.leave`.
 *
 * The form model is created and owned by the Component, showing how
 * guards can be centralized at the component level while controllers
 * focus on view logic.
 *
 * @namespace demo.app.controller
 */
export default class ProtectedController extends BaseController {
	/**
	 * navTo() instead of a step back in the history: its preflight lets the leave guard block
	 * before the hash changes. A blocked history step has already moved the browser, and the
	 * router then overwrites the entry it moved to with the hash of this page.
	 */
	override onNavBack(): void {
		this.getRouter().navTo("home");
	}

	onClearDirtyAndNavHome(): void {
		this.getModel<JSONModel>("form").setProperty("/isDirty", false);
		this.createScenarioRunner().recordAction("actionClearedDirty");
		this.getRouter().navTo("home");
	}
}
