import Log from "sap/base/Log";
import JSONModel from "sap/ui/model/json/JSONModel";
import type { GuardFn, GuardContext, GuardResult, LeaveGuardFn } from "ui5/guard/router/types";

const LOG_COMPONENT = "demo.app.guards";

/**
 * Guard factories actively registered by the demo runtime.
 *
 * See `Component.ts` and `controller/Home.controller.ts` for the wiring.
 */

/**
 * Global navigation logger guard.
 * Demonstrates the global guard pattern: runs for every navigation.
 * Always returns true (allows navigation) but logs the transition.
 *
 * Note: Uses Log.info() which may be filtered in browser console by default.
 * Set console log level to "Info" or use sap-ui-log-level=INFO URL parameter.
 */
export function createNavigationLogger(): GuardFn {
	return (context: GuardContext): GuardResult => {
		const from = context.fromRoute || "(initial)";
		const to = context.toRoute || "(no match)";
		Log.info(`Navigation logger: ${from} → ${to}`, "", LOG_COMPONENT);
		return true;
	};
}

/**
 * Async guard that simulates checking permissions via an API.
 * Demonstrates:
 * - Async guard returning a Promise
 * - Using AbortSignal to cancel pending work when navigation is superseded
 *
 * This is the auth guard variant wired by `Component.ts` in the runnable demo.
 * For the synchronous equivalent used in the library README examples, see
 * {@link createAuthGuard} in the reference section below.
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

				// Listen for abort signal to cancel the simulated API call
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
 * Guard that always blocks navigation and redirects to "home".
 * Demonstrates the simplest redirect guard shape.
 */
export const forbiddenGuard: GuardFn = () => "home";

/**
 * Leave guard that blocks navigation when a form has unsaved changes.
 * Demonstrates the "dirty form" pattern using a synchronous model check.
 *
 * No FLP-specific bypass is needed here. Cross-app navigation via
 * `toExternal()` operates at the shell level in both production and
 * the FLP sandbox, so the leave guard never runs for cross-app hashes.
 * The FLP dirty-state provider (registered separately via
 * `registerDirtyStateProvider`) handles cross-app dirty UX with its
 * own confirmation popup independently of the router.
 */
export function createDirtyFormGuard(formModel: JSONModel): LeaveGuardFn {
	return (context: GuardContext): boolean => {
		const isDirty = formModel.getProperty("/isDirty");
		if (isDirty === true) {
			Log.info(`Dirty form guard blocked leaving "${context.fromRoute}"`, "", LOG_COMPONENT);
			return false;
		}
		return true;
	};
}

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

/**
 * Reference-only guard factories.
 *
 * These stay in the same file for discoverability, but they are not registered
 * by the runnable demo application. The library README points to these exports
 * when its examples match one-to-one with demo code.
 */

/**
 * Guard that requires the user to be logged in.
 * Redirects to "home" if not authenticated.
 *
 * Reference implementation: demonstrates a synchronous auth guard.
 * The runnable demo uses the async variant {@link createAsyncPermissionGuard}
 * instead.
 *
 * Handles edge case where model property might be undefined
 * (for example, model not yet loaded).
 */
export function createAuthGuard(authModel: JSONModel): GuardFn {
	return (context: GuardContext): GuardResult => {
		const isLoggedIn = authModel.getProperty("/isLoggedIn");
		if (isLoggedIn !== true) {
			Log.info(`Auth guard blocked navigation to "${context.toRoute}"`, "", LOG_COMPONENT);
			return "home";
		}
		return true;
	};
}

/**
 * Guard that demonstrates redirect with route parameters.
 * Redirects to a route while preserving or transforming parameters.
 *
 * Reference implementation: not used in the runnable demo because the demo
 * routes have no parameters.
 *
 * @example
 * // Redirect from "old-detail/{id}" to "detail/{id}" preserving the id
 * router.addRouteGuard("old-detail", createRedirectWithParamsGuard("detail"));
 *
 * @param targetRoute - The route to redirect to
 */
export function createRedirectWithParamsGuard(targetRoute: string): GuardFn {
	return (context: GuardContext): GuardResult => {
		Log.info(`Redirecting from "${context.toRoute}" to "${targetRoute}" with params`, "", LOG_COMPONENT);
		return {
			route: targetRoute,
			parameters: context.toArguments,
		};
	};
}

/**
 * Guard that demonstrates error handling behavior.
 *
 * Reference implementation: not used in the runnable demo. Shows how guard
 * errors are handled by the router:
 * 1. Logs the error via sap/base/Log.error()
 * 2. Blocks the navigation (treats as if guard returned false)
 * 3. Does NOT propagate the error to the application
 *
 * @example
 * // Register as global guard to block all navigation on error
 * const errorModel = new JSONModel({ simulateError: false });
 * router.addGuard(createErrorDemoGuard(errorModel));
 *
 * // Trigger error by setting model property
 * errorModel.setProperty("/simulateError", true);
 *
 * @param errorModel - Model with /simulateError boolean property
 */
export function createErrorDemoGuard(errorModel: JSONModel): GuardFn {
	return (context: GuardContext): GuardResult => {
		const shouldThrow = errorModel.getProperty("/simulateError") === true;
		if (shouldThrow) {
			Log.warning(`Error demo guard throwing for route "${context.toRoute}"`, "", LOG_COMPONENT);
			throw new Error(`Simulated guard error for route "${context.toRoute}"`);
		}
		return true;
	};
}

/**
 * Async version of error demo guard - demonstrates rejected Promise handling.
 *
 * Reference implementation: not used in the runnable demo. Shows how async
 * guard errors (rejected Promises) are handled identically to sync errors.
 *
 * @example
 * // Register as route guard
 * const errorModel = new JSONModel({ simulateAsyncError: false });
 * router.addRouteGuard("risky", createAsyncErrorDemoGuard(errorModel));
 *
 * @param errorModel - Model with /simulateAsyncError boolean property
 * @param delayMs - Delay before rejecting (default: 50ms)
 */
export function createAsyncErrorDemoGuard(errorModel: JSONModel, delayMs = 50): GuardFn {
	return async (context: GuardContext): Promise<GuardResult> => {
		// Simulate async work before checking error condition
		await new Promise((resolve) => setTimeout(resolve, delayMs));

		const shouldReject = errorModel.getProperty("/simulateAsyncError") === true;
		if (shouldReject) {
			Log.warning(`Async error demo guard rejecting for route "${context.toRoute}"`, "", LOG_COMPONENT);
			throw new Error(`Simulated async guard error for route "${context.toRoute}"`);
		}
		return true;
	};
}
