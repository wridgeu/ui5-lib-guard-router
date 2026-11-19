import Log from "sap/base/Log";
import type { GuardFn, GuardContext, GuardResult, GuardRedirect } from "./types";

/** The component under which the library logs. */
export const LOG_COMPONENT = "ui5.guard.router.Router";

function isGuardRedirect(value: unknown): value is GuardRedirect {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const { route } = value as GuardRedirect;
	return typeof route === "string" && route.length > 0;
}

/**
 * Promises/A+ thenable detection via duck typing.
 *
 * We intentionally do not use `instanceof Promise` because that misses
 * cross-realm Promises and PromiseLike/thenable objects.
 */
export function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
	if ((typeof value !== "object" && typeof value !== "function") || value === null) {
		return false;
	}

	return typeof (value as PromiseLike<T>).then === "function";
}

/** How this engine prints the resolve function of a Promise: `function () { [native code] }` in V8. */
let resolverSource!: string;
void new Promise((resolve) => {
	resolverSource = Function.prototype.toString.call(resolve);
});

/**
 * Whether `value` looks exactly like the resolve function of a native Promise: a function with
 * the name `""`, the length `1` and the source text that this engine prints for such a function.
 * `Router#attachRouteMatched` needs this to recognize a UI5 component target that waits for the
 * router. A function written in JavaScript never matches; other anonymous built-ins with one
 * parameter do, above all the reject function of a Promise.
 */
export function isPromiseResolver(value: unknown): value is () => void {
	return (
		typeof value === "function" &&
		value.name === "" &&
		value.length === 1 &&
		Function.prototype.toString.call(value) === resolverSource
	);
}

/** Names of manifest guards, derived from their module, for log output. */
const guardNames = new WeakMap<GuardFn, string>();

/** Give a guard a name that its log messages show. */
export function nameGuard(guard: GuardFn, name: string): void {
	guardNames.set(guard, name);
}

/** Describe a guard for log output: `Enter guard [0]`, or `Enter guard [0] "checks#0"` when it has a name. */
function describeGuard(label: string, index: number, guard: GuardFn): string {
	const name = guardNames.get(guard);
	return name === undefined ? `${label} [${index}]` : `${label} [${index}] "${name}"`;
}

/**
 * Normalized result of the guard decision pipeline.
 */
export type GuardDecision =
	| { action: "allow" }
	| { action: "block" }
	| { action: "redirect"; target: string | GuardRedirect }
	| { action: "error"; error: unknown };

/**
 * Standalone guard evaluation pipeline.
 *
 * Owns guard storage (global, enter, leave) and runs the full
 * leave -> global-enter -> route-enter pipeline. Pure logic with
 * no dependency on Router state beyond the current route name
 * passed into evaluate().
 *
 * @namespace ui5.guard.router
 */
export default class GuardPipeline {
	private _globalGuards: GuardFn[] = [];
	private _enterGuards = new Map<string, GuardFn[]>();
	private _leaveGuards = new Map<string, GuardFn[]>();

	/** Register a guard that runs for every navigation. */
	addGlobalGuard(guard: GuardFn): void {
		this._globalGuards.push(guard);
	}

	/** Remove a previously registered global guard by reference. */
	removeGlobalGuard(guard: GuardFn): void {
		const index = this._globalGuards.indexOf(guard);
		if (index !== -1) {
			this._globalGuards.splice(index, 1);
		}
	}

	/**
	 * Register an enter guard for a specific route.
	 *
	 * @param route - Route name as defined in `manifest.json`.
	 * @param guard - Guard function to register.
	 */
	addEnterGuard(route: string, guard: GuardFn): void {
		this._addToGuardMap(this._enterGuards, route, guard);
	}

	/**
	 * Remove a previously registered enter guard by reference.
	 *
	 * @param route - Route name.
	 * @param guard - Guard function to remove.
	 */
	removeEnterGuard(route: string, guard: GuardFn): void {
		this._removeFromGuardMap(this._enterGuards, route, guard);
	}

	/**
	 * Register a leave guard for a specific route.
	 *
	 * Accepts `GuardFn` to support manifest-declared guards loaded from
	 * untyped modules. Non-boolean return values are caught at runtime
	 * by {@link _validateLeaveGuardResult}.
	 *
	 * @param route - Route name as defined in `manifest.json`.
	 * @param guard - Guard function to register as a leave guard.
	 */
	addLeaveGuard(route: string, guard: GuardFn): void {
		this._addToGuardMap(this._leaveGuards, route, guard);
	}

	/**
	 * Remove a previously registered leave guard by reference.
	 *
	 * @param route - Route name.
	 * @param guard - Guard function to remove.
	 */
	removeLeaveGuard(route: string, guard: GuardFn): void {
		this._removeFromGuardMap(this._leaveGuards, route, guard);
	}

