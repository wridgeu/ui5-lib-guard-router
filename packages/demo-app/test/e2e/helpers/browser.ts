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

/** Set the browser hash like a user who edits the address bar. */
export async function setBrowserHash(hash: string): Promise<void> {
	await browser.execute((value: string) => {
		window.location.hash = value;
	}, hash);
}
