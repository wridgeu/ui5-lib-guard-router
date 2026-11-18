import JSONModel from "sap/ui/model/json/JSONModel";
import type { NavigationResult } from "ui5/guard/router/types";
import { hasUshellContainer } from "../flp/ContainerAdapter";
import { getCurrentHash } from "../routing/hashNavigation";

type RuntimeState = {
	currentHash: string;
	hasUshellContainer: boolean;
	flpDirtyProviderActive: boolean;
	lastAction: string;
	lastSettlementStatus: string;
	lastSettlementState: string;
	lastSettlementRoute: string;
	lastSettlementHash: string;
	lastSettlementHashTechnical: string;
	lastSettlementRevision: number;
};

function formatSettlementStatus(status: string): string {
	// The outcome is a technical value and shown as such; "" until the first settlement.
	return `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}

function formatSettlementState(status: string): string {
	switch (status) {
		case "committed":
			return "Success";
		case "blocked":
			return "Error";
		case "redirected":
			return "Information";
		// Both are non-error, non-success outcomes that signal the navigation
		// did not commit normally -- Warning fits both in the ObjectStatus palette.
		case "bypassed":
			return "Warning";
		case "cancelled":
			return "Warning";
		default:
			return "None";
	}
}

function formatSettlementHashTechnical(hash: string): string {
	return JSON.stringify(hash);
}

/**
 * The model holds values only. The views take the texts for empty values ("Ready",
 * "Not settled yet", "(pending)", "(no match)", "(empty hash)") from the i18n bundle.
 */
export function createRuntimeModel(): JSONModel {
	const state: RuntimeState = {
		currentHash: getCurrentHash(),
		hasUshellContainer: hasUshellContainer(),
		flpDirtyProviderActive: false,
		lastAction: "",
		lastSettlementStatus: "",
		lastSettlementState: "None",
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
	model.setProperty("/lastSettlementState", formatSettlementState(result.status));
	model.setProperty("/lastSettlementRoute", result.route);
	model.setProperty("/lastSettlementHash", result.hash);
	model.setProperty("/lastSettlementHashTechnical", formatSettlementHashTechnical(result.hash));
	model.setProperty("/lastSettlementRevision", lastSettlementRevision);
}
