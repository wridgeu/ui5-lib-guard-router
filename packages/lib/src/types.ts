/**
 * Redirect target with route name and optional parameters.
 */
export interface GuardRedirect {
	/** Route name to redirect to */
	route: string;
	/** Optional route parameters */
	parameters?: Record<string, string>;
	/** Optional component target info for nested component routing */
	componentTargetInfo?: Record<string, unknown>;
}

/**
 * Result of a guard check.
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
