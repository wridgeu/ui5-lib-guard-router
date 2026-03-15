import JSONModel from "sap/ui/model/json/JSONModel";
import { hasUshellContainer } from "../flp/ContainerAdapter";
import { getCurrentHash } from "../routing/hashNavigation";

type RuntimeState = {
	currentHash: string;
	launchMode: string;
	hasUshellContainer: boolean;
	flpDirtyProviderActive: boolean;
	lastAction: string;
};

function buildRuntimeState(lastAction: string, flpDirtyProviderActive: boolean): RuntimeState {
	const ushellAvailable = hasUshellContainer();

	return {
		currentHash: getCurrentHash(),
		launchMode: ushellAvailable ? "FLP Preview" : "Standalone",
		hasUshellContainer: ushellAvailable,
		flpDirtyProviderActive: ushellAvailable && flpDirtyProviderActive,
		lastAction,
	};
}

export function createRuntimeModel(): JSONModel {
	return new JSONModel(buildRuntimeState("Ready", false));
}

export function syncRuntimeModel(model: JSONModel, flpDirtyProviderActive: boolean): void {
	const lastAction = model.getProperty("/lastAction") as string | undefined;
	model.setData(buildRuntimeState(lastAction ?? "Ready", flpDirtyProviderActive));
}

export function setRuntimeMessage(model: JSONModel, message: string): void {
	model.setProperty("/lastAction", message);
}
