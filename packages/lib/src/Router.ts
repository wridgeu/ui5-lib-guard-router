import MobileRouter from "sap/m/routing/Router";
import Log from "sap/base/Log";
import coreLibrary from "sap/ui/core/library";
import type {
	GuardFn,
	GuardContext,
	GuardResult,
	GuardRedirect,
	GuardRouter,
	LeaveGuardFn,
	RouteGuardConfig,
	RouterInternal,
} from "./types";

const HistoryDirection = coreLibrary.routing.HistoryDirection;

const LOG_COMPONENT = "ui5.ext.routing.Router";

function isGuardRedirect(value: GuardResult): value is GuardRedirect {
	return typeof value === "object" && value !== null && typeof value.route === "string";
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
	return value instanceof Promise;
}

function isRouteGuardConfig(guard: GuardFn | RouteGuardConfig): guard is RouteGuardConfig {
	return typeof guard !== "function";
}

/**
 * Router with navigation guard support.
 *
 * Extends `sap.m.routing.Router` by overriding `parse()` to run
 * registered guard functions before any route matching, target loading,
 * or event firing occurs.
 *
 * Key assumptions (see docs/architecture.md for full rationale):
 * - `parse()` is intentionally NOT async. Sync guards execute in the
 *   same tick; async guards fall back to a deferred path.
 * - `replaceHash` fires `hashChanged` synchronously (validated by test).
 * - Redirect targets bypass guards to prevent infinite loops.
 *
 * @extends sap.m.routing.Router
 */
