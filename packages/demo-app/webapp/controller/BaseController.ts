import UIComponent from "sap/ui/core/UIComponent";
import Controller from "sap/ui/core/mvc/Controller";
import type Router from "sap/ui/core/routing/Router";
import type Model from "sap/ui/model/Model";

/**
 * Shared controller base modeled after the standard UI5 sample pattern.
 *
 * @namespace demo.app.controller
 */
export default abstract class BaseController extends Controller {
	protected getRouter<T extends Router = Router>(): T {
		return UIComponent.getRouterFor(this) as T;
	}

	protected getModel<T extends Model = Model>(name?: string): T {
		return (this.getView()?.getModel(name) ?? this.getOwnerComponent()?.getModel(name)) as T;
	}

	protected setModel(model: Model, name?: string): void {
		this.getView()?.setModel(model, name);
	}
}
