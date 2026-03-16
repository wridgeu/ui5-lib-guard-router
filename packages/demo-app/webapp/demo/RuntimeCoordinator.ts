import JSONModel from "sap/ui/model/json/JSONModel";
import { registerDirtyStateProvider } from "../flp/ContainerAdapter";
import { syncRuntimeModel } from "../model/runtime";
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

	constructor(runtimeModel: JSONModel, formModel: JSONModel) {
		this._runtimeModel = runtimeModel;
		this._formModel = formModel;
	}

	start(): void {
		this._detachHashChanged = attachHashChanged(() => {
			this.sync();
		});

		this.sync();
	}

	destroy(): void {
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
}
