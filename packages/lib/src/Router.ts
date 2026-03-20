import MobileRouter from "sap/m/routing/Router";
import Log from "sap/base/Log";
import coreLibrary from "sap/ui/core/library";
import type { ComponentTargetParameters } from "sap/ui/core/routing/Router";
import type {
	GuardFn,
	GuardContext,
	GuardResult,
	GuardRedirect,
	GuardRouter,
	LeaveGuardFn,
	NavigationResult,
	Router$NavigationSettledEvent,
	RouteGuardConfig,
} from "./types";
import NavigationOutcome from "./NavigationOutcome";

const HistoryDirection = coreLibrary.routing.HistoryDirection;

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
function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
	if ((typeof value !== "object" && typeof value !== "function") || value === null) {
		return false;
	}

	return typeof (value as PromiseLike<T>).then === "function";
}

function isRouteGuardConfig(guard: GuardFn | RouteGuardConfig): guard is RouteGuardConfig {
	return typeof guard === "object" && guard !== null;
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
 * Normalized result of the guard decision pipeline.
 * Internal only -- not part of the public API.
 */
type GuardDecision = { action: "allow" } | { action: "block" } | { action: "redirect"; target: string | GuardRedirect };

/**
 * Guard context without the AbortSignal. Callers build this; `_evaluateGuards`
 * creates the AbortController and produces the full `GuardContext` internally.
 */
type GuardContextBase = Omit<GuardContext, "signal">;

/**
 * Router with navigation guard support.
 *
 * Extends `sap.m.routing.Router` with a shared guard pipeline that
 * evaluates registered guard functions before route matching, target
 * loading, or event firing occurs.
 *
 * Two entry points feed the same pipeline:
 * - `navTo()` runs guards as a preflight check. Blocked or redirected
 *   navigations never change the hash or push history entries.
 * - `parse()` runs guards as a fallback for browser back/forward, URL
 *   bar entry, and direct hash changes where the hash has already changed
 *   before guards can intercept.
 *
 * Key assumptions (see docs/reference/architecture.md for full rationale):
 * - `parse()` is intentionally NOT async. Sync guards execute in the
 *   same tick; async guards fall back to a deferred path.
 * - `replaceHash` fires `hashChanged` synchronously (validated by test).
 * - `setHash` (via `super.navTo`) fires `hashChanged` synchronously (validated by test).
 * - Redirect targets bypass guards to prevent infinite loops.
 *
 * @namespace ui5.guard.router
 * @extends sap.m.routing.Router
 */
export default class Router extends MobileRouter implements GuardRouter {
	private _globalGuards: GuardFn[] = [];
	private _enterGuards = new Map<string, GuardFn[]>();
	private _leaveGuards = new Map<string, LeaveGuardFn[]>();
	private _currentRoute = "";
	private _currentHash: string | null = null;
	private _pendingHash: string | null = null;
	private _redirecting = false;
	private _parseGeneration = 0;
	private _suppressedHash: string | null = null;
	private _abortController: AbortController | null = null;
	private _settlementResolvers: ((result: NavigationResult) => void)[] = [];
	private _lastSettlement: NavigationResult | null = null;
	private _preflightApprovedHash: string | null = null;

	/**
	 * Register a global guard that runs for every navigation.
	 *
	 * @param guard - Guard function to register. Non-functions are ignored with a warning.
	 * @returns `this` for chaining.
	 */
	addGuard(guard: GuardFn): this {
		if (typeof guard !== "function") {
			Log.warning("addGuard called with invalid guard, ignoring", undefined, LOG_COMPONENT);
			return this;
		}
		this._globalGuards.push(guard);
		return this;
	}

	/**
	 * Remove a previously registered global guard.
	 *
	 * @param guard - Guard function to remove by reference. Non-functions are ignored with a warning.
	 * @returns `this` for chaining.
	 */
	removeGuard(guard: GuardFn): this {
		if (typeof guard !== "function") {
			Log.warning("removeGuard called with invalid guard, ignoring", undefined, LOG_COMPONENT);
			return this;
		}
		const index = this._globalGuards.indexOf(guard);
		if (index !== -1) {
			this._globalGuards.splice(index, 1);
		}
		return this;
	}

	/**
	 * Register a guard for a specific route.
	 *
	 * Accepts either a guard function (registered as an enter guard) or a
	 * configuration object with `beforeEnter` and/or `beforeLeave` guards.
	 *
	 * @param routeName - Route name as defined in `manifest.json`. A warning is logged if the route does not exist yet.
	 * @param guard - Guard function or {@link RouteGuardConfig} object.
	 * @returns `this` for chaining.
	 */
	addRouteGuard(routeName: string, guard: GuardFn | RouteGuardConfig): this {
		if (isRouteGuardConfig(guard)) {
			let hasHandler = false;
			this._warnIfRouteUnknown(routeName, "addRouteGuard");

			if (guard.beforeEnter !== undefined) {
				hasHandler = true;
				if (typeof guard.beforeEnter !== "function") {
					Log.warning("addRouteGuard called with invalid guard, ignoring", routeName, LOG_COMPONENT);
				} else {
					addToGuardMap(this._enterGuards, routeName, guard.beforeEnter);
				}
			}
			if (guard.beforeLeave !== undefined) {
				hasHandler = true;
				if (typeof guard.beforeLeave !== "function") {
					Log.warning("addRouteGuard called with invalid guard, ignoring", routeName, LOG_COMPONENT);
				} else {
					addToGuardMap(this._leaveGuards, routeName, guard.beforeLeave);
				}
			}

			if (!hasHandler) {
				Log.info(
					"addRouteGuard called with config missing both beforeEnter and beforeLeave",
					routeName,
					LOG_COMPONENT,
				);
				return this;
			}
			return this;
		}
		if (typeof guard !== "function") {
			Log.warning("addRouteGuard called with invalid guard, ignoring", routeName, LOG_COMPONENT);
			return this;
		}
		this._warnIfRouteUnknown(routeName, "addRouteGuard");
		addToGuardMap(this._enterGuards, routeName, guard);
		return this;
	}

	/**
	 * Remove a guard from a specific route.
	 *
	 * Accepts the same forms as `addRouteGuard`: a guard function removes
	 * an enter guard; a configuration object removes `beforeEnter` and/or
	 * `beforeLeave` by reference.
	 *
	 * @param routeName - Route name as defined in `manifest.json`.
	 * @param guard - Guard function or {@link RouteGuardConfig} object to remove by reference.
	 * @returns `this` for chaining.
	 */
	removeRouteGuard(routeName: string, guard: GuardFn | RouteGuardConfig): this {
		if (isRouteGuardConfig(guard)) {
			if (typeof guard.beforeEnter === "function") {
				this.removeRouteGuard(routeName, guard.beforeEnter);
			}
			if (typeof guard.beforeLeave === "function") {
				this.removeLeaveGuard(routeName, guard.beforeLeave);
			}
			return this;
		}
		if (typeof guard !== "function") {
			Log.warning("removeRouteGuard called with invalid guard, ignoring", routeName, LOG_COMPONENT);
			return this;
		}
		removeFromGuardMap(this._enterGuards, routeName, guard);
		return this;
	}

	/**
	 * Register a leave guard for a specific route.
	 *
	 * Leave guards run when navigating **away from** the route, before any
	 * enter guards for the target route. They answer the binary question
	 * "can I leave?" and return only a boolean (no redirects).
	 *
	 * @param routeName - Route name as defined in `manifest.json`. A warning is logged if the route does not exist yet.
	 * @param guard - Leave guard function to register. Non-functions are ignored with a warning.
	 * @returns `this` for chaining.
	 */
	addLeaveGuard(routeName: string, guard: LeaveGuardFn): this {
		if (typeof guard !== "function") {
			Log.warning("addLeaveGuard called with invalid guard, ignoring", routeName, LOG_COMPONENT);
			return this;
		}
		this._warnIfRouteUnknown(routeName, "addLeaveGuard");
		addToGuardMap(this._leaveGuards, routeName, guard);
		return this;
	}

	private _warnIfRouteUnknown(routeName: string, methodName: "addRouteGuard" | "addLeaveGuard"): void {
		if (this.getRoute(routeName)) {
			return;
		}
		Log.warning(
			`${methodName} called for unknown route; guard will still register. If the route is added later via addRoute(), this warning can be ignored.`,
			routeName,
			LOG_COMPONENT,
		);
	}

	/**
	 * Remove a leave guard from a specific route.
	 *
	 * @param routeName - Route name as defined in `manifest.json`.
	 * @param guard - Leave guard function to remove by reference. Non-functions are ignored with a warning.
	 * @returns `this` for chaining.
	 */
	removeLeaveGuard(routeName: string, guard: LeaveGuardFn): this {
		if (typeof guard !== "function") {
			Log.warning("removeLeaveGuard called with invalid guard, ignoring", routeName, LOG_COMPONENT);
			return this;
		}
		removeFromGuardMap(this._leaveGuards, routeName, guard);
		return this;
	}

	/**
	 * Return a Promise that settles when the current guard pipeline finishes.
	 *
	 * If a navigation is pending, the Promise resolves when that pipeline settles.
	 * If no navigation is pending, it resolves immediately with the most recent
	 * settlement result. Before any navigation has settled, it falls back to a
	 * synthetic `Committed` result derived from the router's current route/hash
	 * state. After `stop()`, that idle fallback reports empty route/hash values
	 * until a new navigation settles.
	 *
	 * @returns Promise that resolves with a {@link NavigationResult} once the pipeline settles.
	 */
	navigationSettled(): Promise<NavigationResult> {
		if (this._pendingHash === null) {
			return Promise.resolve(
				this._lastSettlement ?? {
					status: NavigationOutcome.Committed,
					route: this._currentRoute,
					hash: this._currentHash ?? "",
				},
			);
		}
		return new Promise((resolve) => {
			this._settlementResolvers.push(resolve);
		});
	}

	/**
	 * Attach an event handler for the `navigationSettled` event.
	 *
	 * Fires synchronously after every guard pipeline settlement with
	 * a {@link NavigationResult} payload. Unlike the one-shot
	 * `navigationSettled()` Promise, this event fires for every
	 * navigation outcome without re-registration.
	 *
	 * @param oData - Application-specific payload passed to the handler as second argument.
	 * @param fnFunction - The function to be called when the event occurs.
	 * @param oListener - Context object to call the event handler with. Defaults to this Router.
	 */
	attachNavigationSettled(
		oData: object,
		fnFunction: (evt: Router$NavigationSettledEvent) => void,
		oListener?: object,
	): this;
	attachNavigationSettled(fnFunction: (evt: Router$NavigationSettledEvent) => void, oListener?: object): this;
	attachNavigationSettled(oData: unknown, fnFunction?: unknown, oListener?: unknown): this {
		this.attachEvent("navigationSettled", oData as object, fnFunction as Function, oListener as object);
		return this;
	}

	/**
	 * Detach a previously attached `navigationSettled` event handler.
	 *
	 * The passed parameters must match those used for registration with
	 * {@link #attachNavigationSettled} beforehand.
	 *
	 * @param fnFunction - The handler function to detach.
	 * @param oListener - Context object on which the given function had to be called.
	 */
	detachNavigationSettled(fnFunction: (evt: Router$NavigationSettledEvent) => void, oListener: object): this {
		this.detachEvent("navigationSettled", fnFunction as Function, oListener);
		return this;
	}

	/**
	 * Drain all settlement resolvers with the given result and fire
	 * the `navigationSettled` event.
	 */
	private _flushSettlement(result: NavigationResult): void {
		this._lastSettlement = result;
		const resolvers = this._settlementResolvers;
		this._settlementResolvers = [];
		for (const resolve of resolvers) {
			resolve(result);
		}
		this.fireEvent("navigationSettled", result);
	}

	/**
	 * Navigate to a route with preflight guard evaluation.
	 *
	 * For programmatic navigation, guards run BEFORE the hash changes.
	 * This prevents history pollution: blocked navigations never push a
	 * history entry, and redirected navigations go directly to the final
	 * target.
	 *
	 * Same-hash navigations are deduped: if the target hash matches
	 * `_currentHash`, any pending navigation is cancelled and the call
	 * returns without navigating. If it matches `_pendingHash`, the
	 * in-flight preflight continues undisturbed.
	 *
	 * When all guards are synchronous, the decision and the resulting
	 * hash change happen in the same tick. When any guard returns a
	 * Promise, `navTo()` returns `this` immediately and defers the
	 * hash change to when the guard resolves.
	 *
	 * Assumes `super.navTo()` calls `HashChanger.setHash()` which fires
	 * `hashChanged` synchronously, causing `parse()` to re-enter in the
	 * same call stack (validated by test).
	 *
	 * @override sap.m.routing.Router#navTo
	 */
	override navTo(
		routeName: string,
		parameters?: object,
		componentTargetInfo?: Record<string, ComponentTargetParameters>,
		bReplace?: boolean,
	): this;
	override navTo(routeName: string, parameters?: object, bReplace?: boolean): this;
	override navTo(
		routeName: string,
		parameters?: object,
		componentTargetInfoOrReplace?: Record<string, ComponentTargetParameters> | boolean,
		bReplace?: boolean,
	): this {
		// Normalize the two overload shapes into a single set of arguments.
		let componentTargetInfo: Record<string, ComponentTargetParameters> | undefined;
		let replace: boolean | undefined;
		if (typeof componentTargetInfoOrReplace === "boolean") {
			replace = componentTargetInfoOrReplace;
		} else {
			componentTargetInfo = componentTargetInfoOrReplace;
			replace = bReplace;
		}

		// Redirect path: _redirect() calls this.navTo() with _redirecting=true.
		// Bypass preflight -- parse() will commit directly via the _redirecting flag.
		if (this._redirecting) {
			super.navTo(routeName, parameters, componentTargetInfo, replace);
			return this;
		}

		// Resolve the target hash so we can build a guard context.
		// getURL() returns the hash pattern with parameters substituted.
		const route = this.getRoute(routeName);
		if (!route) {
			// Unknown route -- let parent handle it (may fire bypassed event).
			// Cancel any pending async navigation so settlement resolvers drain
			// and the stale pipeline does not commit a superseded navigation.
			this._cancelPendingNavigation();
			super.navTo(routeName, parameters, componentTargetInfo, replace);
			return this;
		}

		const targetHash = route.getURL(parameters ?? {});
		const routeInfo = this.getRouteInfoByHash(targetHash);
		const toRoute = routeInfo?.name ?? "";

		// Same-hash dedup: cancel any pending navigation and return without navigating.
		if (this._currentHash !== null && targetHash === this._currentHash) {
			this._cancelPendingNavigation();
			return this;
		}

		// Pending-hash dedup: if an async preflight for this exact hash is
		// already running, don't cancel and restart it.
		if (this._pendingHash !== null && targetHash === this._pendingHash) {
			return this;
		}

		// Cancel any pending navigation (including previous async preflight).
		this._cancelPendingNavigation();
		const generation = this._parseGeneration;

		this._pendingHash = targetHash;

		const context: GuardContextBase = {
			toRoute,
			toHash: targetHash,
			toArguments: routeInfo?.arguments ?? {},
			fromRoute: this._currentRoute,
			fromHash: this._currentHash ?? "",
		};

		const decision = this._evaluateGuards(context);

		if (isPromiseLike(decision)) {
			decision
				.then((d: GuardDecision) => {
					if (generation !== this._parseGeneration) {
						Log.debug(
							"Async preflight result discarded (superseded by newer navigation)",
							targetHash,
							LOG_COMPONENT,
						);
						return;
					}
					this._applyPreflightDecision(
						d,
						routeName,
						parameters,
						componentTargetInfo,
						replace,
						targetHash,
						toRoute,
					);
				})
				.catch((error: unknown) => {
					if (generation !== this._parseGeneration) return;
					Log.error(
						`Async preflight guard failed for route "${routeName}", blocking navigation`,
						String(error),
						LOG_COMPONENT,
					);
					this._blockNavigation(targetHash, false);
				});
			return this;
		}

		// Sync path: apply the decision immediately.
		this._applyPreflightDecision(
			decision,
			routeName,
			parameters,
			componentTargetInfo,
			replace,
			targetHash,
			toRoute,
		);
		return this;
	}

	/**
	 * Apply a preflight guard decision. For "allow", set the approved-hash
	 * marker and call super.navTo(). For "block", flush settlement without
	 * touching the hash. For "redirect", navigate to the redirect target.
	 */
	private _applyPreflightDecision(
		decision: GuardDecision,
		routeName: string,
		parameters: object | undefined,
		componentTargetInfo: Record<string, ComponentTargetParameters> | undefined,
		bReplace: boolean | undefined,
		targetHash: string,
		toRoute: string,
	): void {
		switch (decision.action) {
			case "allow":
				this._preflightApprovedHash = targetHash;
				super.navTo(routeName, parameters, componentTargetInfo, bReplace);
				// Safety: if super.navTo didn't trigger parse (e.g. hash didn't change),
				// clear the marker to avoid stale state.
				if (this._preflightApprovedHash === targetHash) {
					this._preflightApprovedHash = null;
					// Hash didn't change, so parse() wasn't called. Commit manually.
					this._commitNavigation(targetHash, toRoute);
				}
				break;
			case "block":
				this._blockNavigation(targetHash, false);
				break;
			case "redirect": {
				this._redirect(decision.target, targetHash, false);
				break;
			}
		}
	}

	/**
	 * Intercept hash changes and run the guard pipeline before route matching.
	 *
	 * Called by the HashChanger on every `hashChanged` event. Runs leave guards
	 * (current route), then global + route-specific enter guards (target route).
	 * Stays synchronous when all guards return plain values; falls back to async
	 * when a guard returns a Promise. A generation counter discards stale results
	 * when navigations overlap.
	 *
	 * @param newHash - The new hash fragment from the URL.
	 * @override sap.ui.core.routing.Router#parse
	 */
	override parse(newHash: string): void {
		if (this._suppressedHash !== null) {
			if (newHash === this._suppressedHash) {
				this._suppressedHash = null;
				return;
			}
			this._suppressedHash = null;
		}

		if (this._redirecting) {
			this._commitNavigation(newHash);
			return;
		}

		// Preflight-approved: navTo() already ran guards and approved this hash.
		// Commit without re-running guards. Assumes super.navTo() fires
		// hashChanged synchronously (validated by test).
		if (this._preflightApprovedHash !== null && newHash === this._preflightApprovedHash) {
			this._preflightApprovedHash = null;
			this._commitNavigation(newHash, this.getRouteInfoByHash(newHash)?.name ?? "");
			return;
		}

		if (this._currentHash !== null && newHash === this._currentHash) {
			this._cancelPendingNavigation();
			return;
		}

		const routeInfo = this.getRouteInfoByHash(newHash);
		const toRoute = routeInfo?.name ?? "";

		this._cancelPendingNavigation();
		const generation = this._parseGeneration;

		this._pendingHash = newHash;

		const context: GuardContextBase = {
			toRoute,
			toHash: newHash,
			toArguments: routeInfo?.arguments ?? {},
			fromRoute: this._currentRoute,
			fromHash: this._currentHash ?? "",
		};

		const decision = this._evaluateGuards(context);

		if (isPromiseLike(decision)) {
			decision
				.then((d: GuardDecision) => {
					if (generation !== this._parseGeneration) {
						Log.debug(
							"Async guard result discarded (superseded by newer navigation)",
							newHash,
							LOG_COMPONENT,
						);
						return;
					}
					this._applyDecision(d, newHash, toRoute);
				})
				.catch((error: unknown) => {
					if (generation !== this._parseGeneration) return;
					Log.error(
						`Guard pipeline failed for "${newHash}", blocking navigation`,
						String(error),
						LOG_COMPONENT,
					);
					this._blockNavigation(newHash);
				});
			return;
		}

		this._applyDecision(decision, newHash, toRoute);
	}

	/**
	 * Stop listening to hash changes and reset guard state.
	 *
	 * Resets `_currentRoute` and `_currentHash` so that a subsequent
	 * `initialize()` re-parses the current hash and fires `routeMatched`,
	 * matching the native `sap.m.routing.Router` behavior.
	 *
	 * @override sap.ui.core.routing.Router#stop
	 */
	override stop(): this {
		this._cancelPendingNavigation();
		this._redirecting = false;
		this._suppressedHash = null;
		this._preflightApprovedHash = null;
		this._currentRoute = "";
		this._currentHash = null;
		this._lastSettlement = null;
		super.stop();
		return this;
	}

	/**
	 * Invalidate any in-flight async guard work. Bumps the generation counter
	 * so pending `.then()` callbacks see they are stale, aborts the signal,
	 * and clears the pending hash.
	 */
	private _cancelPendingNavigation(): void {
		++this._parseGeneration;
		this._abortController?.abort();
		this._abortController = null;
		if (this._pendingHash !== null) {
			this._flushSettlement({
				status: NavigationOutcome.Cancelled,
				route: this._currentRoute,
				hash: this._currentHash ?? "",
			});
		}
		this._pendingHash = null;
	}

	/**
	 * Run the full guard pipeline (leave → global enter → route enter) and
	 * return a normalized decision. Stays synchronous when all guards return
	 * plain values; returns a Promise only when an async guard is encountered.
	 *
	 * Shared by navTo() preflight and parse() fallback.
	 */
	private _evaluateGuards(baseContext: GuardContextBase): GuardDecision | Promise<GuardDecision> {
		const hasLeaveGuards = this._currentRoute !== "" && this._leaveGuards.has(this._currentRoute);
		const hasEnterGuards =
			this._globalGuards.length > 0 || (baseContext.toRoute !== "" && this._enterGuards.has(baseContext.toRoute));

		if (!hasLeaveGuards && !hasEnterGuards) {
			return { action: "allow" };
		}

		this._abortController = new AbortController();
		const context: GuardContext = { ...baseContext, signal: this._abortController.signal };

		const processEnterResult = (
			enterResult: GuardResult | Promise<GuardResult>,
		): GuardDecision | Promise<GuardDecision> => {
			if (isPromiseLike(enterResult)) {
				return enterResult.then((r: GuardResult): GuardDecision => {
					if (r === true) return { action: "allow" };
					if (r === false) return { action: "block" };
					return { action: "redirect", target: r };
				});
			}
			if (enterResult === true) return { action: "allow" };
			if (enterResult === false) return { action: "block" };
			return { action: "redirect", target: enterResult };
		};

		const runEnterPhase = (): GuardDecision | Promise<GuardDecision> => {
			const enterResult = this._runEnterGuards(this._globalGuards, context.toRoute, context);
			return processEnterResult(enterResult);
		};

		if (hasLeaveGuards) {
			const leaveResult = this._runLeaveGuards(context);

			if (isPromiseLike(leaveResult)) {
				return leaveResult.then((allowed: boolean): GuardDecision | Promise<GuardDecision> => {
					if (allowed !== true) return { action: "block" };
					return runEnterPhase();
				});
			}
			if (leaveResult !== true) return { action: "block" };
		}

		return runEnterPhase();
	}

	/**
	 * Run leave guards for the current route. Returns boolean (no redirects).
	 *
	 * The guard array is snapshot-copied before iteration so that guards
	 * may safely add/remove themselves (e.g. one-shot guards) without
	 * affecting the current pipeline run.
	 */
	private _runLeaveGuards(context: GuardContext): boolean | Promise<boolean> {
		const registered = this._leaveGuards.get(this._currentRoute);
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
					`Leave guard [${i}] on route "${this._currentRoute}" threw, blocking navigation`,
					String(error),
					LOG_COMPONENT,
				);
				return false;
			}
		}
		return true;
	}

	/**
	 * Apply a guard decision for the parse() fallback path.
	 */
	private _applyDecision(decision: GuardDecision, hash: string, route: string): void {
		switch (decision.action) {
			case "allow":
				this._commitNavigation(hash, route);
				break;
			case "block":
				this._blockNavigation(hash);
				break;
			case "redirect":
				this._redirect(decision.target, hash);
				break;
		}
	}

	/**
	 * Delegate to the parent router and update internal state.
	 *
	 * State is updated BEFORE calling parse to ensure that if event handlers
	 * (e.g., routeMatched) trigger nested navigation, the leave guards will
	 * run for the correct (new) route rather than the old one.
	 */
	private _commitNavigation(hash: string, route?: string): void {
		this._pendingHash = null;
		this._abortController = null;
		this._currentHash = hash;
		this._currentRoute = route ?? this.getRouteInfoByHash(hash)?.name ?? "";
		this._flushSettlement({
			status: this._redirecting
				? NavigationOutcome.Redirected
				: this._currentRoute === ""
					? NavigationOutcome.Bypassed
					: NavigationOutcome.Committed,
			route: this._currentRoute,
			hash,
		});
		super.parse(hash);
	}

	/** Run global guards, then route-specific guards. Stays sync when possible. */
	private _runEnterGuards(
		globalGuards: GuardFn[],
		toRoute: string,
		context: GuardContext,
	): GuardResult | Promise<GuardResult> {
		const globalResult = this._runGuards(globalGuards, context);

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
					`Enter guard [${i}] for route "${context.toRoute}" threw, blocking navigation`,
					String(error),
					LOG_COMPONENT,
				);
				return false;
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
	 * `guards` is typed as `GuardFn[]` for reuse. Leave guard callers
	 * pass `LeaveGuardFn[]` which is assignable (narrower return type).
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
					`${label} [${guardIndex}] on route "${route}" threw, blocking navigation`,
					String(error),
					LOG_COMPONENT,
				);
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

	/** Perform a guard redirect (string route name or GuardRedirect object). */
	private _redirect(target: string | GuardRedirect, attemptedHash?: string, restoreHash = true): void {
		this._pendingHash = null;
		this._abortController = null;
		const settlementBefore = this._lastSettlement;
		const targetName = typeof target === "string" ? target : target.route;
		let targetHash: string | null = null;
		const targetParameters = typeof target === "string" ? {} : (target.parameters ?? {});
		const targetRoute = this.getRoute(targetName);
		if (targetRoute) {
			try {
				targetHash = targetRoute.getURL(targetParameters);
			} catch {
				targetHash = null;
			}
		}
		const redirectsToCurrentHash = targetHash !== null && targetHash === (this._currentHash ?? "");
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

		// Safety net: if navTo did not trigger a re-entrant parse() (e.g. the
		// target route does not exist and the hash did not change), no
		// _commitNavigation ran and _lastSettlement was not updated. Treat as
		// blocked because the observable outcome is that the user stays on the
		// current route. Log a warning so the developer sees the bad target.
		if (this._lastSettlement === settlementBefore) {
			if (redirectsToCurrentHash) {
				this._redirecting = true;
				try {
					this._commitNavigation(this._currentHash ?? "", this._currentRoute);
				} finally {
					this._redirecting = false;
				}
				return;
			}
			Log.warning(
				`Guard redirect target "${targetName}" did not produce a navigation, treating as blocked`,
				undefined,
				LOG_COMPONENT,
			);
			this._blockNavigation(attemptedHash, restoreHash);
		}
	}

	/**
	 * Clear pending state and flush a Blocked settlement.
	 * When `restoreHash` is true (default), also restores the browser hash
	 * to `_currentHash`. Preflight callers pass false because the hash was
	 * never changed.
	 */
	private _blockNavigation(attemptedHash?: string, restoreHash = true): void {
		this._pendingHash = null;
		this._abortController = null;
		this._flushSettlement({
			status: NavigationOutcome.Blocked,
			route: this._currentRoute,
			hash: this._currentHash ?? "",
		});
		if (!restoreHash) return;
		if (this._currentHash === null && attemptedHash && attemptedHash !== "") {
			this._restoreHash("", false);
			return;
		}
		this._restoreHash(this._currentHash ?? "");
	}

	/**
	 * Restore the previous hash without creating a history entry.
	 * Assumes replaceHash fires hashChanged synchronously (validated by test).
	 * `_currentRoute` stays unchanged because the blocked navigation never
	 * committed. The user remains on the same logical route.
	 */
	private _restoreHash(hash: string, suppressParse = true): void {
		const hashChanger = this.getHashChanger();
		if (hashChanger) {
			this._suppressedHash = suppressParse ? hash : null;
			hashChanger.replaceHash(hash, HistoryDirection.Unknown);
			if (this._suppressedHash === hash) {
				this._suppressedHash = null;
			}
		}
	}

	/** Clean up guards on destroy. Bumps generation to discard pending async results. */
	override destroy(): this {
		this._globalGuards = [];
		this._enterGuards.clear();
		this._leaveGuards.clear();
		this._cancelPendingNavigation();
		this._redirecting = false;
		this._suppressedHash = null;
		this._preflightApprovedHash = null;
		this._lastSettlement = null;
		super.destroy();
		return this;
	}
}
