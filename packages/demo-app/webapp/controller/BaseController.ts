import UIComponent from "sap/ui/core/UIComponent";
import Controller from "sap/ui/core/mvc/Controller";
import JSONModel from "sap/ui/model/json/JSONModel";
import History from "sap/ui/core/routing/History";
import type Model from "sap/ui/model/Model";
import type ResourceModel from "sap/ui/model/resource/ResourceModel";
import type { GuardRouter } from "ui5/guard/router/types";
import ScenarioRunner from "../demo/ScenarioRunner";

/**
 * Shared controller helpers for the demo app.
 *
 * @namespace demo.app.controller
 */
export default abstract class BaseController extends Controller {
	/** The manifest sets `routerClass` to `ui5.guard.router.Router`. */
	protected getRouter(): GuardRouter {
		return UIComponent.getRouterFor(this) as GuardRouter;
	}

	protected getModel<T extends Model = Model>(name?: string): T {
		const model = this.getView()?.getModel(name) ?? this.getOwnerComponent()?.getModel(name);
		if (!model) {
			throw new Error(`Model "${name ?? "default"}" is not available`);
		}
		return model as T;
	}

	protected createScenarioRunner(): ScenarioRunner {
		return new ScenarioRunner(this.getModel<JSONModel>("runtime"), this.getModel<ResourceModel>("i18n"));
	}

	/**
	 * Go one step back in the browser history. Without a previous entry of this app (deep
	 * link, fresh load), replace the current entry with the route one level up instead.
	 * Guards run either way: the history step arrives at the router as a hash change.
	 * Pages with a leave guard do not use it, see Protected.controller.ts.
	 */
	protected navBack(fallbackRoute: string): void {
		if (History.getInstance().getPreviousHash() !== undefined) {
			window.history.go(-1);
		} else {
			this.getRouter().navTo(fallbackRoute, {}, true);
		}
	}

	/** Handler of the Page nav button. Pages that go back differently override it. */
	onNavBack(): void {
		this.navBack("home");
	}
}