	/**
	 * Remove all registered guards.
	 */
	clear(): void {
		this._globalGuards = [];
		this._enterGuards.clear();
		this._leaveGuards.clear();
	}

	/**
	 * Run the full guard pipeline (leave -> global enter -> route enter) and
	 * return a normalized decision. Stays synchronous when all guards return
	 * plain values; returns a Promise only when an async guard is encountered.
	 *
	 * @param context - Complete guard context including AbortSignal.
	 *   `context.fromRoute` controls leave-guard lookup: empty string skips leave guards.
	 * @param options - Optional evaluation options.
	 * @param options.skipLeaveGuards - When true, leave guards are skipped even if
	 *   `context.fromRoute` is set. Used by redirect chain hops to avoid re-running
	 *   leave guards while still preserving `fromRoute` in the context.
	 * @param options.alsoLeaving - Greedy routes that are left as well: their leave guards run
	 *   after those of `context.fromRoute`, with the same context.
	 * @param options.alsoEntering - Greedy routes that match as well: their enter guards run
	 *   after those of `context.toRoute`, with the same context.
	 * @returns A synchronous {@link GuardDecision} when all guards return plain values,
	 *   or a `Promise<GuardDecision>` when at least one guard returns a thenable.
	 */
	evaluate(
		context: GuardContext,
		options?: { skipLeaveGuards?: boolean; alsoLeaving?: string[]; alsoEntering?: string[] },
	): GuardDecision | Promise<GuardDecision> {
		// No route is left on the first navigation, or after a hash that matched none.
		const leaving =
			options?.skipLeaveGuards || context.fromRoute === ""
				? []
				: [context.fromRoute, ...(options?.alsoLeaving ?? [])];
		const entering = [context.toRoute, ...(options?.alsoEntering ?? [])];

		const processEnterResult = (
			enterResult: GuardResult | Promise<GuardResult>,
		): GuardDecision | Promise<GuardDecision> => {
			if (isPromiseLike(enterResult)) {
				return enterResult
					.then((r: GuardResult): GuardDecision => {
						if (r === true) return { action: "allow" };
						if (r === false) return { action: "block" };
						return { action: "redirect", target: r };
					})
					.catch((error: unknown): GuardDecision => {
						return { action: "error", error };
					});
			}
			if (enterResult === true) return { action: "allow" };
			if (enterResult === false) return { action: "block" };
			return { action: "redirect", target: enterResult };
		};

		const runEnterPhase = (): GuardDecision | Promise<GuardDecision> => {
			const enterResult = this._runEnterGuards(entering, context);
			return processEnterResult(enterResult);
		};

		try {
			const leaveResult = this._runForEach(leaving, context, (route) => this._runLeaveGuards(route, context));

			if (isPromiseLike(leaveResult)) {
				return leaveResult
					.then((allowed: GuardResult): GuardDecision | Promise<GuardDecision> => {
						if (allowed !== true) return { action: "block" };
						if (context.signal.aborted) return { action: "block" };
						return runEnterPhase();
					})
					.catch((error: unknown): GuardDecision => {
						return { action: "error", error };
					});
			}
			if (leaveResult !== true) return { action: "block" };

			return runEnterPhase();
		} catch (error) {
			return { action: "error", error };
		}
	}

	private _addToGuardMap<T>(map: Map<string, T[]>, key: string, guard: T): void {
		let guards = map.get(key);
		if (!guards) {
			guards = [];
			map.set(key, guards);
		}
		guards.push(guard);
	}

	private _removeFromGuardMap<T>(map: Map<string, T[]>, key: string, guard: T): void {
		const guards = map.get(key);
		if (!guards) return;
		const index = guards.indexOf(guard);
		if (index !== -1) guards.splice(index, 1);
		if (guards.length === 0) map.delete(key);
	}

	/**
	 * Run `run` for each route in order until one does not return `true`. Stays sync as long
	 * as the runs do; after an async run the next one starts unless the navigation was aborted.
	 */
	private _runForEach(
		routes: string[],
		context: GuardContext,
		run: (route: string) => GuardResult | Promise<GuardResult>,
		start = 0,
	): GuardResult | Promise<GuardResult> {
		for (let i = start; i < routes.length; i++) {
			const result = run(routes[i]);
			if (isPromiseLike(result)) {
				return result.then((settled: GuardResult) => {
					if (settled !== true) return settled;
					if (context.signal.aborted) return false;
					return this._runForEach(routes, context, run, i + 1);
				});
			}
			if (result !== true) return result;
		}
		return true;
	}

