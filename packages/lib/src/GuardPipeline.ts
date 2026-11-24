import Log from "sap/base/Log";
import type { GuardFn, GuardContext, GuardResult, GuardRedirect } from "./types";

/** The component under which the library logs. */
export const LOG_COMPONENT = "ui5.guard.router.Router";

function isGuardRedirect(value: unknown): value is GuardRedirect {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	return "route" in value && typeof value.route === "string" && value.route.length > 0;
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

	return "then" in value && typeof value.then === "function";
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

function toDecision(result: GuardResult): GuardDecision {
	if (result === true) return { action: "allow" };
	if (result === false) return { action: "block" };
	return { action: "redirect", target: result };
}

function toErrorDecision(error: unknown): GuardDecision {
	return { action: "error", error };
}

/** Validate a non-true guard result; invalid values become false. */
function validateGuardResult(result: unknown): GuardResult {
	if (typeof result === "boolean") return result;
	if (typeof result === "string" && result.length > 0) return result;
	if (isGuardRedirect(result)) return result;
	Log.warning("Guard returned invalid value, treating as block", String(result), LOG_COMPONENT);
	return false;
}

/** Validate a leave guard result; non-boolean values log a warning and block. */
function validateLeaveGuardResult(result: unknown): boolean {
	if (typeof result === "boolean") return result;
	Log.warning("Leave guard returned non-boolean value, treating as block", String(result), LOG_COMPONENT);
	return false;
}

function logGuardError(label: string, index: number, guard: GuardFn, route: string, error: unknown): void {
	Log.error(
		`${describeGuard(label, index, guard)} on route "${route}" threw, navigation failed`,
		error instanceof Error ? error : String(error),
		LOG_COMPONENT,
	);
}

function addToGuardMap(map: Map<string, GuardFn[]>, key: string, guard: GuardFn, before?: GuardFn): void {
	let guards = map.get(key);
	if (!guards) {
		guards = [];
		map.set(key, guards);
	}
	const index = before === undefined ? -1 : guards.indexOf(before);
	if (index === -1) guards.push(guard);
	else guards.splice(index, 0, guard);
}

function removeFromGuardMap(map: Map<string, GuardFn[]>, key: string, guard: GuardFn): void {
	const guards = map.get(key);
	if (!guards) return;
	const index = guards.indexOf(guard);
	if (index !== -1) guards.splice(index, 1);
	if (guards.length === 0) map.delete(key);
}

/**
 * Standalone guard evaluation pipeline.
 *
 * Owns guard storage (global, enter, leave) and runs the full
 * leave -> global-enter -> route-enter pipeline. It reads no Router
 * state: evaluate() receives the context and the greedy routes left
 * and entered with it.
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
	 * @param before - A guard of the route to register `guard` in front of; at the end without it.
	 */
	addEnterGuard(route: string, guard: GuardFn, before?: GuardFn): void {
		addToGuardMap(this._enterGuards, route, guard, before);
	}

	/**
	 * Remove a previously registered enter guard by reference.
	 */
	removeEnterGuard(route: string, guard: GuardFn): void {
		removeFromGuardMap(this._enterGuards, route, guard);
	}

	/**
	 * Register a leave guard for a specific route.
	 *
	 * Accepts `GuardFn` to support manifest-declared guards loaded from
	 * untyped modules. Non-boolean return values are caught at runtime
	 * by {@link validateLeaveGuardResult}.
	 *
	 * @param route - Route name as defined in `manifest.json`.
	 * @param guard - Guard function to register as a leave guard.
	 * @param before - A leave guard of the route to register `guard` in front of; at the end without it.
	 */
	addLeaveGuard(route: string, guard: GuardFn, before?: GuardFn): void {
		addToGuardMap(this._leaveGuards, route, guard, before);
	}

	/**
	 * Remove a previously registered leave guard by reference.
	 */
	removeLeaveGuard(route: string, guard: GuardFn): void {
		removeFromGuardMap(this._leaveGuards, route, guard);
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

		const runEnterPhase = (): GuardDecision | Promise<GuardDecision> => {
			const enterResult = this._runEnterGuards(entering, context);
			return isPromiseLike(enterResult)
				? enterResult.then(toDecision).catch(toErrorDecision)
				: toDecision(enterResult);
		};

		try {
			const leaveResult = this._runForEach(leaving, context, (route) =>
				this._runGuards(
					this._leaveGuards.get(route) ?? [],
					context,
					route,
					validateLeaveGuardResult,
					"Leave guard",
				),
			);

			if (isPromiseLike(leaveResult)) {
				return leaveResult
					.then((allowed: GuardResult): GuardDecision | Promise<GuardDecision> => {
						if (allowed !== true) return { action: "block" };
						if (context.signal.aborted) return { action: "block" };
						return runEnterPhase();
					})
					.catch(toErrorDecision);
			}
			if (leaveResult !== true || context.signal.aborted) return { action: "block" };

			return runEnterPhase();
		} catch (error) {
			return toErrorDecision(error);
		}
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
			if (context.signal.aborted) return false;
		}
		return true;
	}

	/** Run global guards, then the route-specific guards of each route in `entering`. Stays sync when possible. */
	private _runEnterGuards(entering: string[], context: GuardContext): GuardResult | Promise<GuardResult> {
		const runRouteGuards = (): GuardResult | Promise<GuardResult> =>
			this._runForEach(entering, context, (route) => {
				const guards = route ? this._enterGuards.get(route) : undefined;
				if (!guards) return true;
				return this._runGuards(guards, context, route, validateGuardResult, "Enter guard");
			});
		const globalResult = this._runGuards(
			this._globalGuards,
			context,
			context.toRoute,
			validateGuardResult,
			"Enter guard",
		);

		if (isPromiseLike(globalResult)) {
			return globalResult.then((result: GuardResult) => {
				if (result !== true) return result;
				if (context.signal.aborted) return false;
				return runRouteGuards();
			});
		}
		if (globalResult !== true) return globalResult;
		if (context.signal.aborted) return false;
		return runRouteGuards();
	}

	/**
	 * Run guards sync; switch to async path if a Promise is returned. A result that is not
	 * `true` ends the run with what `onBlock` makes of it.
	 *
	 * The guard array is snapshot-copied before iteration so that guards
	 * may safely add/remove themselves (e.g. one-shot guards) without
	 * affecting the current pipeline run.
	 *
	 * @param route - The route the guards are registered for, named in error logs.
	 */
	private _runGuards(
		guards: GuardFn[],
		context: GuardContext,
		route: string,
		onBlock: (result: unknown) => GuardResult,
		label: string,
	): GuardResult | Promise<GuardResult> {
		guards = guards.slice();
		for (let i = 0; i < guards.length; i++) {
			try {
				const result = guards[i](context);
				if (isPromiseLike(result)) {
					return this._continueGuardsAsync(result, guards, i, context, onBlock, label, route);
				}
				if (context.signal.aborted) return false;
				if (result !== true) return onBlock(result);
			} catch (error) {
				if (context.signal.aborted) return false;
				logGuardError(label, i, guards[i], route, error);
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
			// An aborted navigation discards the result: it is neither validated nor followed by the next guard.
			const result = await pendingResult;
			if (context.signal.aborted) return false;
			if (result !== true) return onBlock(result);

			for (let i = currentIndex + 1; i < guards.length; i++) {
				guardIndex = i;
				const nextResult = await guards[i](context);
				if (context.signal.aborted) return false;
				if (nextResult !== true) return onBlock(nextResult);
			}
			return true;
		} catch (error) {
			if (!context.signal.aborted) {
				logGuardError(label, guardIndex, guards[guardIndex], route, error);
				throw error;
			}
			return false;
		}
	}
}
