import MobileRouter from "sap/m/routing/Router";
import Log from "sap/base/Log";
import coreLibrary from "sap/ui/core/library";
import type { GuardFn, GuardContext, GuardResult, GuardRedirect, RouterInstance } from "./types";

const HistoryDirection = coreLibrary.routing.HistoryDirection;

const LOG_COMPONENT = "ui5.ext.routing.Router";

function isGuardRedirect(value: GuardResult): value is GuardRedirect {
	return typeof value === "object" && value !== null && typeof value.route === "string";
}

function isThenable(value: GuardResult | Promise<GuardResult>): value is Promise<GuardResult> {
	return typeof value === "object" && value !== null && typeof (value as Promise<GuardResult>).then === "function";
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
	constructor: function (this: RouterInstance, ...args: unknown[]) {
		MobileRouter.prototype.constructor.apply(this, args);
		this._globalGuards = [] as GuardFn[];
		this._routeGuards = new Map<string, GuardFn[]>();
		this._currentRoute = "";
		this._currentHash = null as string | null; // null = no parse processed yet
		this._redirecting = false;
		this._parseGeneration = 0;
		this._suppressNextParse = false;
	},

	/**
	 * Register a global guard that runs for every navigation.
	 */
	addGuard(this: RouterInstance, guard: GuardFn): RouterInstance {
		this._globalGuards.push(guard);
		return this;
	},

	/**
	 * Remove a previously registered global guard.
	 */
	removeGuard(this: RouterInstance, guard: GuardFn): RouterInstance {
		const index = this._globalGuards.indexOf(guard);
		if (index !== -1) {
			this._globalGuards.splice(index, 1);
		}
		return this;
	},

	/**
	 * Register a guard for a specific route.
	 */
	addRouteGuard(this: RouterInstance, routeName: string, guard: GuardFn): RouterInstance {
		if (!this._routeGuards.has(routeName)) {
			this._routeGuards.set(routeName, []);
		}
		this._routeGuards.get(routeName)!.push(guard);
		return this;
	},

	/**
	 * Remove a guard from a specific route.
	 */
	removeRouteGuard(this: RouterInstance, routeName: string, guard: GuardFn): RouterInstance {
		const guards = this._routeGuards.get(routeName);
		if (guards) {
			const index = guards.indexOf(guard);
			if (index !== -1) {
				guards.splice(index, 1);
			}
			if (guards.length === 0) {
				this._routeGuards.delete(routeName);
			}
		}
		return this;
	},

	parse(this: RouterInstance, newHash: string): void {
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
			++this._parseGeneration;
			return;
		}

		const routeInfo = this.getRouteInfoByHash(newHash);
		const toRoute = routeInfo ? routeInfo.name : "";
		const generation = ++this._parseGeneration;

		// No guards → fast path
		if (this._globalGuards.length === 0 && (!toRoute || !this._routeGuards.has(toRoute))) {
			this._commitNavigation(newHash, toRoute);
			return;
		}

		const context: GuardContext = {
			toRoute,
			toHash: newHash,
			toArguments: (routeInfo ? routeInfo.arguments : {}) as Record<string, string>,
			fromRoute: this._currentRoute,
			fromHash: this._currentHash ?? "",
		};

		const result = this._runAllGuards(this._globalGuards, toRoute, context);

		if (isThenable(result)) {
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
					this._restoreHash();
				});
		} else if (result === true) {
			this._commitNavigation(newHash, toRoute);
		} else {
			this._handleGuardResult(result);
		}
	},

	/** Delegate to the parent router and update internal state. */
	_commitNavigation(this: RouterInstance, hash: string, route?: string): void {
		MobileRouter.prototype.parse.call(this, hash);
		this._currentHash = hash;
		if (route !== undefined) {
			this._currentRoute = route;
		} else {
			const routeInfo = this.getRouteInfoByHash(hash);
			this._currentRoute = routeInfo ? routeInfo.name : "";
		}
	},

	/** Run global guards, then route-specific guards. Stays sync when possible. */
	_runAllGuards(
		this: RouterInstance,
		globalGuards: GuardFn[],
		toRoute: string,
		context: GuardContext,
	): GuardResult | Promise<GuardResult> {
		const globalResult = this._runGuardListSync(globalGuards, context);

		if (isThenable(globalResult)) {
			return globalResult.then((r: GuardResult) => {
				if (r !== true) return r;
				return this._runRouteGuards(toRoute, context);
			});
		}
		if (globalResult !== true) return globalResult;
		return this._runRouteGuards(toRoute, context);
	},

	/** Run route-specific guards if any are registered. */
	_runRouteGuards(this: RouterInstance, toRoute: string, context: GuardContext): GuardResult | Promise<GuardResult> {
		if (!toRoute || !this._routeGuards.has(toRoute)) return true;
		return this._runGuardListSync(this._routeGuards.get(toRoute)!, context);
	},

	/** Run guards sync; switch to async path if a Promise is returned. */
	_runGuardListSync(
		this: RouterInstance,
		guards: GuardFn[],
		context: GuardContext,
	): GuardResult | Promise<GuardResult> {
		for (let i = 0; i < guards.length; i++) {
			try {
				const result = guards[i](context);
				if (isThenable(result)) {
					return this._finishGuardListAsync(result, guards, i, context);
				}
				if (result !== true) return this._validateGuardResult(result);
			} catch (error) {
				Log.error("Guard threw an error, blocking navigation", String(error), LOG_COMPONENT);
				return false;
			}
		}
		return true;
	},

	/** Continue guard list async from the first Promise onward. */
	async _finishGuardListAsync(
		this: RouterInstance,
		pendingResult: Promise<GuardResult>,
		guards: GuardFn[],
		currentIndex: number,
		context: GuardContext,
	): Promise<GuardResult> {
		try {
			const result = await pendingResult;
			if (result !== true) return this._validateGuardResult(result);

			for (let i = currentIndex + 1; i < guards.length; i++) {
				const r = await guards[i](context);
				if (r !== true) return this._validateGuardResult(r);
			}
			return true;
		} catch (error) {
			Log.error("Guard threw an error, blocking navigation", String(error), LOG_COMPONENT);
			return false;
		}
	},

	/** Validate a non-true guard result; invalid values become false. */
	_validateGuardResult(this: RouterInstance, result: GuardResult): GuardResult {
		if (typeof result === "string" || typeof result === "boolean" || isGuardRedirect(result)) {
			return result;
		}
		Log.warning("Guard returned invalid value, treating as block", String(result), LOG_COMPONENT);
		return false;
	},

	/** Handle a block or redirect result. */
	_handleGuardResult(this: RouterInstance, result: GuardResult): void {
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
	 */
	_restoreHash(this: RouterInstance): void {
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

	/** Clean up guards on destroy. */
	destroy(this: RouterInstance) {
		this._globalGuards = [];
		this._routeGuards.clear();
		return MobileRouter.prototype.destroy.call(this);
	},
});

export default Router;
