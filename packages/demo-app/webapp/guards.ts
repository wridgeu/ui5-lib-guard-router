import Log from "sap/base/Log";
import JSONModel from "sap/ui/model/json/JSONModel";
import type { GuardFn, GuardContext, GuardResult, LeaveGuardFn } from "ui5/ext/routing/types";

/**
 * Guard that requires the user to be logged in.
 * Redirects to "home" if not authenticated.
 */
export function createAuthGuard(authModel: JSONModel): GuardFn {
	return (context: GuardContext): GuardResult => {
		const isLoggedIn = authModel.getProperty("/isLoggedIn");
		if (!isLoggedIn) {
			Log.info(`Auth guard blocked navigation to "${context.toRoute}"`, "demo.app.guards");
		}
		return isLoggedIn ? true : "home";
	};
}

/**
 * Guard that always blocks navigation and redirects to "home".
 */
export const forbiddenGuard: GuardFn = () => "home";

/**
 * Leave guard that blocks navigation when a form has unsaved changes.
 * Demonstrates the "dirty form" pattern using a synchronous model check.
 */
export function createDirtyFormGuard(formModel: JSONModel): LeaveGuardFn {
	return (context: GuardContext): boolean => {
		const isDirty = formModel.getProperty("/isDirty");
		if (isDirty) {
			Log.info(`Dirty form guard blocked leaving "${context.fromRoute}"`, "demo.app.guards");
		}
		return !isDirty;
	};
}
