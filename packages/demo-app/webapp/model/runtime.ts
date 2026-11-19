import { ValueState } from "sap/ui/core/library";
import JSONModel from "sap/ui/model/json/JSONModel";
import type NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { NavigationResult } from "ui5/guard/router/types";
import { hasUshellContainer } from "../flp/ContainerAdapter";
import { getCurrentHash } from "../routing/hashNavigation";

type RuntimeState = {
	currentHash: string;
	hasUshellContainer: boolean;
	flpDirtyProviderActive: boolean;
	lastAction: string;
	lastSettlementStatus: string;
	lastSettlementState: ValueState;
	lastSettlementRoute: string;
	lastSettlementHash: string;
	lastSettlementHashTechnical: string;
	lastSettlementRevision: number;
};

// The outcome is a technical value, shown capitalized.
function formatSettlementStatus(status: NavigationOutcome): string {
	return `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}

// Typed by outcome: a new outcome without a state does not compile.
const SETTLEMENT_STATES: Record<NavigationOutcome, ValueState> = {
	committed: ValueState.Success,
	redirected: ValueState.Information,
	bypassed: ValueState.Warning,
	cancelled: ValueState.Warning,
	blocked: ValueState.Error,
	error: ValueState.Error,
};

function formatSettlementHashTechnical(hash: string): string {
	return JSON.stringify(hash);
}

/** The model holds values only. The views take the texts for empty values from the i18n bundle. */
export function createRuntimeModel(): JSONModel {
	const state: RuntimeState = {
		currentHash: getCurrentHash(),
		hasUshellContainer: hasUshellContainer(),
		flpDirtyProviderActive: false,
		lastAction: "",
		lastSettlementStatus: "",
		lastSettlementState: ValueState.None,
		lastSettlementRoute: "",
		lastSettlementHash: getCurrentHash(),
		lastSettlementHashTechnical: formatSettlementHashTechnical(getCurrentHash()),
		lastSettlementRevision: 0,
	};
	return new JSONModel(state);
}

export function syncRuntimeModel(model: JSONModel, flpDirtyProviderActive: boolean): void {
	const ushellAvailable = hasUshellContainer();
	model.setData(
		{
			currentHash: getCurrentHash(),
			hasUshellContainer: ushellAvailable,
			flpDirtyProviderActive: ushellAvailable && flpDirtyProviderActive,
		},
		true,
	);
}

export function setRuntimeMessage(model: JSONModel, message: string): void {
	model.setProperty("/lastAction", message);
}

export function setSettlementResult(model: JSONModel, result: NavigationResult): void {
	const lastSettlementRevision = Number(model.getProperty("/lastSettlementRevision") ?? 0) + 1;
	model.setProperty("/lastSettlementStatus", formatSettlementStatus(result.status));
	model.setProperty("/lastSettlementState", SETTLEMENT_STATES[result.status]);
	model.setProperty("/lastSettlementRoute", result.route);
	model.setProperty("/lastSettlementHash", result.hash);
	model.setProperty("/lastSettlementHashTechnical", formatSettlementHashTechnical(result.hash));
	model.setProperty("/lastSettlementRevision", lastSettlementRevision);
}
