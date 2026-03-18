import JSONModel from "sap/ui/model/json/JSONModel";
import type { NavigationResult } from "ui5/guard/router/types";
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

	private _pollTimer: ReturnType<typeof setInterval> | null = null;

	private _lastCapturedResult: NavigationResult | null = null;

	constructor(runtimeModel: JSONModel, formModel: JSONModel) {
		this._runtimeModel = runtimeModel;
		this._formModel = formModel;
	}

	start(router: GuardRouter): void {
		this._router = router;

		this._detachHashChanged = attachHashChanged(() => {
			this.sync();
		});

		// Poll at 200ms to capture navigation settlements for the demo UI
		// and E2E test assertions. navigationSettled() is a one-shot query,
		// not a subscription stream, so periodic checking is the only way
		// to observe all outcomes (leave-guard-blocked navTo calls do not
		// fire hashChanged or reach enter guards). The identity check on
		// _lastCapturedResult prevents model mutations when idle.
		this._pollTimer = setInterval(() => this.captureSettlement(), 200);

		this.sync();
		this.captureSettlement();
	}

	destroy(): void {
		this._router = null;

		if (this._pollTimer !== null) {
			clearInterval(this._pollTimer);
			this._pollTimer = null;
		}

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

		void router.navigationSettled().then((result) => {
			if (!this._router) return;

			if (result !== this._lastCapturedResult) {
				this._lastCapturedResult = result;
				setSettlementResult(this._runtimeModel, result);
			}
		});
	}
}
