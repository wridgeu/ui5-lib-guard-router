import BaseController from "./BaseController";

/**
 * @namespace demo.app.controller
 */
export default class NotFoundController extends BaseController {
	onNavHome(): void {
		this.getRouter().navTo("home");
	}
}
