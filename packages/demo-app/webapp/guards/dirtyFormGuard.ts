import Log from "sap/base/Log";
import Component from "sap/ui/core/Component";
import type UIComponent from "sap/ui/core/UIComponent";
import type JSONModel from "sap/ui/model/json/JSONModel";
import type { GuardContext } from "ui5/guard/router/types";

const LOG_COMPONENT = "demo.app.guards";
const APP_MANIFEST_ID = "demo.app";

/**
 * Look up the running demo component via the Component registry.
 *
 * The manifest-declared guard has no closure over the Component instance,
 * so we locate it by manifest ID at runtime.
 */
function getFormModel(): JSONModel | undefined {
	const allComponents = Component.registry.all() as Record<string, UIComponent>;
	for (const id in allComponents) {
		const comp = allComponents[id];
		const manifest = comp.getManifestEntry("sap.app") as { id?: string } | undefined;
		if (manifest?.id === APP_MANIFEST_ID) {
			return comp.getModel("form") as JSONModel;
		}
	}
	return undefined;
}

/**
 * Leave guard that blocks navigation when a form has unsaved changes (manifest-declared).
 *
 * Demonstrates the "dirty form" pattern using a synchronous model check.
 * Looks up the form model from the Component registry at runtime since
 * manifest-declared guards do not have closure access to the component.
 *
 * @param context - Navigation context
 */
export default function dirtyFormGuard(context: GuardContext): boolean {
	const formModel = getFormModel();
	const isDirty = formModel?.getProperty("/isDirty");
	if (isDirty === true) {
		Log.info(`Dirty form guard blocked leaving "${context.fromRoute}"`, "", LOG_COMPONENT);
		return false;
	}
	return true;
}
