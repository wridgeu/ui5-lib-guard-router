import type Event from "sap/ui/base/Event";
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
 * Policy used when a guard is registered for a route name that does not exist yet.
 *
 * Configure this through `sap.ui5/routing/config/guardRouter/unknownRouteGuardRegistration`
 * in `manifest.json`, or by passing `guardRouter` in the router constructor config.
 *
 * - `"ignore"` registers silently.
 * - `"warn"` logs a warning and still registers.
 * - `"throw"` throws synchronously and does not register.
 */
export type UnknownRouteGuardRegistrationPolicy = "ignore" | "warn" | "throw";

/**
 * Strategy used for programmatic `navTo()` calls.
 *
 * Configure this through `sap.ui5/routing/config/guardRouter/navToPreflight`
 * in `manifest.json`, or by passing `guardRouter` in the router constructor config.
 *
 * - `"guard"` runs guards before the hash changes.
 * - `"bypass"` skips guards for programmatic `navTo()` calls only.
 * - `"off"` disables the preflight path and lets `parse()` guard the hash change afterward.
 */
export type NavToPreflightMode = "guard" | "bypass" | "off";

/**
 * Router-level options for the guard router.
 *
 * These options are intended to be configured manifest-first under
 * `sap.ui5.routing.config.guardRouter`, which is read automatically when UI5
 * instantiates the router from `routerClass`. The same shape is also accepted
 * in the router constructor config for tests or standalone instantiation.
 *
 * Defaults when omitted:
 * - `unknownRouteGuardRegistration: "warn"`
 * - `navToPreflight: "guard"`
 */
export interface GuardRouterOptions {
	/**
	 * Controls how `addRouteGuard()` and `addLeaveGuard()` behave when the route
	 * name is unknown at registration time.
	 */
	unknownRouteGuardRegistration?: UnknownRouteGuardRegistrationPolicy;
	/**
	 * Controls how programmatic `navTo()` calls interact with the guard pipeline.
	 */
	navToPreflight?: NavToPreflightMode;
}

/**
 * Per-navigation overrides for programmatic `navTo()` calls.
 *
 * These options apply only to the current `navTo()` call.
 * `skipGuards: true` bypasses guards for the current programmatic navigation,
 * including when the router's global `navToPreflight` mode is `"guard"` or `"off"`.
 */
export interface GuardNavToOptions {
	/**
	 * When `true`, skip all guards for this programmatic navigation only.
	 * Browser-initiated hash changes still run through `parse()` as usual.
	 */
	skipGuards?: boolean;
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
 * Event object passed to `attachNavigationSettled` handlers.
 * Parameters are identical to {@link NavigationResult}.
 *
 * The source type uses {@link GuardRouter} (the public interface) rather
 * than the concrete Router class to avoid a circular import between
 * `types.ts` and `Router.ts`.
 */
export type Router$NavigationSettledEvent = Event<NavigationResult, GuardRouter>;

/**
 * Public instance shape of the extended Router.
 *
 * Extends `sap.m.routing.Router` with guard management methods.
 * Use this type when casting `getRouter()` in application code.
 */
export interface GuardRouter extends MobileRouter {
	/**
	 * Navigate using the standard UI5 overloads with optional guard-router-specific
	 * per-call options.
	 *
	 * Supported forms are:
	 * - `navTo(routeName, parameters?, replace?)`
	 * - `navTo(routeName, parameters?, componentTargetInfo?, replace?)`
	 * - `navTo(routeName, parameters?, replace?, options?)`
	 * - `navTo(routeName, parameters?, componentTargetInfo?, options?)`
	 * - `navTo(routeName, parameters?, componentTargetInfo?, replace?, options?)`
	 *
	 * To avoid ambiguity with UI5's `componentTargetInfo` object, pass
	 * `GuardNavToOptions` only in the fourth or fifth argument position.
	 */
	navTo(
		routeName: string,
		parameters?: object,
		componentTargetInfoOrReplace?: Record<string, ComponentTargetParameters> | boolean,
		replaceOrOptions?: boolean | GuardNavToOptions,
		options?: GuardNavToOptions,
	): this;
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
	 * @param routeName - Route name as defined in `manifest.json`. Unknown routes are handled according to `guardRouter.unknownRouteGuardRegistration`.
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
	 * @param routeName - Route name as defined in `manifest.json`. Unknown routes are handled according to `guardRouter.unknownRouteGuardRegistration`.
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
	/**
	 * Attach an event handler for the `navigationSettled` event.
	 *
	 * Fires synchronously after every guard pipeline settlement with
	 * a {@link NavigationResult} payload. Unlike the one-shot
	 * `navigationSettled()` Promise, this event fires for every
	 * navigation outcome without re-registration.
	 *
	 * @param oData - Application-specific payload passed to the handler as second argument.
	 * @param fnFunction - The function to be called when the event occurs.
	 * @param oListener - Context object to call the event handler with. Defaults to this Router.
	 */
	attachNavigationSettled(
		oData: object,
		fnFunction: (evt: Router$NavigationSettledEvent) => void,
		oListener?: object,
	): GuardRouter;
	/**
	 * Attach an event handler for the `navigationSettled` event (without custom data).
	 *
	 * @param fnFunction - The function to be called when the event occurs.
	 * @param oListener - Context object to call the event handler with. Defaults to this Router.
	 */
	attachNavigationSettled(fnFunction: (evt: Router$NavigationSettledEvent) => void, oListener?: object): GuardRouter;
	/**
	 * Detach a previously attached `navigationSettled` event handler.
	 *
	 * The passed parameters must match those used for registration with
	 * {@link #attachNavigationSettled} beforehand.
	 *
	 * @param fnFunction - The handler function to detach.
	 * @param oListener - Context object on which the given function had to be called.
	 */
	detachNavigationSettled(fnFunction: (evt: Router$NavigationSettledEvent) => void, oListener?: object): GuardRouter;
}
