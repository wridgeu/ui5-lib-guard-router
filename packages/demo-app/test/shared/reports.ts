import type { GuardRouter } from "ui5/guard/router/types";
import { getAppComponentId, REPORTS_APP_ID } from "./controls";

/**
 * Helpers for the nested reporting component (`demo.app.reporting`), shared by the
 * standalone and FLP suites. The parent's runtime model only records settlements of
 * the parent router, so these helpers ask the nested component and its router directly.
 */

type ReportsSettlement = {
	status: string;
	route: string;
	hash: string;
};

/** Set the lock that the nested component's `confidential` guard reads from the `access` model. */
export async function setConfidentialUnlocked(unlocked: boolean): Promise<void> {
	await browser.execute(
		(componentId: string, value: boolean) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			Component.getComponentById(componentId).getModel("access").setProperty("/confidentialUnlocked", value);
		},
		await getAppComponentId(REPORTS_APP_ID),
		unlocked,
	);
}

/**
 * Settlement of the nested router: of its pending navigation, or its most recent one
 * when nothing is pending. Call it right after the action that starts the navigation.
 */
export async function settleReportsNavigation(): Promise<ReportsSettlement> {
	return browser.execute(
		async (componentId: string) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			const router: GuardRouter = Component.getComponentById(componentId).getRouter();
			const { status, route, hash } = await router.navigationSettled();
			return { status, route, hash };
		},
		await getAppComponentId(REPORTS_APP_ID),
	);
}
