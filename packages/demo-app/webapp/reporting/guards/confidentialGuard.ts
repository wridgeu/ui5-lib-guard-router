import type { GuardContext, GuardResult } from "ui5/guard/router/types";

/**
 * Enter guard of the `confidential` route (manifest-declared in the nested component).
 *
 * `context.ownerComponent` is the component that owns the router that runs the guard:
 * here the nested reporting component, not the parent app. While its `access` model
 * is locked, the guard redirects to the report overview of the same router.
 */
export default function confidentialGuard(context: GuardContext): GuardResult {
	const unlocked = context.ownerComponent?.getModel("access")?.getProperty("/confidentialUnlocked");
	return unlocked === true ? true : "overview";
}
