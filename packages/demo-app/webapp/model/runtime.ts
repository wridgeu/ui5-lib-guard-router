import JSONModel from "sap/ui/model/json/JSONModel";
import type { NavigationResult } from "ui5/guard/router/types";
import { hasUshellContainer } from "../flp/ContainerAdapter";
import { getCurrentHash } from "../routing/hashNavigation";

type RuntimeState = {
	currentHash: string;
	launchMode: string;
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
	if (!status) {
		return "Not settled yet";
	}

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

function formatSettlementRoute(route: string): string {
	return route || "(no match)";
}

function formatSettlementHash(hash: string): string {
	return hash || "(empty hash)";
}

function formatSettlementHashTechnical(hash: string): string {
	return JSON.stringify(hash);
}

function buildRuntimeState(
	lastAction: string,
	flpDirtyProviderActive: boolean,
	lastSettlementRevision = 0,
): RuntimeState {
	const ushellAvailable = hasUshellContainer();

	return {
		currentHash: getCurrentHash(),
		launchMode: ushellAvailable ? "FLP Preview" : "Standalone",
		hasUshellContainer: ushellAvailable,
		flpDirtyProviderActive: ushellAvailable && flpDirtyProviderActive,
		lastAction,
		lastSettlementStatus: "Not settled yet",
		lastSettlementState: "None",
		lastSettlementRoute: "(pending)",
		lastSettlementHash: formatSettlementHash(getCurrentHash()),
		lastSettlementHashTechnical: formatSettlementHashTechnical(getCurrentHash()),
		lastSettlementRevision,
	};
}

export function createRuntimeModel(): JSONModel {
	return new JSONModel(buildRuntimeState("Ready", false));
}

export function syncRuntimeModel(model: JSONModel, flpDirtyProviderActive: boolean): void {
	const ushellAvailable = hasUshellContainer();
	model.setData(
		{
			currentHash: getCurrentHash(),
			launchMode: ushellAvailable ? "FLP Preview" : "Standalone",
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
	model.setProperty("/lastSettlementRoute", formatSettlementRoute(result.route));
	model.setProperty("/lastSettlementHash", formatSettlementHash(result.hash));
	model.setProperty("/lastSettlementHashTechnical", formatSettlementHashTechnical(result.hash));
	model.setProperty("/lastSettlementRevision", lastSettlementRevision);
}
