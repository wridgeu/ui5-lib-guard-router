import Log from "sap/base/Log";
import type JSONModel from "sap/ui/model/json/JSONModel";
import type { GuardFn, GuardContext, GuardResult, LeaveGuardFn } from "ui5/guard/router/types";

const LOG_COMPONENT = "demo.app.guards";

/**
 * Async guard that simulates checking permissions via an API.
 * Demonstrates:
 * - Async guard returning a Promise
 * - Using AbortSignal to cancel pending work when navigation is superseded
 *
 * `Component.ts` registers it on the "protected" route.
 *
 * @param authModel - Model containing auth state
 * @param simulatedDelayMs - Simulated API delay in milliseconds (default: 50)
 */
export function createAsyncPermissionGuard(authModel: JSONModel, simulatedDelayMs = 50): GuardFn {
	return async (context: GuardContext): Promise<GuardResult> => {
		Log.info(`Async permission check started for "${context.toRoute}"`, "", LOG_COMPONENT);

		if (context.signal.aborted) {
			return false;
		}

		// Simulate an async API call with abort support
		// In real apps, pass context.signal to fetch() or other cancellable APIs
		try {
			await new Promise<void>((resolve, reject) => {
				const timeoutId = setTimeout(resolve, simulatedDelayMs);

				context.signal.addEventListener("abort", () => {
					clearTimeout(timeoutId);
					reject(new DOMException("Aborted", "AbortError"));
				});
			});

			const isLoggedIn = authModel.getProperty("/isLoggedIn") === true;
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
			// Re-throw unexpected errors - they will be caught and block navigation
			throw error;
		}
	};
}

/**
 * Guard that always redirects to "protected".
 *
 * Demonstrates a redirect chain: navigating to "admin" redirects to
 * "protected", whose own auth guard then runs. When logged out, the
 * chain continues to "home" (admin -> protected -> home). When logged
 * in, the chain stops at "protected" (admin -> protected).
 */
export const adminGuard: GuardFn = () => "protected";

/**
 * Leave guard that logs navigation away from Home.
 * Demonstrates controller-level leave guard registration.
 *
 * This guard always allows navigation (returns true) but logs the attempt.
 * Used in Home.controller.ts to show the addLeaveGuard() pattern with
 * proper controller lifecycle management (onInit/onExit).
 *
 * In real apps, this pattern is useful for:
 * - Confirming navigation away from a page with local state
 * - Analytics tracking of user flow
 * - Cleanup tasks before leaving a view
 */
export function createHomeLeaveLogger(): LeaveGuardFn {
	return (context: GuardContext): boolean => {
		Log.info(`Leaving home route, navigating to "${context.toRoute}"`, "", LOG_COMPONENT);
		return true;
	};
}
