import Log from "sap/base/Log";
import type { GuardFn, GuardContext, GuardResult, GuardRedirect } from "./types";

const LOG_COMPONENT = "ui5.guard.router.Router";

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
	 * @returns A synchronous {@link GuardDecision} when all guards return plain values,
	 *   or a `Promise<GuardDecision>` when at least one guard returns a thenable.
	 */
	evaluate(context: GuardContext, options?: { skipLeaveGuards?: boolean }): GuardDecision | Promise<GuardDecision> {
		const hasLeaveGuards =
			!options?.skipLeaveGuards && context.fromRoute !== "" && this._leaveGuards.has(context.fromRoute);
		const hasEnterGuards =
			this._globalGuards.length > 0 || (context.toRoute !== "" && this._enterGuards.has(context.toRoute));

		if (!hasLeaveGuards && !hasEnterGuards) {
			return { action: "allow" };
		}

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
			const enterResult = this._runEnterGuards(context.toRoute, context);
			return processEnterResult(enterResult);
		};

		try {
			if (hasLeaveGuards) {
				const leaveResult = this._runLeaveGuards(context);

				if (isPromiseLike(leaveResult)) {
					return leaveResult
						.then((allowed: boolean): GuardDecision | Promise<GuardDecision> => {
							if (allowed !== true) return { action: "block" };
							if (context.signal.aborted) return { action: "block" };
							return runEnterPhase();
						})
						.catch((error: unknown): GuardDecision => {
							return { action: "error", error };
						});
				}
				if (leaveResult !== true) return { action: "block" };
			}

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
	 * Run leave guards for the current route. Returns boolean (no redirects).
	 *
	 * The guard array is snapshot-copied before iteration so that guards
	 * may safely add/remove themselves (e.g. one-shot guards) without
	 * affecting the current pipeline run.
	 */
	private _runLeaveGuards(context: GuardContext): boolean | Promise<boolean> {
		const registered = this._leaveGuards.get(context.fromRoute);
		if (!registered || registered.length === 0) return true;

		const guards = registered.slice();
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
						true,
					) as Promise<boolean>;
				}
				if (result !== true) return this._validateLeaveGuardResult(result);
			} catch (error) {
				Log.error(
					`Leave guard [${i}] on route "${context.fromRoute}" threw, navigation failed`,
					String(error),
					LOG_COMPONENT,
				);
				if (context.signal.aborted) return false;
				throw error;
			}
		}
		return true;
	}

	/** Run global guards, then route-specific guards. Stays sync when possible. */
	private _runEnterGuards(toRoute: string, context: GuardContext): GuardResult | Promise<GuardResult> {
		const globalResult = this._runGuards(this._globalGuards, context);

		if (isPromiseLike(globalResult)) {
			return globalResult.then((result: GuardResult) => {
				if (result !== true) return result;
				if (context.signal.aborted) return false;
				return this._runRouteGuards(toRoute, context);
			});
		}
		if (globalResult !== true) return globalResult;
		return this._runRouteGuards(toRoute, context);
	}

	/** Run route-specific guards if any are registered. */
	private _runRouteGuards(toRoute: string, context: GuardContext): GuardResult | Promise<GuardResult> {
		if (!toRoute || !this._enterGuards.has(toRoute)) return true;
		return this._runGuards(this._enterGuards.get(toRoute)!, context);
	}

	/**
	 * Run guards sync; switch to async path if a Promise is returned.
	 *
	 * The guard array is snapshot-copied before iteration so that guards
	 * may safely add/remove themselves (e.g. one-shot guards) without
	 * affecting the current pipeline run.
	 */
	private _runGuards(guards: GuardFn[], context: GuardContext): GuardResult | Promise<GuardResult> {
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
						false,
					);
				}
				if (result !== true) return this._validateGuardResult(result);
			} catch (error) {
				Log.error(
					`Enter guard [${i}] on route "${context.toRoute}" threw, navigation failed`,
					String(error),
					LOG_COMPONENT,
				);
				if (context.signal.aborted) return false;
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
	 * @param isLeaveGuard - When true, error logs reference `fromRoute`; otherwise `toRoute`.
	 */
	private async _continueGuardsAsync(
		pendingResult: PromiseLike<GuardResult>,
		guards: GuardFn[],
		currentIndex: number,
		context: GuardContext,
		onBlock: (result: unknown) => GuardResult,
		label: string,
		isLeaveGuard: boolean,
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
				const route = isLeaveGuard ? context.fromRoute : context.toRoute;
				Log.error(
					`${label} [${guardIndex}] on route "${route}" threw, navigation failed`,
					String(error),
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
