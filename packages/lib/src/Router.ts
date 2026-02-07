import MobileRouter from "sap/m/routing/Router";
import Log from "sap/base/Log";
import coreLibrary from "sap/ui/core/library";
import type { GuardFn, GuardContext, GuardResult, GuardRedirect, RouterInstance } from "./types";

const HistoryDirection = coreLibrary.routing.HistoryDirection;

const LOG_COMPONENT = "ui5.ext.routing.Router";

function isGuardRedirect(value: GuardResult): value is GuardRedirect {
	return typeof value === "object" && typeof value.route === "string";
}

function isThenable(value: GuardResult | Promise<GuardResult>): value is Promise<GuardResult> {
	return typeof value === "object" && typeof (value as Promise<GuardResult>).then === "function";
}

/**
 * Router with navigation guard support.
 *
 * Extends `sap.m.routing.Router` by overriding `parse()` to run
 * registered guard functions before any route matching, target loading,
 * or event firing occurs.
 *
 * Design notes:
 * - `parse()` is intentionally synchronous. The UI5 framework calls it
 *   from the hashChanged event handler without awaiting a return value.
 *   If parse() were async, routing would be deferred to a microtask,
 *   creating a race condition where the framework (and test tools like
 *   wdi5's waitForUI5) see the event loop as idle before the navigation
 *   has actually occurred. When guards are synchronous (the common case),
 *   the entire guard check + route activation happens in the same tick.
 *   Async guards are supported but fall back to a deferred path.
 * - `_redirecting`: Set only inside `_handleGuardResult` to mark a re-entrant
 *   parse triggered by a guard redirect. These bypass guards to prevent loops.
 * - `_parseGeneration`: Monotonic counter incremented on each parse that
 *   enters the async guard path. After each `await`, the generation is
 *   checked; if a newer parse started during the suspension, the stale
 *   parse is abandoned. This ensures only the latest navigation wins when
 *   rapid/concurrent navigations occur.
 * - Same-hash dedup: If `parse()` is called for a hash identical to
 *   `_currentHash`, it is a no-op. This suppresses spurious browser
 *   `hashchange` events that fire asynchronously after a redirect's
 *   `history.replaceState`.
 * - `_suppressNextParse`: Set by `_restoreHash()` before calling `replaceHash`.
 *   The `replaceHash` fires `hashChanged` synchronously, which triggers `parse()`.
 *   This flag suppresses that re-entrant parse so guards don't run again after
 *   a block or error. Reset immediately after `replaceHash` to prevent leaking
 *   when the hash didn't actually change (replaceHash is a no-op for same hash).
 *
 * **Important: redirect targets bypass guards.**
 * When a guard returns a redirect (string or `GuardRedirect`), the resulting
 * `navTo` call triggers a re-entrant `parse()` with `_redirecting = true`.
 * This re-entrant parse skips all guard evaluation to prevent infinite loops.
 * As a consequence, if route A redirects to route B, route B's guards are
 * **not** evaluated during that redirect. Design guard chains accordingly:
 * do not rely on the redirect target's guards running during a redirect.
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

	/**
	 * Override parse to run guards before route matching.
	 *
	 * Every navigation path (navTo, browser back/forward, URL bar)
	 * flows through parse(). By intercepting here, we prevent
	 * target loading, view creation, and event firing when guards block.
	 *
	 * IMPORTANT: This method is intentionally NOT async. See class-level
	 * design notes for rationale.
	 */
	parse(this: RouterInstance, newHash: string): void {
		// Suppress the parse triggered by _restoreHash()'s replaceHash call.
		// replaceHash fires hashChanged synchronously, so this flag is always
		// consumed immediately and never leaks.
		if (this._suppressNextParse) {
			this._suppressNextParse = false;
			return;
		}

		// Re-entrant call from guard redirect → skip guards, proceed directly
		if (this._redirecting) {
			this._commitNavigation(newHash);
			return;
		}

		// Deduplicate: skip if already on this hash (same-route re-entry).
		if (this._currentHash !== null && newHash === this._currentHash) {
			return;
		}

		// Determine which route matches the new hash
		const routeInfo = this.getRouteInfoByHash(newHash);
		const toRoute = routeInfo ? routeInfo.name : "";

		// No guards apply to this navigation → fast path
		if (this._globalGuards.length === 0
			&& (!toRoute || !this._routeGuards.has(toRoute))) {
			this._commitNavigation(newHash, toRoute);
			return;
		}

		// Build guard context
		const context: GuardContext = {
			toRoute,
			toHash: newHash,
			toArguments: (routeInfo ? routeInfo.arguments : {}) as Record<string, string>,
			fromRoute: this._currentRoute,
			fromHash: this._currentHash ?? ""
		};

		// Try to run all guards synchronously first.
		const result = this._runAllGuards(this._globalGuards, toRoute, context);

		if (isThenable(result)) {
			// At least one guard returned a Promise → fall back to async path
			const generation = ++this._parseGeneration;
			result.then((guardResult: GuardResult) => {
				if (generation !== this._parseGeneration) {
					Log.debug("Async guard result discarded (superseded by newer navigation)", newHash, LOG_COMPONENT);
					return;
				}
				this._applyGuardResult(guardResult, newHash, toRoute);
			});
		} else {
			// All guards were synchronous → apply result in the same tick
			this._applyGuardResult(result, newHash, toRoute);
		}
	},

	/**
	 * Commit a navigation: delegate to the parent router and update state.
	 * When `route` is provided it is used directly; otherwise the route
	 * is resolved from the hash (used by the redirect path where the
	 * caller does not have the route name readily available).
	 */
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

	/**
	 * Apply the final guard result: proceed with routing, redirect, or block.
	 */
	_applyGuardResult(this: RouterInstance, result: GuardResult, newHash: string, toRoute: string): void {
		if (result === true) {
			this._commitNavigation(newHash, toRoute);
		} else {
			this._handleGuardResult(result);
		}
	},

	/**
	 * Run all applicable guards (global + route-specific). Returns the
	 * guard result directly when all guards are synchronous, or a
	 * Promise<GuardResult> if any guard is async.
	 */
	_runAllGuards(this: RouterInstance, globalGuards: GuardFn[], toRoute: string, context: GuardContext): GuardResult | Promise<GuardResult> {
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

	/**
	 * Run route-specific guards if any are registered for `toRoute`.
	 */
	_runRouteGuards(this: RouterInstance, toRoute: string, context: GuardContext): GuardResult | Promise<GuardResult> {
		if (!toRoute || !this._routeGuards.has(toRoute)) return true;
		return this._runGuardListSync(this._routeGuards.get(toRoute)!, context);
	},

	/**
	 * Run a list of guards synchronously if possible. When a guard returns
	 * a Promise, switches to the async path for the remainder.
	 */
	_runGuardListSync(this: RouterInstance, guards: GuardFn[], context: GuardContext): GuardResult | Promise<GuardResult> {
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

	/**
	 * Continue running a guard list asynchronously after a guard returned
	 * a Promise. Picks up from the guard at `currentIndex`.
	 */
	async _finishGuardListAsync(
		this: RouterInstance,
		pendingResult: Promise<GuardResult>,
		guards: GuardFn[],
		currentIndex: number,
		context: GuardContext
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

	/**
	 * Validate a non-true synchronous guard result.
	 */
	_validateGuardResult(this: RouterInstance, result: GuardResult): GuardResult {
		if (result === false || typeof result === "string" || isGuardRedirect(result)) {
			return result;
		}
		Log.warning(
			"Guard returned invalid value, treating as block",
			String(result),
			LOG_COMPONENT
		);
		return false;
	},

	/**
	 * Handle a non-true guard result (block or redirect).
	 */
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
				this.navTo(result.route, result.parameters || {}, result.componentTargetInfo as any, true);
			}
		} finally {
			this._redirecting = false;
		}
	},

	/**
	 * Restore the previous hash without creating a history entry.
	 * Sets _suppressNextParse so the synchronous parse() triggered by
	 * replaceHash's hashChanged event is silently consumed.
	 *
	 * ASSUMPTION: replaceHash fires hashChanged synchronously (same tick).
	 * This is validated by a QUnit test. If UI5 ever changes this to fire
	 * asynchronously, the flag reset below would clear _suppressNextParse
	 * before parse() can check it, causing a double navigation.
	 */
	_restoreHash(this: RouterInstance): void {
		const hashChanger = this.getHashChanger();
		if (hashChanger) {
			this._suppressNextParse = true;
			hashChanger.replaceHash(this._currentHash ?? "", HistoryDirection.Unknown);
			if (this._suppressNextParse) {
				// replaceHash did not fire hashChanged (same hash, no-op).
				// Reset to prevent the flag leaking into the next parse.
				Log.debug("replaceHash did not trigger hashChanged (same hash)", "", LOG_COMPONENT);
				this._suppressNextParse = false;
			}
		}
	},

	/**
	 * Clean up guard registrations on destroy.
	 */
	destroy(this: RouterInstance) {
		this._globalGuards = [];
		this._routeGuards.clear();
		return MobileRouter.prototype.destroy.call(this);
	}
});

export default Router;
