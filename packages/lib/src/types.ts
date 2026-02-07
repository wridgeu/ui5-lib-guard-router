import type MobileRouter from "sap/m/routing/Router";
import type { ComponentTargetParameters } from "sap/ui/core/routing/Router";

/**
 * Redirect target with route name and optional parameters.
 */
export interface GuardRedirect {
	/** Route name to redirect to */
	route: string;
	/** Optional route parameters */
	parameters?: Record<string, string>;
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
	toArguments: Record<string, string>;
	/** Current route name (empty string on initial navigation) */
	fromRoute: string;
	/** Current hash */
	fromHash: string;
}

/**
 * A guard function - can be synchronous or asynchronous.
 */
export type GuardFn = (context: GuardContext) => GuardResult | Promise<GuardResult>;

/**
 * Instance shape of the extended Router.
 *
 * Extends `sap.m.routing.Router` with guard-specific state and methods.
 * Used as the `this` type in Router method bodies to provide autocomplete
 * and catch property-name typos.
 */
export interface RouterInstance extends MobileRouter {

	// Guard state
	_globalGuards: GuardFn[];
	_routeGuards: Map<string, GuardFn[]>;
	_currentRoute: string;
	_currentHash: string | null;
	_redirecting: boolean;
	_parseGeneration: number;
	_suppressNextParse: boolean;

	// Guard public API
	addGuard(guard: GuardFn): RouterInstance;
	removeGuard(guard: GuardFn): RouterInstance;
	addRouteGuard(routeName: string, guard: GuardFn): RouterInstance;
	removeRouteGuard(routeName: string, guard: GuardFn): RouterInstance;

	// Guard internal methods
	_commitNavigation(hash: string, route?: string): void;
	_applyGuardResult(result: GuardResult, newHash: string, toRoute: string): void;
	_runAllGuards(globalGuards: GuardFn[], toRoute: string, context: GuardContext): GuardResult | Promise<GuardResult>;
	_runRouteGuards(toRoute: string, context: GuardContext): GuardResult | Promise<GuardResult>;
	_runGuardListSync(guards: GuardFn[], context: GuardContext): GuardResult | Promise<GuardResult>;
	_finishGuardListAsync(pendingResult: Promise<GuardResult>, guards: GuardFn[], currentIndex: number, context: GuardContext): Promise<GuardResult>;
	_validateGuardResult(result: GuardResult): GuardResult;
	_handleGuardResult(result: GuardResult): void;
	_restoreHash(): void;
}
