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
	return typeof value === "object" && value !== null;
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
	return value instanceof Promise;
}

function isRouteGuardConfig(guard: GuardFn | RouteGuardConfig): guard is RouteGuardConfig {
	return typeof guard === "object";
}

function addToGuardMap<T>(map: Map<string, T[]>, key: string, guard: T): void {
	let guards = map.get(key);
	if (!guards) {
		guards = [];
		map.set(key, guards);
	}
	guards.push(guard);
}

function removeFromGuardMap<T>(map: Map<string, T[]>, key: string, guard: T): void {
	const guards = map.get(key);
	if (!guards) return;
	const index = guards.indexOf(guard);
	if (index !== -1) guards.splice(index, 1);
	if (guards.length === 0) map.delete(key);
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
			if (!guard.beforeEnter && !guard.beforeLeave) {
				Log.info(
					"addRouteGuard called with config missing both beforeEnter and beforeLeave",
					routeName,
					LOG_COMPONENT,
				);
			}
			if (guard.beforeEnter) {
				this.addRouteGuard(routeName, guard.beforeEnter);
			}
			if (guard.beforeLeave) {
				this.addLeaveGuard(routeName, guard.beforeLeave);
			}
			return this;
		}
		addToGuardMap(this._enterGuards, routeName, guard);
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
		removeFromGuardMap(this._enterGuards, routeName, guard);
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
		addToGuardMap(this._leaveGuards, routeName, guard);
		return this;
	},

	/**
	 * Remove a leave guard from a specific route.
	 */
	removeLeaveGuard(this: RouterInternal, routeName: string, guard: LeaveGuardFn): GuardRouter {
		removeFromGuardMap(this._leaveGuards, routeName, guard);
		return this;
	},

	/**
	 * Intercept hash changes and run the guard pipeline before route matching.
	 *
	 * Called by the HashChanger on every `hashChanged` event. Runs leave guards
	 * (current route), then global + route-specific enter guards (target route).
	 * Stays synchronous when all guards return plain values; falls back to async
	 * when a guard returns a Promise. A generation counter discards stale results
	 * when navigations overlap.
	 *
	 * @override sap.ui.core.routing.Router#parse
	 */
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

		// Run enter guards and apply result (reused after leave guards pass)
		const runEnterGuards = (): void => {
			const enterResult = this._runEnterGuards(this._globalGuards, toRoute, context);

			if (isPromise(enterResult)) {
				enterResult
					.then((guardResult: GuardResult) => {
						if (generation !== this._parseGeneration) {
							Log.debug(
								"Async enter guard result discarded (superseded by newer navigation)",
								newHash,
								LOG_COMPONENT,
							);
							return;
						}
						// Apply result: true=commit, false=block, other=redirect
						if (guardResult === true) {
							this._commitNavigation(newHash, toRoute);
						} else if (guardResult === false) {
							this._blockNavigation();
						} else {
							this._redirect(guardResult);
						}
					})
					.catch((error: unknown) => {
						if (generation !== this._parseGeneration) return;
						Log.error(
							`Async enter guard for route "${toRoute}" failed, blocking navigation`,
							String(error),
							LOG_COMPONENT,
						);
						this._blockNavigation();
					});
				return;
			}
			// Apply result: true=commit, false=block, other=redirect
			if (enterResult === true) {
				this._commitNavigation(newHash, toRoute);
			} else if (enterResult === false) {
				this._blockNavigation();
			} else {
				this._redirect(enterResult);
			}
		};

		// Run leave guards first, then enter guards
		if (hasLeaveGuards) {
			const leaveResult = this._runLeaveGuards(context);

			if (isPromise(leaveResult)) {
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
							this._blockNavigation();
							return;
						}
						runEnterGuards();
					})
					.catch((error: unknown) => {
						if (generation !== this._parseGeneration) return;
						Log.error(
							`Async leave guard on route "${this._currentRoute}" failed, blocking navigation`,
							String(error),
							LOG_COMPONENT,
						);
						this._blockNavigation();
					});
				return;
			}
			if (leaveResult !== true) {
				this._blockNavigation();
				return;
			}
		}

		// Enter guards (leave guards passed or were absent)
		runEnterGuards();
	},

	/**
	 * Run leave guards for the current route. Returns boolean (no redirects).
	 *
	 * The guard array is snapshot-copied before iteration so that guards
	 * may safely add/remove themselves (e.g. one-shot guards) without
	 * affecting the current pipeline run.
	 */
	_runLeaveGuards(this: RouterInternal, context: GuardContext): boolean | Promise<boolean> {
		const registered = this._leaveGuards.get(this._currentRoute);
		if (!registered || registered.length === 0) return true;

		const guards = registered.slice();
		for (let i = 0; i < guards.length; i++) {
			try {
				const result = guards[i](context);
				if (isPromise(result)) {
					return this._continueGuardsAsync(
						result,
						guards,
						i,
						context,
						() => false,
						"Leave guard",
						true,
					) as Promise<boolean>;
				}
				if (result !== true) return false;
			} catch (error) {
				Log.error(
					`Leave guard [${i}] on route "${this._currentRoute}" threw, blocking navigation`,
					String(error),
					LOG_COMPONENT,
				);
				return false;
			}
		}
		return true;
	},

	/**
	 * Delegate to the parent router and update internal state.
	 *
	 * State is updated BEFORE calling parse to ensure that if event handlers
	 * (e.g., routeMatched) trigger nested navigation, the leave guards will
	 * run for the correct (new) route rather than the old one.
	 */
	_commitNavigation(this: RouterInternal, hash: string, route?: string): void {
		this._pendingHash = null;
		this._currentHash = hash;
		this._currentRoute = route ?? this.getRouteInfoByHash(hash)?.name ?? "";
		MobileRouter.prototype.parse.call(this, hash);
	},

	/** Run global guards, then route-specific guards. Stays sync when possible. */
	_runEnterGuards(
		this: RouterInternal,
		globalGuards: GuardFn[],
		toRoute: string,
		context: GuardContext,
	): GuardResult | Promise<GuardResult> {
		const globalResult = this._runGuards(globalGuards, context);

		if (isPromise(globalResult)) {
			return globalResult.then((r: GuardResult) => {
				if (r !== true) return r;
				if (context.signal.aborted) return false;
				return this._runRouteGuards(toRoute, context);
			});
		}
		if (globalResult !== true) return globalResult;
		return this._runRouteGuards(toRoute, context);
	},

	/** Run route-specific guards if any are registered. */
	_runRouteGuards(this: RouterInternal, toRoute: string, context: GuardContext): GuardResult | Promise<GuardResult> {
		if (!toRoute || !this._enterGuards.has(toRoute)) return true;
		return this._runGuards(this._enterGuards.get(toRoute)!, context);
	},

	/**
	 * Run guards sync; switch to async path if a Promise is returned.
	 *
	 * The guard array is snapshot-copied before iteration so that guards
	 * may safely add/remove themselves (e.g. one-shot guards) without
	 * affecting the current pipeline run.
	 */
	_runGuards(this: RouterInternal, guards: GuardFn[], context: GuardContext): GuardResult | Promise<GuardResult> {
		guards = guards.slice();
		for (let i = 0; i < guards.length; i++) {
			try {
				const result = guards[i](context);
				if (isPromise(result)) {
					return this._continueGuardsAsync(
						result,
						guards,
						i,
						context,
						(r) => this._validateGuardResult(r),
						"Enter guard",
						false,
					);
				}
				if (result !== true) return this._validateGuardResult(result);
			} catch (error) {
				Log.error(
					`Enter guard [${i}] for route "${context.toRoute}" threw, blocking navigation`,
					String(error),
					LOG_COMPONENT,
				);
				return false;
			}
		}
		return true;
	},

	/**
	 * Continue guard array async from the first Promise onward.
	 *
	 * Shared by both enter and leave guard pipelines. The `onBlock` callback
	 * determines what to return for non-true results: leave guards always
	 * return `false`, enter guards validate and may return redirects.
	 *
	 * @param isLeaveGuard - When true, error logs reference `fromRoute`; otherwise `toRoute`.
	 */
	async _continueGuardsAsync(
		this: RouterInternal,
		pendingResult: Promise<GuardResult>,
		guards: Array<(context: GuardContext) => GuardResult | Promise<GuardResult>>,
		currentIndex: number,
		context: GuardContext,
		onBlock: (result: GuardResult) => GuardResult,
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
				const r = await guards[i](context);
				if (r !== true) return onBlock(r);
			}
			return true;
		} catch (error) {
			if (!context.signal.aborted) {
				const route = isLeaveGuard ? context.fromRoute : context.toRoute;
				Log.error(
					`${label} [${guardIndex}] on route "${route}" threw, blocking navigation`,
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

	/** Perform a guard redirect (string route name or GuardRedirect object). */
	_redirect(this: RouterInternal, target: string | GuardRedirect): void {
		this._pendingHash = null;
		this._redirecting = true;
		try {
			if (typeof target === "string") {
				this.navTo(target, {}, {}, true);
			} else {
				this.navTo(target.route, target.parameters ?? {}, target.componentTargetInfo, true);
			}
		} finally {
			this._redirecting = false;
		}
	},

	/** Clear pending state and restore the previous hash. */
	_blockNavigation(this: RouterInternal): void {
		this._pendingHash = null;
		this._restoreHash();
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
