import type JSONModel from "sap/ui/model/json/JSONModel";
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
	onClearDirtyAndNavHome(): void {
		(this.getModel("form") as JSONModel).setProperty("/isDirty", false);
		this.recordAction("actionClearedDirty");
		this.getRouter().navTo("home");
	}
}
