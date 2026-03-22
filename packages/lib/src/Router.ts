import MobileRouter from "sap/m/routing/Router";
import Log from "sap/base/Log";
import coreLibrary from "sap/ui/core/library";
import type { ComponentTargetParameters } from "sap/ui/core/routing/Router";
import type {
	GuardFn,
	GuardContext,
	GuardRedirect,
	GuardRouter,
	LeaveGuardFn,
	NavigationResult,
	Router$NavigationSettledEvent,
	RouteGuardConfig,
} from "./types";
import NavigationOutcome from "./NavigationOutcome";
import GuardPipeline, { type GuardDecision } from "./GuardPipeline";

const HistoryDirection = coreLibrary.routing.HistoryDirection;

const LOG_COMPONENT = "ui5.guard.router.Router";

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

/** Snapshot of an in-flight navigation being evaluated by the guard pipeline. */
interface NavigationAttempt {
	readonly hash: string;
	readonly route: string;
	readonly controller: AbortController;
	readonly generation: number;
}

interface PhaseIdle {
	readonly kind: "idle";
}

interface PhaseEvaluating {
	readonly kind: "evaluating";
	readonly attempt: NavigationAttempt;
}

interface PhaseCommitting {
	readonly kind: "committing";
	readonly hash: string;
	readonly route: string;
	readonly origin: "preflight" | "redirect" | "parse";
}

type RouterPhase = PhaseIdle | PhaseEvaluating | PhaseCommitting;

const IDLE: PhaseIdle = { kind: "idle" };

/** Maximum number of hops in a redirect chain before it is treated as a loop. */
const MAX_REDIRECT_DEPTH = 10;

/** State threaded through a redirect chain. */
interface RedirectChainContext {
	/** Hashes whose guards have been evaluated in this chain (mutated via .add()). */
	visited: Set<string>;
	/** Hash of the originally attempted navigation (for settlement / hash restore). */
	readonly attemptedHash: string | undefined;
	/** Whether to restore the hash on block (true for parse path, false for preflight). */
	readonly restoreHash: boolean;
	/** Original source route — the route the user is currently on. */
	readonly fromRoute: string;
	/** Original source hash — the hash the user is currently on. */
	readonly fromHash: string;
	/** Shared AbortSignal from the original navigation. */
	readonly signal: AbortSignal;
	/** Shared generation counter from the original navigation. */
	readonly generation: number;
}

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
 * - Redirect targets are evaluated by the guard pipeline with loop detection.
 *
 * @namespace ui5.guard.router
 * @extends sap.m.routing.Router
 */
