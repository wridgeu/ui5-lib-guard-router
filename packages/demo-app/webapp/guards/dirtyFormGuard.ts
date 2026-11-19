import Log from "sap/base/Log";
import type { GuardContext } from "ui5/guard/router/types";

const LOG_COMPONENT = "demo.app.guards";

/**
 * Leave guard that blocks navigation when a form has unsaved changes (manifest-declared).
 *
 * Demonstrates the "dirty form" pattern using a synchronous model check.
 * Manifest-declared guards have no closure over the component, so the form
 * model is read from `context.ownerComponent`, the component that owns the router.
 *
 * @param context - Navigation context
 */
export default function dirtyFormGuard(context: GuardContext): boolean {
	const isDirty = context.ownerComponent?.getModel("form")?.getProperty("/isDirty");
	if (isDirty === true) {
		Log.info(`Dirty form guard blocked leaving "${context.fromRoute}"`, "", LOG_COMPONENT);
		return false;
	}
	return true;
}
