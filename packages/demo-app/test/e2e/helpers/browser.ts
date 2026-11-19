import { type ControlRef, getAppComponentId } from "../../shared/controls";

/**
 * Fire an event on a UI5 control, bypassing wdi5's control resolution. Used for the
 * Page nav button, which is a sub-element without an app-declared ID.
 *
 * Fails if the control does not exist or nothing listens to the event: firing an
 * event without a handler would otherwise be a silent no-op.
 */
export async function fireEvent(control: ControlRef, eventName: string): Promise<void> {
	await browser.execute(
		(compId: string, viewId: string, id: string, evt: string) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			const target = Component.getComponentById(compId).byId(viewId).byId(id);
			if (!target.hasListeners(evt)) {
				throw new Error(`Control "${viewId}/${id}" has no listener for the event "${evt}"`);
			}
			target.fireEvent(evt);
		},
		await getAppComponentId(control.appId),
		control.viewId,
		control.id,
		eventName,
	);
}

/**
 * Return current window.history.length from the browser. Chrome caps it at 50 entries:
 * at the cap a new entry no longer changes the length, so the comparison would prove nothing.
 */
export async function getHistoryLength(): Promise<number> {
	const length = await browser.execute(() => window.history.length);
	if (length >= 50) {
		throw new Error(`window.history.length is ${length}: at the browser cap, new entries cannot be observed`);
	}
	return length;
}

/** The position of the current entry in the browser history. */
export function getHistoryEntryIndex(): Promise<number> {
	return browser.execute(() => window.navigation.currentEntry?.index ?? -1);
}

/** Set the browser hash like a user who edits the address bar. */
export async function setBrowserHash(hash: string): Promise<void> {
	await browser.execute((value: string) => {
		window.location.hash = value;
	}, hash);
}
