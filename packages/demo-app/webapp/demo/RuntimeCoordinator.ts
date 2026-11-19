import JSONModel from "sap/ui/model/json/JSONModel";
import type { GuardRouter, Router$NavigationSettledEvent } from "ui5/guard/router/types";
import { registerDirtyStateProvider } from "../flp/ContainerAdapter";
import { setSettlementResult, syncRuntimeModel } from "../model/runtime";
import { attachHashChanged } from "../routing/hashNavigation";

export default class RuntimeCoordinator {
	private readonly _runtimeModel: JSONModel;

	private readonly _formModel: JSONModel;

	private readonly _dirtyStateProvider = (navigationContext?: { isCrossAppNavigation?: boolean }): boolean => {
		if (navigationContext?.isCrossAppNavigation === false) {
			return false;
		}

		return this._formModel.getProperty("/isDirty") === true;
	};

	private _detachHashChanged: (() => void) | null = null;

	private _unregisterDirtyProvider: (() => void) | null = null;

	private _router: GuardRouter | null = null;

	private readonly _settlementHandler = (evt: Router$NavigationSettledEvent): void => {
		setSettlementResult(this._runtimeModel, evt.getParameters());
	};

	constructor(runtimeModel: JSONModel, formModel: JSONModel) {
		this._runtimeModel = runtimeModel;
		this._formModel = formModel;
	}

	start(router: GuardRouter): void {
		this._router = router;
		router.attachNavigationSettled(this._settlementHandler, this);
		this.activate();
	}

	/** The app is shown: follow the hash, and answer the launchpad's question about unsaved data. */
	activate(): void {
		this._detachHashChanged = attachHashChanged(() => {
			this.sync();
		});

		this.sync();
	}

	/**
	 * The app is hidden or destroyed. The launchpad asks every registered dirty-state provider
	 * on each navigation and does not remove one itself, so an app that is not shown must not
	 * leave its provider registered: its unsaved data is not at stake when the user navigates
	 * between other apps.
	 */
	deactivate(): void {
		this._detachHashChanged?.();
		this._detachHashChanged = null;

		this._unregisterDirtyProvider?.();
		this._unregisterDirtyProvider = null;
	}

	destroy(): void {
		const router = this._router;
		this._router = null;

		if (router) {
			router.detachNavigationSettled(this._settlementHandler, this);
		}

		this.deactivate();
	}

	sync(): void {
		if (!this._unregisterDirtyProvider) {
			this._unregisterDirtyProvider = registerDirtyStateProvider(this._dirtyStateProvider);
		}

		syncRuntimeModel(this._runtimeModel, this._unregisterDirtyProvider !== null);
	}
}