	/**
	 * Run the leave guards of `route`. Returns boolean (no redirects).
	 *
	 * The guard array is snapshot-copied before iteration so that guards
	 * may safely add/remove themselves (e.g. one-shot guards) without
	 * affecting the current pipeline run.
	 */
	private _runLeaveGuards(route: string, context: GuardContext): boolean | Promise<boolean> {
		const guards = (this._leaveGuards.get(route) ?? []).slice();
		for (let i = 0; i < guards.length; i++) {
			try {
				const result = guards[i](context);
				if (isPromiseLike(result)) {
					return this._continueGuardsAsync(
						result,
						guards,
						i,
						context,
						(candidate) => this._validateLeaveGuardResult(candidate),
						"Leave guard",
						route,
					) as Promise<boolean>;
				}
				if (result !== true) return this._validateLeaveGuardResult(result);
			} catch (error) {
				if (context.signal.aborted) return false;
				Log.error(
					`${describeGuard("Leave guard", i, guards[i])} on route "${route}" threw, navigation failed`,
					error instanceof Error ? error : String(error),
					LOG_COMPONENT,
				);
				throw error;
			}
		}
		return true;
	}

	/** Run global guards, then the route-specific guards of each route in `entering`. Stays sync when possible. */
	private _runEnterGuards(entering: string[], context: GuardContext): GuardResult | Promise<GuardResult> {
		const runRouteGuards = (): GuardResult | Promise<GuardResult> =>
			this._runForEach(entering, context, (route) => this._runRouteGuards(route, context));
		const globalResult = this._runGuards(this._globalGuards, context, context.toRoute);

		if (isPromiseLike(globalResult)) {
			return globalResult.then((result: GuardResult) => {
				if (result !== true) return result;
				if (context.signal.aborted) return false;
				return runRouteGuards();
			});
		}
		if (globalResult !== true) return globalResult;
		return runRouteGuards();
	}

	/** Run route-specific guards if any are registered. */
	private _runRouteGuards(toRoute: string, context: GuardContext): GuardResult | Promise<GuardResult> {
		if (!toRoute || !this._enterGuards.has(toRoute)) return true;
		return this._runGuards(this._enterGuards.get(toRoute)!, context, toRoute);
	}

	/**
	 * Run guards sync; switch to async path if a Promise is returned.
	 *
	 * The guard array is snapshot-copied before iteration so that guards
	 * may safely add/remove themselves (e.g. one-shot guards) without
	 * affecting the current pipeline run.
	 */
	private _runGuards(guards: GuardFn[], context: GuardContext, route: string): GuardResult | Promise<GuardResult> {
		guards = guards.slice();
		for (let i = 0; i < guards.length; i++) {
			try {
				const result = guards[i](context);
				if (isPromiseLike(result)) {
					return this._continueGuardsAsync(
						result,
						guards,
						i,
						context,
						(candidate) => this._validateGuardResult(candidate),
						"Enter guard",
						route,
					);
				}
				if (result !== true) return this._validateGuardResult(result);
			} catch (error) {
				if (context.signal.aborted) return false;
				Log.error(
					`${describeGuard("Enter guard", i, guards[i])} on route "${route}" threw, navigation failed`,
					error instanceof Error ? error : String(error),
					LOG_COMPONENT,
				);
				throw error;
			}
		}
		return true;
	}

	/**
	 * Continue guard array async from the first Promise onward.
	 *
	 * Shared by both enter and leave guard pipelines. The `onBlock` callback
	 * determines what to return for non-true results: leave guards always
	 * return `false`, enter guards validate and may return redirects.
	 *
	 * @param route - The route the guards are registered for, named in error logs.
	 */
	private async _continueGuardsAsync(
		pendingResult: PromiseLike<GuardResult>,
		guards: GuardFn[],
		currentIndex: number,
		context: GuardContext,
		onBlock: (result: unknown) => GuardResult,
		label: string,
		route: string,
	): Promise<GuardResult> {
		let guardIndex = currentIndex;
		try {
			const result = await pendingResult;
			if (result !== true) return onBlock(result);

			for (let i = currentIndex + 1; i < guards.length; i++) {
				if (context.signal.aborted) return false;
				guardIndex = i;
				const nextResult = await guards[i](context);
				if (nextResult !== true) return onBlock(nextResult);
			}
			return true;
		} catch (error) {
			if (!context.signal.aborted) {
				Log.error(
					`${describeGuard(label, guardIndex, guards[guardIndex])} on route "${route}" threw, navigation failed`,
					error instanceof Error ? error : String(error),
					LOG_COMPONENT,
				);
				throw error;
			}
			return false;
		}
	}

	/** Validate a non-true guard result; invalid values become false. */
	private _validateGuardResult(result: unknown): GuardResult {
		if (typeof result === "boolean") return result;
		if (typeof result === "string" && result.length > 0) return result;
		if (isGuardRedirect(result)) return result;
		Log.warning("Guard returned invalid value, treating as block", String(result), LOG_COMPONENT);
		return false;
	}

	/** Validate a leave guard result; non-boolean values log a warning and block. */
	private _validateLeaveGuardResult(result: unknown): boolean {
		if (typeof result === "boolean") return result;
		Log.warning("Leave guard returned non-boolean value, treating as block", String(result), LOG_COMPONENT);
		return false;
	}
}
