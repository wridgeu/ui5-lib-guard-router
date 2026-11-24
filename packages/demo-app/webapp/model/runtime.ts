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
	lastSettlementStatus: NavigationOutcome | "";
	lastSettlementState: ValueState;
	lastSettlementRoute: string;
	lastSettlementHash: string;
	lastSettlementHashTechnical: string;
	lastSettlementRevision: number;
	employeesMeta: string;
	employeeMeta: string;
};

// Typed by outcome: a new outcome without a state does not compile.
const SETTLEMENT_STATES: Record<NavigationOutcome, ValueState> = {
	committed: ValueState.Success,
	redirected: ValueState.Information,
	bypassed: ValueState.Warning,
	cancelled: ValueState.Warning,
	blocked: ValueState.Error,
	error: ValueState.Error,
};

/** The i18n key of the text for each outcome, typed like {@link SETTLEMENT_STATES}. */
export const SETTLEMENT_TEXT_KEYS: Record<NavigationOutcome, string> = {
	committed: "settlementStatusCommitted",
	redirected: "settlementStatusRedirected",
	bypassed: "settlementStatusBypassed",
	cancelled: "settlementStatusCancelled",
	blocked: "settlementStatusBlocked",
	error: "settlementStatusError",
};

/** The model holds values only. The views take the texts, also those of the settlement status, from the i18n bundle. */
export function createRuntimeModel(): JSONModel {
	const state: RuntimeState = {
		currentHash: getCurrentHash(),
		hasUshellContainer: hasUshellContainer(),
		flpDirtyProviderActive: false,
		lastAction: "",
		lastSettlementStatus: "",
		lastSettlementState: ValueState.None,
		lastSettlementRoute: "",
		lastSettlementHash: "",
		lastSettlementHashTechnical: "",
		lastSettlementRevision: 0,
		employeesMeta: "",
		employeeMeta: "",
	};
	return new JSONModel(state);
}

export function syncRuntimeModel(model: JSONModel, flpDirtyProviderActive: boolean): void {
	model.setData(
		{
			currentHash: getCurrentHash(),
			hasUshellContainer: hasUshellContainer(),
			flpDirtyProviderActive,
		},
		true,
	);
}

export function setSettlementResult(model: JSONModel, result: NavigationResult): void {
	const lastSettlementRevision = (model.getProperty("/lastSettlementRevision") as number) + 1;
	model.setProperty("/lastSettlementStatus", result.status);
	model.setProperty("/lastSettlementState", SETTLEMENT_STATES[result.status]);
	model.setProperty("/lastSettlementRoute", result.route);
	model.setProperty("/lastSettlementHash", result.hash);
	model.setProperty("/lastSettlementHashTechnical", JSON.stringify(result.hash));
	model.setProperty("/lastSettlementRevision", lastSettlementRevision);
}
