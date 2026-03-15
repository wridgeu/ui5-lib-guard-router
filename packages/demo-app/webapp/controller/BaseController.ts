import UIComponent from "sap/ui/core/UIComponent";
import Controller from "sap/ui/core/mvc/Controller";
import type Router from "sap/ui/core/routing/Router";
import type Model from "sap/ui/model/Model";

/**
 * Shared controller helpers for the demo app.
 *
 * @namespace demo.app.controller
 */
export default abstract class BaseController extends Controller {
	protected getRouter<T extends Router = Router>(): T {
		const router = UIComponent.getRouterFor(this);
		if (!router) {
			throw new Error("Router is not available for this controller");
		}
		return router as T;
	}

	protected getModel<T extends Model = Model>(name?: string): T {
		const model = this.getView()?.getModel(name) ?? this.getOwnerComponent()?.getModel(name);
		if (!model) {
			throw new Error(`Model "${name ?? "default"}" is not available`);
		}
		return model as T;
	}

	protected setModel(model: Model, name?: string): void {
		const view = this.getView();
		if (!view) {
			throw new Error("View is not available for this controller");
		}
		view.setModel(model, name);
	}
}