const Router = MobileRouter.extend("ui5.ext.routing.Router", {
	constructor: function (this: RouterInternal, ...args: unknown[]) {
		MobileRouter.prototype.constructor.apply(this, args);
		this._globalGuards = [];
		this._enterGuards = new Map<string, GuardFn[]>();
		this._leaveGuards = new Map<string, LeaveGuardFn[]>();
		this._currentRoute = "";
		this._currentHash = null; // null = no parse processed yet
		this._pendingHash = null;
		this._redirecting = false;
		this._parseGeneration = 0;
		this._suppressNextParse = false;
		this._abortController = null;
	},

	/**
	 * Register a global guard that runs for every navigation.
	 */
	addGuard(this: RouterInternal, guard: GuardFn): GuardRouter {
		this._globalGuards.push(guard);
		return this;
	},

	/**
	 * Remove a previously registered global guard.
	 */
	removeGuard(this: RouterInternal, guard: GuardFn): GuardRouter {
		const index = this._globalGuards.indexOf(guard);
		if (index !== -1) {
			this._globalGuards.splice(index, 1);
		}
		return this;
	},

	/**
	 * Register a guard for a specific route.
	 *
	 * Accepts either a guard function (registered as an enter guard) or a
	 * configuration object with `beforeEnter` and/or `beforeLeave` guards.
	 */
	addRouteGuard(this: RouterInternal, routeName: string, guard: GuardFn | RouteGuardConfig): GuardRouter {
		if (isRouteGuardConfig(guard)) {
			if (guard.beforeEnter) {
				this.addRouteGuard(routeName, guard.beforeEnter);
			}
			if (guard.beforeLeave) {
				this.addLeaveGuard(routeName, guard.beforeLeave);
			}
			return this;
		}
		if (!this._enterGuards.has(routeName)) {
			this._enterGuards.set(routeName, []);
		}
		this._enterGuards.get(routeName)!.push(guard);
		return this;
	},

	/**
	 * Remove a guard from a specific route.
	 *
	 * Accepts the same forms as `addRouteGuard`: a guard function removes
	 * an enter guard; a configuration object removes `beforeEnter` and/or
	 * `beforeLeave` by reference.
	 */
	removeRouteGuard(this: RouterInternal, routeName: string, guard: GuardFn | RouteGuardConfig): GuardRouter {
		if (isRouteGuardConfig(guard)) {
			if (guard.beforeEnter) {
				this.removeRouteGuard(routeName, guard.beforeEnter);
			}
			if (guard.beforeLeave) {
				this.removeLeaveGuard(routeName, guard.beforeLeave);
			}
			return this;
		}
		const guards = this._enterGuards.get(routeName);
		if (guards) {
			const index = guards.indexOf(guard);
			if (index !== -1) {
				guards.splice(index, 1);
			}
			if (guards.length === 0) {
				this._enterGuards.delete(routeName);
			}
		}
		return this;
	},

	/**
	 * Register a leave guard for a specific route.
	 *
	 * Leave guards run when navigating **away from** the route, before any
	 * enter guards for the target route. They answer the binary question
	 * "can I leave?" and return only a boolean (no redirects).
	 */
	addLeaveGuard(this: RouterInternal, routeName: string, guard: LeaveGuardFn): GuardRouter {
		if (!this._leaveGuards.has(routeName)) {
			this._leaveGuards.set(routeName, []);
		}
		this._leaveGuards.get(routeName)!.push(guard);
		return this;
	},

	/**
	 * Remove a leave guard from a specific route.
	 */
	removeLeaveGuard(this: RouterInternal, routeName: string, guard: LeaveGuardFn): GuardRouter {
		const guards = this._leaveGuards.get(routeName);
		if (guards) {
			const index = guards.indexOf(guard);
			if (index !== -1) {
				guards.splice(index, 1);
			}
			if (guards.length === 0) {
				this._leaveGuards.delete(routeName);
			}
		}
		return this;
	},

	parse(this: RouterInternal, newHash: string): void {
		if (this._suppressNextParse) {
			this._suppressNextParse = false;
			return;
		}

		if (this._redirecting) {
			this._commitNavigation(newHash);
			return;
		}

		// Same-hash dedup: also invalidates any pending async guard
		if (this._currentHash !== null && newHash === this._currentHash) {
			this._pendingHash = null;
			++this._parseGeneration;
			this._abortController?.abort();
			this._abortController = null;
			return;
		}

		// Dedup against in-flight pending navigation
		if (this._pendingHash !== null && newHash === this._pendingHash) {
			return;
		}

		const routeInfo = this.getRouteInfoByHash(newHash);
		const toRoute = routeInfo?.name ?? "";

		// Invalidate any pending async guards from a previous navigation
		this._abortController?.abort();
		this._abortController = null;
		const generation = ++this._parseGeneration;

		this._pendingHash = newHash;

		// Check if any guards apply (leave OR enter)
		const hasLeaveGuards = this._currentRoute !== "" && this._leaveGuards.has(this._currentRoute);
		const hasEnterGuards = this._globalGuards.length > 0 || (toRoute !== "" && this._enterGuards.has(toRoute));

		// No guards → fast path
		if (!hasLeaveGuards && !hasEnterGuards) {
			this._commitNavigation(newHash, toRoute);
			return;
		}

		// Only create a controller when guards will actually run
		this._abortController = new AbortController();

		const context: GuardContext = {
			toRoute,
			toHash: newHash,
			toArguments: routeInfo?.arguments ?? {},
			fromRoute: this._currentRoute,
			fromHash: this._currentHash ?? "",
			signal: this._abortController.signal,
		};

		// Run leave guards first, then enter guards
		if (hasLeaveGuards) {
			const leaveResult = this._runLeaveGuards(context);

			if (isPromiseLike(leaveResult)) {
				leaveResult
					.then((allowed: boolean) => {
						if (generation !== this._parseGeneration) {
							Log.debug(
								"Async leave guard result discarded (superseded by newer navigation)",
								newHash,
								LOG_COMPONENT,
							);
							return;
						}
						if (allowed !== true) {
							this._pendingHash = null;
							this._restoreHash();
							return;
						}
						this._runEnterPipeline(generation, newHash, toRoute, context);
					})
					.catch((error: unknown) => {
						if (generation !== this._parseGeneration) return;
						Log.error("Async leave guard failed, blocking navigation", String(error), LOG_COMPONENT);
						this._pendingHash = null;
						this._restoreHash();
					});
				return;
			}
			if (leaveResult !== true) {
				this._pendingHash = null;
				this._restoreHash();
				return;
			}
		}

		// Enter pipeline (leave guards passed or were absent)
		this._runEnterPipeline(generation, newHash, toRoute, context);
	},

	/**
	 * Run leave guards for the current route. Returns boolean (no redirects).
	 *
	 * Note: the guard array is iterated by index. Mutating the array during
	 * iteration (e.g. calling removeLeaveGuard from inside a guard) may cause
	 * guards to be skipped or run twice. Avoid modifying guards mid-pipeline.
	 */
	_runLeaveGuards(this: RouterInternal, context: GuardContext): boolean | Promise<boolean> {
		const guards = this._leaveGuards.get(this._currentRoute);
		if (!guards || guards.length === 0) return true;

		for (let i = 0; i < guards.length; i++) {
			try {
				const result = guards[i](context);
				if (isPromiseLike(result)) {
					return this._finishLeaveGuardsAsync(result, guards, i, context);
				}
				if (result !== true) return false;
			} catch (error) {
				Log.error(`Leave guard [${i}] threw an error, blocking navigation`, String(error), LOG_COMPONENT);
				return false;
			}
		}
		return true;
	},

	/** Continue leave guard list async from the first Promise onward. */
	async _finishLeaveGuardsAsync(
		this: RouterInternal,
		pendingResult: Promise<boolean>,
		guards: LeaveGuardFn[],
		currentIndex: number,
		context: GuardContext,
	): Promise<boolean> {
		let guardIndex = currentIndex;
		try {
			const result = await pendingResult;
			if (result !== true) return false;

			for (let i = currentIndex + 1; i < guards.length; i++) {
				if (context.signal.aborted) return false;
				guardIndex = i;
				const r = await guards[i](context);
				if (r !== true) return false;
			}
			return true;
		} catch (error) {
			if (!context.signal.aborted) {
				Log.error(
					`Leave guard [${guardIndex}] threw an error, blocking navigation`,
					String(error),
					LOG_COMPONENT,
				);
			}
			return false;
		}
	},

	/** Run the enter guard pipeline (global + route-specific) and handle the result. */
	_runEnterPipeline(
		this: RouterInternal,
		generation: number,
		newHash: string,
		toRoute: string,
		context: GuardContext,
	): void {
		const result = this._runAllGuards(this._globalGuards, toRoute, context);

		if (isPromiseLike(result)) {
			result
				.then((guardResult: GuardResult) => {
					if (generation !== this._parseGeneration) {
						Log.debug(
							"Async guard result discarded (superseded by newer navigation)",
							newHash,
							LOG_COMPONENT,
						);
						return;
					}
					if (guardResult === true) {
						this._commitNavigation(newHash, toRoute);
					} else {
						this._handleGuardResult(guardResult);
					}
				})
				.catch((error: unknown) => {
					if (generation !== this._parseGeneration) return;
					Log.error("Async guard chain failed, blocking navigation", String(error), LOG_COMPONENT);
					this._pendingHash = null;
					this._restoreHash();
				});
		} else if (result === true) {
			this._commitNavigation(newHash, toRoute);
		} else {
			this._handleGuardResult(result);
		}
	},

	/** Delegate to the parent router and update internal state. */
	_commitNavigation(this: RouterInternal, hash: string, route?: string): void {
		this._pendingHash = null;
		MobileRouter.prototype.parse.call(this, hash);
		this._currentHash = hash;
		this._currentRoute = route ?? this.getRouteInfoByHash(hash)?.name ?? "";
	},

	/** Run global guards, then route-specific guards. Stays sync when possible. */
	_runAllGuards(
		this: RouterInternal,
		globalGuards: GuardFn[],
		toRoute: string,
		context: GuardContext,
	): GuardResult | Promise<GuardResult> {
		const globalResult = this._runGuardListSync(globalGuards, context);

		if (isPromiseLike(globalResult)) {
			return globalResult.then((r: GuardResult) => {
				if (r !== true) return r;
				if (context.signal.aborted) return false;
				return this._runEnterGuards(toRoute, context);
			});
		}
		if (globalResult !== true) return globalResult;
		return this._runEnterGuards(toRoute, context);
	},

	/** Run route-specific guards if any are registered. */
	_runEnterGuards(this: RouterInternal, toRoute: string, context: GuardContext): GuardResult | Promise<GuardResult> {
		if (!toRoute || !this._enterGuards.has(toRoute)) return true;
		return this._runGuardListSync(this._enterGuards.get(toRoute)!, context);
	},

	/**
	 * Run guards sync; switch to async path if a Promise is returned.
	 *
	 * Note: the guard array is iterated by index. Mutating the array during
	 * iteration (e.g. calling removeGuard from inside a guard) may cause
	 * guards to be skipped or run twice. Avoid modifying guards mid-pipeline.
	 */
	_runGuardListSync(
		this: RouterInternal,
		guards: GuardFn[],
		context: GuardContext,
	): GuardResult | Promise<GuardResult> {
		for (let i = 0; i < guards.length; i++) {
			try {
				const result = guards[i](context);
				if (isPromiseLike(result)) {
					return this._finishGuardListAsync(result, guards, i, context);
				}
				if (result !== true) return this._validateGuardResult(result);
			} catch (error) {
				Log.error(`Enter guard [${i}] threw an error, blocking navigation`, String(error), LOG_COMPONENT);
				return false;
			}
		}
		return true;
	},

	/** Continue guard list async from the first Promise onward. */
	async _finishGuardListAsync(
		this: RouterInternal,
		pendingResult: Promise<GuardResult>,
		guards: GuardFn[],
		currentIndex: number,
		context: GuardContext,
	): Promise<GuardResult> {
		let guardIndex = currentIndex;
		try {
			const result = await pendingResult;
			if (result !== true) return this._validateGuardResult(result);

			for (let i = currentIndex + 1; i < guards.length; i++) {
				if (context.signal.aborted) return false;
				guardIndex = i;
				const r = await guards[i](context);
				if (r !== true) return this._validateGuardResult(r);
			}
			return true;
		} catch (error) {
			if (!context.signal.aborted) {
				Log.error(
					`Enter guard [${guardIndex}] threw an error, blocking navigation`,
					String(error),
					LOG_COMPONENT,
				);
			}
			return false;
		}
	},

	/** Validate a non-true guard result; invalid values become false. */
	_validateGuardResult(this: RouterInternal, result: GuardResult): GuardResult {
		if (typeof result === "string" || typeof result === "boolean" || isGuardRedirect(result)) {
			return result;
		}
		Log.warning("Guard returned invalid value, treating as block", String(result), LOG_COMPONENT);
		return false;
	},

	/** Handle a block or redirect result. */
	_handleGuardResult(this: RouterInternal, result: GuardResult): void {
		this._pendingHash = null;
		if (result === false) {
			this._restoreHash();
			return;
		}
		this._redirecting = true;
		try {
			if (typeof result === "string") {
				this.navTo(result, {}, {}, true);
			} else if (isGuardRedirect(result)) {
				this.navTo(result.route, result.parameters ?? {}, result.componentTargetInfo, true);
			}
		} finally {
			this._redirecting = false;
		}
	},

	/**
	 * Restore the previous hash without creating a history entry.
	 * Assumes replaceHash fires hashChanged synchronously (validated by test).
	 * Note: _currentRoute intentionally stays unchanged — the blocked navigation
	 * never committed, so the user remains on the same logical route.
	 */
	_restoreHash(this: RouterInternal): void {
		const hashChanger = this.getHashChanger();
		if (hashChanger) {
			this._suppressNextParse = true;
			hashChanger.replaceHash(this._currentHash ?? "", HistoryDirection.Unknown);
			if (this._suppressNextParse) {
				// replaceHash was a no-op (same hash) - reset to prevent leak
				this._suppressNextParse = false;
			}
		}
	},

	/** Clean up guards on destroy. Bumps generation to discard pending async results. */
	destroy(this: RouterInternal) {
		this._globalGuards = [];
		this._enterGuards.clear();
		this._leaveGuards.clear();
		++this._parseGeneration;
		this._pendingHash = null;
		this._abortController?.abort();
		this._abortController = null;
		return MobileRouter.prototype.destroy.call(this);
	},
});

export default Router;
