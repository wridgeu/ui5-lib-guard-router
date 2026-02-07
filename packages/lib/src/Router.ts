import MobileRouter from "sap/m/routing/Router";
import Log from "sap/base/Log";
import type { GuardFn, GuardContext, GuardResult, GuardRedirect } from "./types";

const LOG_COMPONENT = "ui5.ext.routing.Router";

function isGuardRedirect(value: GuardResult): value is GuardRedirect {
	return typeof value === "object" && typeof value.route === "string";
}

/**
 * Router with async navigation guard support.
 *
 * Extends `sap.m.routing.Router` by overriding `parse()` to run
 * registered guard functions before any route matching, target loading,
 * or event firing occurs.
 *
 * @extends sap.m.routing.Router
 */
const Router = MobileRouter.extend("ui5.ext.routing.Router", {
	constructor: function (this: any, ...args: any[]) {
		MobileRouter.prototype.constructor.apply(this, args);
		this._globalGuards = [] as GuardFn[];
		this._routeGuards = new Map<string, GuardFn[]>();
		this._currentRoute = "";
		this._currentHash = "";
		this._guardRunning = false;
	},

	/**
	 * Register a global guard that runs for every navigation.
	 */
	addGuard(this: any, guard: GuardFn): any {
		this._globalGuards.push(guard);
		return this;
	},

	/**
	 * Remove a previously registered global guard.
	 */
	removeGuard(this: any, guard: GuardFn): any {
		const index = this._globalGuards.indexOf(guard);
		if (index !== -1) {
			this._globalGuards.splice(index, 1);
		}
		return this;
	},

	/**
	 * Register a guard for a specific route.
	 */
	addRouteGuard(this: any, routeName: string, guard: GuardFn): any {
		if (!this._routeGuards.has(routeName)) {
			this._routeGuards.set(routeName, []);
		}
		this._routeGuards.get(routeName).push(guard);
		return this;
	},

	/**
	 * Remove a guard from a specific route.
	 */
	removeRouteGuard(this: any, routeName: string, guard: GuardFn): any {
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

	/**
	 * Override parse to run guards before route matching.
	 *
	 * Every navigation path (navTo, browser back/forward, URL bar)
	 * flows through parse(). By intercepting here, we prevent
	 * target loading, view creation, and event firing when guards block.
	 */
	async parse(this: any, newHash: string): Promise<void> {
		// No guards registered → fast path, behave like native router
		if (this._globalGuards.length === 0 && this._routeGuards.size === 0) {
			MobileRouter.prototype.parse.call(this, newHash);
			this._currentHash = newHash;
			this._updateCurrentRoute(newHash);
			return;
		}

		// Prevent re-entrant guard execution (e.g. guard triggers navTo)
		if (this._guardRunning) {
			MobileRouter.prototype.parse.call(this, newHash);
			this._currentHash = newHash;
			this._updateCurrentRoute(newHash);
			return;
		}

		// Determine which route matches the new hash
		const routeInfo = this.getRouteInfoByHash(newHash);
		const toRoute = routeInfo ? routeInfo.name : "";
		const toArguments = routeInfo ? routeInfo.arguments : {};

		// Build guard context
		const context: GuardContext = {
			toRoute,
			toHash: newHash,
			toArguments: toArguments as Record<string, string>,
			fromRoute: this._currentRoute,
			fromHash: this._currentHash
		};

		this._guardRunning = true;

		try {
			// Run global guards sequentially
			const globalResult = await this._runGuards(this._globalGuards, context);
			if (globalResult !== true) {
				this._handleGuardResult(globalResult, newHash);
				return;
			}

			// Run route-specific guards
			if (toRoute && this._routeGuards.has(toRoute)) {
				const routeResult = await this._runGuards(this._routeGuards.get(toRoute), context);
				if (routeResult !== true) {
					this._handleGuardResult(routeResult, newHash);
					return;
				}
			}

			// All guards passed → proceed with normal routing
			MobileRouter.prototype.parse.call(this, newHash);
			this._currentHash = newHash;
			this._currentRoute = toRoute;
		} catch (error) {
			Log.error("Guard execution failed, navigation blocked", String(error), LOG_COMPONENT);
			this._restoreHash();
		} finally {
			this._guardRunning = false;
		}
	},

	/**
	 * Run an array of guards sequentially. First non-true result wins.
	 */
	async _runGuards(this: any, guards: GuardFn[], context: GuardContext): Promise<GuardResult> {
		for (const guard of guards) {
			try {
				const result = await guard(context);
				if (result !== true) {
					if (result === false || typeof result === "string" || isGuardRedirect(result)) {
						return result;
					}
					Log.warning(
						"Guard returned invalid value, treating as block",
						String(result),
						LOG_COMPONENT
					);
					return false;
				}
			} catch (error) {
				Log.error("Guard threw an error, blocking navigation", String(error), LOG_COMPONENT);
				return false;
			}
		}
		return true;
	},

	/**
	 * Handle a non-true guard result (block or redirect).
	 */
	_handleGuardResult(this: any, result: GuardResult, _blockedHash: string): void {
		if (typeof result === "string") {
			// Redirect to named route (replace history, no extra entry)
			this._guardRunning = true;
			try {
				this.navTo(result, {}, undefined, true);
			} finally {
				this._guardRunning = false;
			}
		} else if (isGuardRedirect(result)) {
			// Redirect with route parameters (replace history, no extra entry)
			this._guardRunning = true;
			try {
				this.navTo(result.route, result.parameters || {}, result.componentTargetInfo, true);
			} finally {
				this._guardRunning = false;
			}
		} else {
			// false → block, restore previous hash
			this._restoreHash();
		}
	},

	/**
	 * Restore the previous hash without creating a history entry.
	 */
	_restoreHash(this: any): void {
		const hashChanger = this.getHashChanger();
		if (hashChanger) {
			hashChanger.replaceHash(this._currentHash);
		}
	},

	/**
	 * Update internal current route tracking from a hash.
	 */
	_updateCurrentRoute(this: any, hash: string): void {
		const routeInfo = this.getRouteInfoByHash(hash);
		this._currentRoute = routeInfo ? routeInfo.name : "";
	},

	/**
	 * Clean up guard registrations on destroy.
	 */
	destroy(this: any): any {
		this._globalGuards = [];
		this._routeGuards.clear();
		return MobileRouter.prototype.destroy.call(this);
	}
});

export default Router;
