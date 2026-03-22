import Log from "sap/base/Log";
import Component from "sap/ui/core/Component";
import type UIComponent from "sap/ui/core/UIComponent";
import type JSONModel from "sap/ui/model/json/JSONModel";
import type { GuardContext, GuardResult } from "ui5/guard/router/types";

const LOG_COMPONENT = "demo.app.guards";
const APP_MANIFEST_ID = "demo.app";
const SIMULATED_DELAY_MS = 50;

/**
 * Look up the running demo component via the Component registry.
 *
 * The manifest-declared guard has no closure over the Component instance,
 * so we locate it by manifest ID at runtime.
 */
function getAuthModel(): JSONModel | undefined {
	const allComponents = Component.registry.all() as Record<string, UIComponent>;
	for (const id in allComponents) {
		const comp = allComponents[id];
		const manifest = comp.getManifestEntry("sap.app") as { id?: string } | undefined;
		if (manifest?.id === APP_MANIFEST_ID) {
			return comp.getModel("auth") as JSONModel;
		}
	}
	return undefined;
}

/**
 * Async permission guard for the "protected" route (manifest-declared).
 *
 * Simulates an async API call to check permissions. Demonstrates:
 * - Async guard returning a Promise
 * - Using AbortSignal to cancel pending work when navigation is superseded
 * - Component model lookup from a declarative guard module
 *
 * @param context - Navigation context
 */
export default async function protectedGuard(context: GuardContext): Promise<GuardResult> {
	Log.info(`Async permission check started for "${context.toRoute}"`, "", LOG_COMPONENT);

	if (context.signal.aborted) {
		return false;
	}

	try {
		await new Promise<void>((resolve, reject) => {
			const timeoutId = setTimeout(resolve, SIMULATED_DELAY_MS);

			context.signal.addEventListener("abort", () => {
				clearTimeout(timeoutId);
				reject(new DOMException("Aborted", "AbortError"));
			});
		});

		const authModel = getAuthModel();
		const isLoggedIn = authModel?.getProperty("/isLoggedIn") === true;
		Log.info(
			`Async permission check completed for "${context.toRoute}": ${isLoggedIn ? "allowed" : "denied"}`,
			"",
			LOG_COMPONENT,
		);
		return isLoggedIn ? true : "home";
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			Log.info(`Async permission check aborted for "${context.toRoute}"`, "", LOG_COMPONENT);
			return false;
		}
		throw error;
	}
}
