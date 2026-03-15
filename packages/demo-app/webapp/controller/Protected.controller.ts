import BaseController from "./BaseController";

/**
 * Controller for the Protected view.
 *
 * @namespace demo.app.controller
 */
export default class ProtectedController extends BaseController {
	onNavBack(): void {
		this.getRouter().navTo("home");
	}
}
