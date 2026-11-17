import MessageToast from "sap/m/MessageToast";
import type ResourceModel from "sap/ui/model/resource/ResourceModel";
import type { GuardContext, GuardResult } from "ui5/guard/router/types";

/**
 * Enter guard of the `confidential` route (manifest-declared in the nested component).
 *
 * `context.ownerComponent` is the component that owns the router that runs the guard:
 * here the nested reporting component, not the parent app. While its `access` model
 * is locked, the guard redirects to the report overview of the same router.
 */
export default async function confidentialGuard(context: GuardContext): Promise<GuardResult> {
	const component = context.ownerComponent;
	if (component?.getModel("access")?.getProperty("/confidentialUnlocked") === true) {
		return true;
	}
	const i18n = component?.getModel("i18n") as ResourceModel;
	const bundle = await i18n.getResourceBundle();
	MessageToast.show(bundle.getText("confidentialLocked") ?? "");
	return "overview";
}
