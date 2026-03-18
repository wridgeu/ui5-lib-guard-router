import JSONModel from "sap/ui/model/json/JSONModel";
import type { GuardRouter } from "ui5/guard/router/types";
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

	private _settlementRequestId = 0;

	constructor(runtimeModel: JSONModel, formModel: JSONModel) {
		this._runtimeModel = runtimeModel;
		this._formModel = formModel;
	}

	start(router: GuardRouter): void {
		this._router = router;

		this._detachHashChanged = attachHashChanged(() => {
			this.sync();
			this.captureSettlement();
		});

		this.sync();
		this.captureSettlement();
	}

	destroy(): void {
		this._settlementRequestId++;
		this._router = null;

		this._detachHashChanged?.();
		this._detachHashChanged = null;

		this._unregisterDirtyProvider?.();
		this._unregisterDirtyProvider = null;
	}

	sync(): void {
		if (!this._unregisterDirtyProvider) {
			this._unregisterDirtyProvider = registerDirtyStateProvider(this._dirtyStateProvider);
		}

		syncRuntimeModel(this._runtimeModel, this._unregisterDirtyProvider !== null);
	}

	private captureSettlement(): void {
		const router = this._router;
		if (!router) {
			return;
		}

		const requestId = ++this._settlementRequestId;

		void router.navigationSettled().then((result) => {
			if (requestId !== this._settlementRequestId) {
				return;
			}

			setSettlementResult(this._runtimeModel, result);
		});
	}
}
