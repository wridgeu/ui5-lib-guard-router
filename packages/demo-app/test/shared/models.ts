import { getAppComponentId } from "./controls";

/**
 * Model state of the demo app, shared by the standalone and FLP suites: read and set
 * through the component, without UI interaction.
 */

/** Options of a wait for a page or a hash. With `afterRevision`, only a settlement recorded after that revision counts. */
export type SettlementWaitOptions = {
	timeout?: number;
	afterRevision?: number;
};

/** Number of navigations the demo app's router has settled. A navigation started after reading it settles with a higher number. */
export async function getRuntimeSettlementRevision(): Promise<number> {
	return browser.execute(
		(componentId: string) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			return Number(
				Component.getComponentById(componentId).getModel("runtime").getProperty("/lastSettlementRevision"),
			);
		},
		await getAppComponentId(),
	);
}

/** Set the dirty state that the leave guard of "protected" and the FLP dirty-state provider read from the `form` model. */
export async function setDirtyState(isDirty: boolean): Promise<void> {
	await browser.execute(
		(dirty: boolean, componentId: string) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			Component.getComponentById(componentId).getModel("form").setProperty("/isDirty", dirty);
		},
		isDirty,
		await getAppComponentId(),
	);
}