export default class Router extends MobileRouter implements GuardRouter {
	private _pipeline = new GuardPipeline();
	private _currentRoute = "";
	private _currentHash: string | null = null;
	private _phase: RouterPhase = IDLE;
	private _parseGeneration = 0;
	private _suppressedHash: string | null = null;
	private _settlementResolvers: ((result: NavigationResult) => void)[] = [];
	private _lastSettlement: NavigationResult | null = null;

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
		this._pipeline.addGlobalGuard(guard);
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
		this._pipeline.removeGlobalGuard(guard);
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
					this._pipeline.addEnterGuard(routeName, guard.beforeEnter);
				}
			}
			if (guard.beforeLeave !== undefined) {
				hasHandler = true;
				if (typeof guard.beforeLeave !== "function") {
					Log.warning("addRouteGuard called with invalid guard, ignoring", routeName, LOG_COMPONENT);
				} else {
					this._pipeline.addLeaveGuard(routeName, guard.beforeLeave);
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
		this._pipeline.addEnterGuard(routeName, guard);
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
		this._pipeline.removeEnterGuard(routeName, guard);
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
		this._pipeline.addLeaveGuard(routeName, guard);
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
		this._pipeline.removeLeaveGuard(routeName, guard);
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
		if (this._phase.kind !== "evaluating") {
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
	detachNavigationSettled(fnFunction: (evt: Router$NavigationSettledEvent) => void, oListener?: object): this {
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
	 * returns without navigating. If it matches the in-flight attempt's
	 * hash, the in-flight preflight continues undisturbed.
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
	 * @override sap.ui.core.routing.Router#navTo
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

		// Redirect path: _redirect() calls this.navTo() while in committing/redirect phase.
		// Bypass preflight -- parse() will commit directly via the committing phase.
		if (this._phase.kind === "committing" && this._phase.origin === "redirect") {
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
		if (this._phase.kind === "evaluating" && targetHash === this._phase.attempt.hash) {
			return this;
		}

		// Cancel any pending navigation (including previous async preflight).
		this._cancelPendingNavigation();

		const controller = new AbortController();
		const generation = this._parseGeneration;

		this._phase = {
			kind: "evaluating",
			attempt: { hash: targetHash, route: toRoute, controller, generation },
		};

		const context: GuardContext = {
			toRoute,
			toHash: targetHash,
			toArguments: routeInfo?.arguments ?? {},
			fromRoute: this._currentRoute,
			fromHash: this._currentHash ?? "",
			signal: controller.signal,
		};

		const decision = this._pipeline.evaluate(context);

		if (isPromiseLike(decision)) {
			decision
				.then((d: GuardDecision) => {
					if (generation !== this._parseGeneration || this._phase.kind !== "evaluating") {
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
					// Only check generation here, not phase. If _redirect threw and its
					// finally already reset phase to idle, we still need to drain
					// settlement resolvers via _blockNavigation.
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
	 * Apply a preflight guard decision. For "allow", enter the committing
	 * phase and call super.navTo(). For "block", flush settlement without
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
				this._phase = { kind: "committing", hash: targetHash, route: toRoute, origin: "preflight" };
				super.navTo(routeName, parameters, componentTargetInfo, bReplace);
				// Safety: if super.navTo didn't trigger parse (e.g. hash didn't change),
				// clear the marker to avoid stale state.
				if (this._phase.kind === "committing" && this._phase.hash === targetHash) {
					// Hash didn't change, so parse() wasn't called. Commit manually.
					this._commitNavigation(targetHash, toRoute);
				}
				break;
			case "block":
				this._blockNavigation(targetHash, false);
				break;
			case "redirect": {
				const { attempt } = this._phase as PhaseEvaluating;
				const visited = new Set<string>();
				visited.add(targetHash);
				this._redirect(decision.target, {
					visited,
					attemptedHash: targetHash,
					restoreHash: false,
					fromRoute: this._currentRoute,
					fromHash: this._currentHash ?? "",
					signal: attempt.controller.signal,
					generation: attempt.generation,
				});
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

		if (this._phase.kind === "committing") {
			this._commitNavigation(
				newHash,
				this._phase.route !== "" ? this._phase.route : (this.getRouteInfoByHash(newHash)?.name ?? ""),
			);
			return;
		}

		if (this._currentHash !== null && newHash === this._currentHash) {
			this._cancelPendingNavigation();
			return;
		}

		const routeInfo = this.getRouteInfoByHash(newHash);
		const toRoute = routeInfo?.name ?? "";

		this._cancelPendingNavigation();

		const controller = new AbortController();
		const generation = this._parseGeneration;

		this._phase = {
			kind: "evaluating",
			attempt: { hash: newHash, route: toRoute, controller, generation },
		};

		const context: GuardContext = {
			toRoute,
			toHash: newHash,
			toArguments: routeInfo?.arguments ?? {},
			fromRoute: this._currentRoute,
			fromHash: this._currentHash ?? "",
			signal: controller.signal,
		};

		const decision = this._pipeline.evaluate(context);

		if (isPromiseLike(decision)) {
			decision
				.then((d: GuardDecision) => {
					if (generation !== this._parseGeneration || this._phase.kind !== "evaluating") {
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
					// Only check generation here, not phase. If _redirect threw and its
					// finally already reset phase to idle, we still need to drain
					// settlement resolvers via _blockNavigation.
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
		// Cancel first so in-flight navigationSettled() resolvers receive the
		// Cancelled result before _lastSettlement is cleared below.
		this._cancelPendingNavigation();
		this._suppressedHash = null;
		this._currentRoute = "";
		this._currentHash = null;
		this._lastSettlement = null;
		super.stop();
		return this;
	}

	/**
	 * Invalidate any in-flight async guard work. Bumps the generation counter
	 * so pending `.then()` callbacks see they are stale, aborts the signal,
	 * and transitions to idle.
	 */
	private _cancelPendingNavigation(): void {
		++this._parseGeneration;
		if (this._phase.kind === "evaluating") {
			this._phase.attempt.controller.abort();
			this._flushSettlement({
				status: NavigationOutcome.Cancelled,
				route: this._currentRoute,
				hash: this._currentHash ?? "",
			});
		}
		this._phase = IDLE;
	}

	/**
	 * Apply a guard decision for the parse() fallback path.
	 */
	private _applyDecision(decision: GuardDecision, hash: string, route: string): void {
		switch (decision.action) {
			case "allow":
				this._phase = { kind: "committing", hash, route, origin: "parse" };
				this._commitNavigation(hash, route);
				break;
			case "block":
				this._blockNavigation(hash);
				break;
			case "redirect": {
				const { attempt } = this._phase as PhaseEvaluating;
				const visited = new Set<string>();
				visited.add(hash);
				this._redirect(decision.target, {
					visited,
					attemptedHash: hash,
					restoreHash: true,
					fromRoute: this._currentRoute,
					fromHash: this._currentHash ?? "",
					signal: attempt.controller.signal,
					generation: attempt.generation,
				});
				break;
			}
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
		const wasRedirect = this._phase.kind === "committing" && this._phase.origin === "redirect";
		this._currentHash = hash;
		this._currentRoute = route ?? this.getRouteInfoByHash(hash)?.name ?? "";
		// Transition to idle before super.parse so that routeMatched/patternMatched
		// handlers that call navTo() go through the full guard pipeline.
		this._phase = IDLE;
		this._flushSettlement({
			status: wasRedirect
				? NavigationOutcome.Redirected
				: this._currentRoute === ""
					? NavigationOutcome.Bypassed
					: NavigationOutcome.Committed,
			route: this._currentRoute,
			hash,
		});
		super.parse(hash);
	}

	/** Perform a guard redirect with full guard evaluation on the target route. */
	private _redirect(target: string | GuardRedirect, chain: RedirectChainContext): void {
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

		// Loop detection: visited set (exact hash match) + depth cap.
		if (targetHash !== null && chain.visited.has(targetHash)) {
			Log.error(
				`Guard redirect loop detected: ${[...chain.visited, targetHash].join(" -> ")}`,
				undefined,
				LOG_COMPONENT,
			);
			this._blockNavigation(chain.attemptedHash, chain.restoreHash);
			return;
		}
		if (chain.visited.size >= MAX_REDIRECT_DEPTH) {
			Log.error(
				`Guard redirect chain exceeded maximum depth (${MAX_REDIRECT_DEPTH}): ${[...chain.visited].join(" -> ")}`,
				undefined,
				LOG_COMPONENT,
			);
			this._blockNavigation(chain.attemptedHash, chain.restoreHash);
			return;
		}
		if (targetHash !== null) {
			chain.visited.add(targetHash);
		}

		// If the target route doesn't exist or the hash couldn't be resolved,
		// attempt navTo (parent may fire bypassed) and fall back to blocked.
		if (targetHash === null) {
			const settlementBefore = this._lastSettlement;
			this._phase = { kind: "committing", hash: "", route: targetName, origin: "redirect" };
			try {
				if (typeof target === "string") {
					this.navTo(target, {}, {}, true);
				} else {
					this.navTo(target.route, target.parameters ?? {}, target.componentTargetInfo, true);
				}
			} finally {
				if (this._phase.kind === "committing") {
					this._phase = IDLE;
				}
			}
			if (this._lastSettlement === settlementBefore) {
				Log.warning(
					`Guard redirect target "${targetName}" did not produce a navigation, treating as blocked`,
					undefined,
					LOG_COMPONENT,
				);
				this._blockNavigation(chain.attemptedHash, chain.restoreHash);
			}
			return;
		}

		// Build guard context for the redirect target.
		const routeInfo = this.getRouteInfoByHash(targetHash);
		const context: GuardContext = {
			toRoute: routeInfo?.name ?? "",
			toHash: targetHash,
			toArguments: routeInfo?.arguments ?? {},
			fromRoute: chain.fromRoute,
			fromHash: chain.fromHash,
			signal: chain.signal,
		};

		const decision = this._pipeline.evaluate(context, { skipLeaveGuards: true });

		if (isPromiseLike(decision)) {
			decision
				.then((d: GuardDecision) => {
					if (chain.generation !== this._parseGeneration) return;
					this._applyRedirectDecision(d, target, targetHash!, chain);
				})
				.catch((error: unknown) => {
					if (chain.generation !== this._parseGeneration) return;
					Log.error(
						`Guard pipeline failed during redirect chain for "${targetName}", blocking navigation`,
						String(error),
						LOG_COMPONENT,
					);
					this._blockNavigation(chain.attemptedHash, chain.restoreHash);
				});
			return;
		}

		this._applyRedirectDecision(decision, target, targetHash, chain);
	}

	/**
	 * Apply a guard decision within a redirect chain. For "allow", enter
	 * committing phase and delegate to navTo (which hits the existing bypass).
	 * For "block", block the entire chain. For "redirect", recurse.
	 */
	private _applyRedirectDecision(
		decision: GuardDecision,
		target: string | GuardRedirect,
		targetHash: string,
		chain: RedirectChainContext,
	): void {
		switch (decision.action) {
			case "allow": {
				const targetName = typeof target === "string" ? target : target.route;
				const settlementBefore = this._lastSettlement;
				this._phase = { kind: "committing", hash: targetHash, route: targetName, origin: "redirect" };
				try {
					if (typeof target === "string") {
						this.navTo(target, {}, {}, true);
					} else {
						this.navTo(target.route, target.parameters ?? {}, target.componentTargetInfo, true);
					}
				} finally {
					if (this._phase.kind === "committing") {
						this._phase = IDLE;
					}
				}
				// Safety net: if navTo didn't produce a settlement (e.g. unknown route
				// or redirect to current hash where HashChanger doesn't fire), handle it.
				if (this._lastSettlement === settlementBefore) {
					const redirectsToCurrentHash = targetHash === (this._currentHash ?? "");
					if (redirectsToCurrentHash) {
						this._phase = {
							kind: "committing",
							hash: this._currentHash ?? "",
							route: this._currentRoute,
							origin: "redirect",
						};
						this._commitNavigation(this._currentHash ?? "", this._currentRoute);
						return;
					}
					Log.warning(
						`Guard redirect target "${targetName}" did not produce a navigation, treating as blocked`,
						undefined,
						LOG_COMPONENT,
					);
					this._blockNavigation(chain.attemptedHash, chain.restoreHash);
				}
				break;
			}
			case "block":
				this._blockNavigation(chain.attemptedHash, chain.restoreHash);
				break;
			case "redirect":
				this._redirect(decision.target, chain);
				break;
		}
	}

	/**
	 * Clear pending state and flush a Blocked settlement.
	 * When `restoreHash` is true (default), also restores the browser hash
	 * to `_currentHash`. Preflight callers pass false because the hash was
	 * never changed.
	 */
	private _blockNavigation(attemptedHash?: string, restoreHash = true): void {
		this._phase = IDLE;
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
		this._pipeline.clear();
		this._cancelPendingNavigation();
		this._suppressedHash = null;
		this._lastSettlement = null;
		super.destroy();
		return this;
	}
}
