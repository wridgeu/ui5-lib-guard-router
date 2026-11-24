import UIComponent from "sap/ui/core/UIComponent";
import Controller from "sap/ui/core/mvc/Controller";
import type JSONModel from "sap/ui/model/json/JSONModel";
import History from "sap/ui/core/routing/History";
import type Model from "sap/ui/model/Model";
import type ResourceModel from "sap/ui/model/resource/ResourceModel";
import type { GuardRouter } from "ui5/guard/router/types";
import type NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import { SETTLEMENT_TEXT_KEYS } from "../model/runtime";

/**
 * Shared controller helpers for the demo app.
 *
 * @namespace demo.app.controller
 */
export default class BaseController extends Controller {
	/** The manifest sets `routerClass` to `ui5.guard.router.Router`. */
	protected getRouter(): GuardRouter {
		return UIComponent.getRouterFor(this) as GuardRouter;
	}

	protected getModel(name?: string): Model {
		const model = this.getView()?.getModel(name) ?? this.getOwnerComponent()?.getModel(name);
		if (!model) {
			throw new Error(`Model "${name ?? "default"}" is not available`);
		}
		return model;
	}

	/** Show an i18n text as the last action in the runtime panel. */
	protected recordAction(key: string, args?: string[]): void {
		const runtimeModel = this.getModel("runtime") as JSONModel;
		const i18nModel = this.getModel("i18n") as ResourceModel;
		// The i18n model loads its bundle asynchronously ("async": true in the manifest).
		void Promise.resolve(i18nModel.getResourceBundle()).then((bundle) => {
			runtimeModel.setProperty("/lastAction", bundle.getText(key, args) ?? key);
		});
	}

	/**
	 * Formatter of the settlement panel, which every view with the panel shares. `notSettled` is
	 * bound to the i18n model, so the text is formatted again once that model has loaded its bundle.
	 */
	formatSettlementStatus(status: NavigationOutcome | "", notSettled: string): string | null {
		if (!status) return notSettled;
		return (this.getModel("i18n") as ResourceModel).getProperty(SETTLEMENT_TEXT_KEYS[status]);
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
