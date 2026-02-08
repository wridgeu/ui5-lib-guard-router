import type MobileRouter from "sap/m/routing/Router";
import type { ComponentTargetParameters, RouteInfo } from "sap/ui/core/routing/Router";

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
 * - `true`            → allow navigation to proceed
 * - `false`           → block navigation (stay on current route, no history entry)
 * - `string`          → redirect to this route name (replaceHash, no history entry)
 * - `GuardRedirect`   → redirect with route name, parameters, and optional component target info
 */
export type GuardResult = boolean | string | GuardRedirect;

/**
 * Context passed to guard functions.
 */
export interface GuardContext {
	/** Target route name (empty string if no route matched) */
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
	 * supersedes this one or when the router is destroyed.
	 * Pass to `fetch()` or other cancellable APIs to avoid wasted work.
	 */
	signal: AbortSignal;
}

/**
 * A guard function - can be synchronous or asynchronous.
 */
export type GuardFn = (context: GuardContext) => GuardResult | Promise<GuardResult>;

/**
 * A leave guard function - can be synchronous or asynchronous.
 *
 * Leave guards answer the question "can I leave this route?" and return
 * only a boolean. They cannot redirect — use enter guards for that.
 */
export type LeaveGuardFn = (context: GuardContext) => boolean | Promise<boolean>;

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
 * Public instance shape of the extended Router.
 *
 * Extends `sap.m.routing.Router` with guard management methods.
 * Use this type when casting `getRouter()` in application code.
 */
export interface GuardRouter extends MobileRouter {
	addGuard(guard: GuardFn): GuardRouter;
	removeGuard(guard: GuardFn): GuardRouter;
	addRouteGuard(routeName: string, guard: GuardFn | RouteGuardConfig): GuardRouter;
	removeRouteGuard(routeName: string, guard: GuardFn | RouteGuardConfig): GuardRouter;
	addLeaveGuard(routeName: string, guard: LeaveGuardFn): GuardRouter;
	removeLeaveGuard(routeName: string, guard: LeaveGuardFn): GuardRouter;
}

/**
 * Full internal instance shape including private state and methods.
 *
 * Used as the `this` type in Router method bodies to provide autocomplete
 * and catch property-name typos. Not intended for external consumption.
 *
 * @internal
 */
export interface RouterInternal extends GuardRouter {
	_globalGuards: GuardFn[];
	_enterGuards: Map<string, GuardFn[]>;
	_leaveGuards: Map<string, LeaveGuardFn[]>;
	_currentRoute: string;
	_currentHash: string | null;
	_pendingHash: string | null;
	_redirecting: boolean;
	_parseGeneration: number;
	_suppressNextParse: boolean;
	_abortController: AbortController | null;

	_commitNavigation(hash: string, route?: string): void;
	_runLeaveGuards(context: GuardContext): boolean | Promise<boolean>;
	_runEnterGuards(
		globalGuards: GuardFn[],
		toRoute: string,
		context: GuardContext,
	): GuardResult | Promise<GuardResult>;
	_runEnterPipeline(generation: number, newHash: string, toRoute: string, context: GuardContext): void;
	_runRouteGuards(toRoute: string, context: GuardContext): GuardResult | Promise<GuardResult>;
	_runGuards(guards: GuardFn[], context: GuardContext): GuardResult | Promise<GuardResult>;
	_continueGuardsAsync(
		pendingResult: Promise<GuardResult>,
		guards: Array<(context: GuardContext) => GuardResult | Promise<GuardResult>>,
		currentIndex: number,
		context: GuardContext,
		onBlock: (result: GuardResult) => GuardResult,
		label: string,
		isLeaveGuard: boolean,
	): Promise<GuardResult>;
	_validateGuardResult(result: GuardResult): GuardResult;
	_handleGuardResult(result: GuardResult): void;
	_blockNavigation(): void;
	_restoreHash(): void;
}
