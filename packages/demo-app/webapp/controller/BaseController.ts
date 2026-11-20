import UIComponent from "sap/ui/core/UIComponent";
import Controller from "sap/ui/core/mvc/Controller";
import JSONModel from "sap/ui/model/json/JSONModel";
import History from "sap/ui/core/routing/History";
import type Model from "sap/ui/model/Model";
import ResourceModel from "sap/ui/model/resource/ResourceModel";
import GuardRouterClass from "ui5/guard/router/Router";
import type { GuardRouter } from "ui5/guard/router/types";
import type NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import ScenarioRunner from "../demo/ScenarioRunner";
import { SETTLEMENT_TEXT_KEYS } from "../model/runtime";

/**
 * Shared controller helpers for the demo app.
 *
 * @namespace demo.app.controller
 */
export default abstract class BaseController extends Controller {
	/** The manifest sets `routerClass` to `ui5.guard.router.Router`. */
	protected getRouter(): GuardRouter {
		const router = UIComponent.getRouterFor(this);
		if (!(router instanceof GuardRouterClass)) {
			throw new TypeError("The router is not a ui5.guard.router.Router");
		}
		return router;
	}

	protected getModel<T extends Model>(name: string, type: abstract new (...args: never[]) => T): T {
		const model = this.getView()?.getModel(name) ?? this.getOwnerComponent()?.getModel(name);
		if (!model) {
			throw new Error(`Model "${name}" is not available`);
		}
		if (!(model instanceof type)) {
			throw new TypeError(`Model "${name}" is not a ${type.name}`);
		}
		return model;
	}

	protected createScenarioRunner(): ScenarioRunner {
		return new ScenarioRunner(this.getModel("runtime", JSONModel), this.getModel("i18n", ResourceModel));
	}

	/**
	 * Formatter of the settlement panel, which every view with the panel shares. `notSettled` is
	 * bound to the i18n model, so the text is formatted again once that model has loaded its bundle.
	 */
	formatSettlementStatus(status: NavigationOutcome | "", notSettled: string): string | null {
		if (!status) return notSettled;
		return this.getModel("i18n", ResourceModel).getProperty(SETTLEMENT_TEXT_KEYS[status]);
	}

	/**
	 * Go one step back in the browser history. Without a previous entry of this app (deep
	 * link, fresh load), replace the current entry with the route one level up instead.
	 * Guards run either way: the history step arrives at the router as a hash change. If a
	 * guard blocks it, the router takes the step back and the history stays as it was.
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
