import type MobileRouter from "sap/m/routing/Router";
import type { ComponentTargetParameters, RouteInfo } from "sap/ui/core/routing/Router";
import type NavigationOutcome from "./NavigationOutcome";

/**
 * Redirect target with route name and optional parameters.
 */
export interface GuardRedirect {
	/** Route name to redirect to */
	route: string;
	/** Optional route parameters */
	parameters?: ComponentTargetParameters["parameters"];
	/** Optional component target info for nested component routing */
	componentTargetInfo?: Record<string, ComponentTargetParameters>;
}

/**
 * Result of a guard check.
 *
 * Only strict `true` allows navigation. All other values (including truthy
 * non-boolean values) block or redirect. This avoids accidental allow from
 * falsy/truthy coercion.
 *
 * - `true`            -> allow navigation to proceed
 * - `false`           -> block navigation (stay on current route, no history entry)
 * - `string`          -> redirect to this route name (replaceHash, no history entry)
 * - `GuardRedirect`   -> redirect with route name, parameters, and optional component target info
 */
export type GuardResult = boolean | string | GuardRedirect;

/**
 * Context passed to guard functions.
 */
export interface GuardContext {
	/** Target route name (empty string if no route matched / bypassed) */
	toRoute: string;
	/** Raw hash being navigated to */
	toHash: string;
	/** Parsed route parameters */
	toArguments: RouteInfo["arguments"];
	/** Current route name (empty string on initial navigation) */
	fromRoute: string;
	/** Current hash */
	fromHash: string;
	/**
	 * Abort signal for this navigation. Aborted when a newer navigation
	 * supersedes this one, or when the router is stopped or destroyed.
	 * Pass to `fetch()` or other cancellable APIs to avoid wasted work.
	 */
	signal: AbortSignal;
}

/**
 * A guard function. It can be synchronous or asynchronous.
 */
export type GuardFn = (context: GuardContext) => GuardResult | PromiseLike<GuardResult>;

/**
 * A leave guard function. It can be synchronous or asynchronous.
 *
 * Leave guards answer the question "can I leave this route?" and return
 * only a boolean. They cannot redirect. Use enter guards for that.
 */
export type LeaveGuardFn = (context: GuardContext) => boolean | PromiseLike<boolean>;

/**
 * Configuration object for registering enter and/or leave guards on a route.
 *
 * When passed to `addRouteGuard`, the object form allows registering both
 * guard types in a single call. If neither `beforeEnter` nor `beforeLeave`
 * is provided, an info message is logged and no guards are registered.
 */
export interface RouteGuardConfig {
	/** Guard that runs before entering this route */
	beforeEnter?: GuardFn;
	/** Guard that runs before leaving this route */
	beforeLeave?: LeaveGuardFn;
}

/**
 * Result of a settled navigation, returned by `navigationSettled()`.
 */
export interface NavigationResult {
	/** How the navigation resolved. */
	status: NavigationOutcome;
	/** Route name determined by the guard pipeline (empty string when bypassed). */
	route: string;
	/** Hash determined by the guard pipeline. */
	hash: string;
}

/**
 * Public instance shape of the extended Router.
 *
 * Extends `sap.m.routing.Router` with guard management methods.
 * Use this type when casting `getRouter()` in application code.
 */
export interface GuardRouter extends MobileRouter {
	/**
	 * Register a global guard that runs for every navigation.
	 */
	addGuard(guard: GuardFn): GuardRouter;
	/**
	 * Remove a previously registered global guard.
	 */
	removeGuard(guard: GuardFn): GuardRouter;
	/**
	 * Register a guard for a specific route.
	 *
	 * Accepts either an enter guard function or a configuration object with
	 * `beforeEnter` and/or `beforeLeave` guards.
	 */
	addRouteGuard(routeName: string, guard: GuardFn | RouteGuardConfig): GuardRouter;
	/**
	 * Remove a guard from a specific route.
	 *
	 * Accepts the same forms as `addRouteGuard`: a guard function removes an
	 * enter guard, while a configuration object removes `beforeEnter` and/or
	 * `beforeLeave` by reference.
	 */
	removeRouteGuard(routeName: string, guard: GuardFn | RouteGuardConfig): GuardRouter;
	/**
	 * Register a leave guard for a specific route.
	 *
	 * Leave guards run when navigating away from the route. They can allow or
	 * block the navigation, but they cannot redirect.
	 */
	addLeaveGuard(routeName: string, guard: LeaveGuardFn): GuardRouter;
	/**
	 * Remove a previously registered leave guard from a specific route.
	 */
	removeLeaveGuard(routeName: string, guard: LeaveGuardFn): GuardRouter;
	/**
	 * Resolve when the current guard pipeline settles.
	 *
	 * If no navigation is pending, this resolves immediately with the most
	 * recent settlement result.
	 */
	navigationSettled(): Promise<NavigationResult>;
}
