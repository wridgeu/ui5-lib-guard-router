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
 * - `true` -- Allow navigation to proceed.
 * - `false` -- Block navigation. For programmatic `navTo()`, no hash change
 *   or history entry occurs. For browser-initiated navigation (back/forward,
 *   URL bar), the hash is restored via `replaceHash()` (best-effort repair).
 * - `string` -- Redirect to this route name. For programmatic `navTo()`,
 *   navigation goes directly to the target with no intermediate history entry.
 *   For browser-initiated navigation, the redirect replaces the current entry.
 * - `GuardRedirect` -- Redirect with route name, parameters, and optional
 *   component target info. Same history semantics as string redirect.
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
	/**
	 * Parsed route arguments for the target route.
	 * Values are strings (simple parameters) or `Record<string, string>` (nested parameters).
	 * Empty object when the target route has no parameters or no route matched.
	 */
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
 *
 * @param context - Navigation context with current/target route info and an `AbortSignal`.
 * @returns `true` to allow, `false` to block, a route name string to redirect,
 * or a {@link GuardRedirect} object for redirect with parameters or nested component targets.
 * Promise-like return values are awaited.
 */
export type GuardFn = (context: GuardContext) => GuardResult | PromiseLike<GuardResult>;

/**
 * A leave guard function. It can be synchronous or asynchronous.
 *
 * Leave guards answer the question "can I leave this route?" and return
 * only a boolean. They cannot redirect. Use enter guards for that.
 *
 * @param context - Navigation context with current/target route info and an `AbortSignal`.
 * @returns `true` to allow leaving the current route. Any non-`true` boolean result blocks.
 * Promise-like return values are awaited. Non-boolean runtime values are treated as blocked.
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
	/**
	 * Route name associated with the settled state.
	 * Empty string when no route is active or the winning navigation did not match a route
	 * (for example the initial idle state, after `stop()`, or a bypassed navigation).
	 */
	route: string;
	/**
	 * Hash associated with the settled state.
	 * For blocked or cancelled navigations this is usually the hash the router stayed on;
	 * for committed, bypassed, and redirected navigations it is the hash from the winning path.
	 */
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
	 *
	 * @param guard - Guard function to register. Non-functions are ignored with a warning.
	 * @returns `this` for chaining.
	 */
	addGuard(guard: GuardFn): GuardRouter;
	/**
	 * Remove a previously registered global guard.
	 *
	 * @param guard - Guard function to remove by reference. Non-functions are ignored with a warning.
	 * @returns `this` for chaining.
	 */
	removeGuard(guard: GuardFn): GuardRouter;
	/**
	 * Register a guard for a specific route.
	 *
	 * Accepts either an enter guard function or a configuration object with
	 * `beforeEnter` and/or `beforeLeave` guards.
	 *
	 * @param routeName - Route name as defined in `manifest.json`. A warning is logged if the route does not exist yet.
	 * @param guard - Guard function or {@link RouteGuardConfig} object.
	 * @returns `this` for chaining.
	 */
	addRouteGuard(routeName: string, guard: GuardFn | RouteGuardConfig): GuardRouter;
	/**
	 * Remove a guard from a specific route.
	 *
	 * Accepts the same forms as `addRouteGuard`: a guard function removes an
	 * enter guard, while a configuration object removes `beforeEnter` and/or
	 * `beforeLeave` by reference.
	 *
	 * @param routeName - Route name as defined in `manifest.json`.
	 * @param guard - Guard function or {@link RouteGuardConfig} object to remove by reference.
	 * @returns `this` for chaining.
	 */
	removeRouteGuard(routeName: string, guard: GuardFn | RouteGuardConfig): GuardRouter;
	/**
	 * Register a leave guard for a specific route.
	 *
	 * Leave guards run when navigating away from the route. They can allow or
	 * block the navigation, but they cannot redirect.
	 *
	 * @param routeName - Route name as defined in `manifest.json`. A warning is logged if the route does not exist yet.
	 * @param guard - Leave guard function to register. Non-functions are ignored with a warning.
	 * @returns `this` for chaining.
	 */
	addLeaveGuard(routeName: string, guard: LeaveGuardFn): GuardRouter;
	/**
	 * Remove a previously registered leave guard from a specific route.
	 *
	 * @param routeName - Route name as defined in `manifest.json`.
	 * @param guard - Leave guard function to remove by reference. Non-functions are ignored with a warning.
	 * @returns `this` for chaining.
	 */
	removeLeaveGuard(routeName: string, guard: LeaveGuardFn): GuardRouter;
	/**
	 * Resolve when the current guard pipeline settles.
	 *
	 * If a navigation is pending, this resolves when that pipeline settles.
	 * If no navigation is pending, this resolves immediately with the most
	 * recent settlement result. Before any navigation has settled, it falls back
	 * to a synthetic `Committed` result derived from the router's current route/hash state.
	 * After `stop()`, that idle fallback reports empty route/hash values until a new navigation settles.
	 *
	 * @returns Promise that resolves with a {@link NavigationResult} once the pipeline settles.
	 */
	navigationSettled(): Promise<NavigationResult>;
}
