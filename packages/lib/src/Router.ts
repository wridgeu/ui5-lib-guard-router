import MobileRouter from "sap/m/routing/Router";
import Log from "sap/base/Log";
import coreLibrary from "sap/ui/core/library";
import type { ComponentTargetParameters } from "sap/ui/core/routing/Router";
import type Route from "sap/ui/core/routing/Route";
import type { $RouteSettings } from "sap/ui/core/routing/Route";
import type UIComponent from "sap/ui/core/UIComponent";
import type {
	GuardFn,
	GuardContext,
	GuardNavToOptions,
	GuardRedirect,
	GuardRouter,
	GuardRouterConfig,
	LeaveGuardFn,
	NavigationResult,
	Router$NavigationSettledEvent,
	RouteGuardConfig,
} from "./types";
import NavigationOutcome from "./NavigationOutcome";
import GuardPipeline, { type GuardDecision, isPromiseLike } from "./GuardPipeline";
import { type GuardDescriptor, isRecord, parseGuardRouterConfig, type ResolvedGuardRouterOptions } from "./GuardConfig";
import { createLazyGuards, loadGuardModules } from "./GuardModules";
import { expandForNewRoute, expandToDescendants, type RoutePattern } from "./PatternTree";
import RouteMetaStore, { EMPTY_META } from "./RouteMeta";

const HistoryDirection = coreLibrary.routing.HistoryDirection;

const LOG_COMPONENT = "ui5.guard.router.Router";

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
	/** Original source route (the route the user occupies). */
	readonly fromRoute: string;
	/** Original source hash (the hash the user occupies). */
	readonly fromHash: string;
	/** Shared AbortSignal from the original navigation. */
	readonly signal: AbortSignal;
	/** Shared generation counter from the original navigation. */
	readonly generation: number;
	/** Shared bag from the original navigation's guard context. */
	readonly bag: Map<string, unknown>;
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
	private _options: ResolvedGuardRouterOptions;
	private _pipeline = new GuardPipeline();
	private _currentRoute = "";
	private _currentHash: string | null = null;
	private _phase: RouterPhase = IDLE;
	private _parseGeneration = 0;
	private _suppressedHash: string | null = null;
	private _settlementResolvers: ((result: NavigationResult) => void)[] = [];
	private _lastSettlement: NavigationResult | null = null;
	private _pendingGuardDescriptors: GuardDescriptor[];
	private _sourceDescriptors: GuardDescriptor[] = [];
	private _destroyed = false;
	private _meta: RouteMetaStore;
	private _routeNames: string[] = [];
	private readonly _ownerComponent: UIComponent | undefined;

	constructor(routes?: object | object[], config?: GuardRouterConfig, owner?: UIComponent, targetsConfig?: object) {
		const isRecordConfig = isRecord(config);
		const { guardRouter, ...cleanConfig } = isRecordConfig ? config : {};
		super(routes, isRecordConfig ? cleanConfig : config, owner, targetsConfig);
		this._ownerComponent = owner;
		let componentNamespace = "";
		const appConfig = owner?.getManifestEntry("sap.app") as unknown;
		if (isRecord(appConfig) && typeof appConfig.id === "string") {
			componentNamespace = appConfig.id;
		}
		const parsed = parseGuardRouterConfig(guardRouter, componentNamespace);
		this._options = parsed.options;
		this._meta = new RouteMetaStore(
			parsed.routeMeta,
			this._options.inheritance === "pattern-tree" ? () => this._collectRoutePatterns() : null,
		);
		this._pendingGuardDescriptors = parsed.guards;

		// Collect route names from the constructor's routes parameter for pattern-tree traversal.
		if (Array.isArray(routes)) {
			this._routeNames = routes
				.filter((r): r is { name: string } => isRecord(r) && typeof r.name === "string")
				.map((r) => r.name);
		} else if (isRecord(routes)) {
			this._routeNames = Object.keys(routes);
		}

		// Fire-and-forget preload hint: a module cached by initialize()
		// needs no async load on navigation (see _registerLazyGuards).
		// Block mode loads modules itself in initialize().
		if (this._pendingGuardDescriptors.length > 0 && this._options.guardLoading === "lazy") {
			const uniquePaths = [...new Set(this._pendingGuardDescriptors.map((d) => d.modulePath))];
			sap.ui.require(uniquePaths);
		}
	}

	/**
	 * Initialize the router. When manifest guards are declared and
	 * `guardLoading` is `"block"`, module loading starts and
	 * `super.initialize()` is deferred until all modules are loaded.
	 * In `"lazy"` mode, lazy wrappers are registered synchronously
	 * and `super.initialize()` is called immediately.
	 *
	 * @override sap.ui.core.routing.Router#initialize
	 * @since 1.0.1
	 */
	override initialize(): this {
		if (this._pendingGuardDescriptors.length === 0) {
			return super.initialize();
		}

		const descriptors = this._pendingGuardDescriptors;
		this._pendingGuardDescriptors = [];
		this._sourceDescriptors = descriptors;

		const expandedDescriptors =
			this._options.inheritance === "pattern-tree"
				? expandToDescendants(descriptors, this._collectRoutePatterns())
				: descriptors;

		if (this._options.guardLoading === "lazy") {
			this._registerLazyGuards(expandedDescriptors);
			return super.initialize();
		}

		// "block" mode: load all modules, then initialize.
		// Guard against destroy() being called while modules are still loading.
		this._loadAndRegisterGuards(expandedDescriptors)
			.then(() => {
				if (!this._destroyed) super.initialize();
			})
			.catch((err: unknown) => {
				if (this._destroyed) return;
				Log.error(
					"guardRouter.guards: module loading failed, initializing without manifest guards",
					String(err),
					LOG_COMPONENT,
				);
				super.initialize();
			});
		return this;
	}

	/**
	 * Add a route dynamically and integrate it into pattern-tree inheritance.
	 *
	 * Appends the route name to the internal route list so that
	 * `_collectRoutePatterns()` includes it in subsequent inheritance
	 * lookups, clears the metadata cache, and registers any inherited
	 * manifest guards when `inheritance` is `"pattern-tree"`.
	 *
	 * @param oConfig - Route configuration object as defined by `sap.ui.core.routing.Route`.
	 * @param oParent - Optional parent route, forwarded to the parent `addRoute`.
	 * @override sap.ui.core.routing.Router#addRoute
	 * @since 1.6.0
	 */
	override addRoute(oConfig: $RouteSettings, oParent?: Route): void {
		super.addRoute(oConfig, oParent);

		// Skip when called by the parent constructor before field initializers have run.
		// Routes from the constructor args are captured in _routeNames by the constructor body.
		if (!this._routeNames) return;

		const name = oConfig.name;
		if (typeof name !== "string") return;
		if (this._routeNames.includes(name)) return;

		this._routeNames.push(name);
		this._meta.invalidate();

		if (this._options.inheritance !== "pattern-tree") return;
		if (this._sourceDescriptors.length === 0) return;

		const newDescriptors = expandForNewRoute(this._sourceDescriptors, name, this._collectRoutePatterns());

		// Always use lazy registration: if the module was loaded during
		// initialize() (block mode), the sync cache probe succeeds immediately.
		// This avoids an async gap between addRoute() and the first navigation.
		this._registerLazyGuards(newDescriptors);
	}

	/**
	 * Register a global guard that runs for every navigation.
	 *
	 * @param guard - Guard function to register. Non-functions are ignored with a warning.
	 * @returns `this` for chaining.
	 * @since 1.0.1
	 */
	addGuard(guard: GuardFn): this {
		if (!this._isFn(guard, "addGuard")) return this;
		this._pipeline.addGlobalGuard(guard);
		return this;
	}

	/**
	 * Remove a previously registered global guard.
	 *
	 * @param guard - Guard function to remove by reference. Non-functions are ignored with a warning.
	 * @returns `this` for chaining.
	 * @since 1.0.1
	 */
	removeGuard(guard: GuardFn): this {
		if (!this._isFn(guard, "removeGuard")) return this;
		this._pipeline.removeGlobalGuard(guard);
		return this;
	}

	/**
	 * Register a guard for a specific route.
	 *
	 * Accepts either a guard function (registered as an enter guard) or a
	 * configuration object with `beforeEnter` and/or `beforeLeave` guards.
	 *
	 * @param routeName - Route name as defined in `manifest.json`. If the route is unknown, the {@link GuardRouterOptions.unknownRouteRegistration} policy applies (default: warn).
	 * @param guard - Guard function or {@link RouteGuardConfig} object.
	 * @returns `this` for chaining.
	 * @since 1.0.1
	 */
	addRouteGuard(routeName: string, guard: GuardFn | RouteGuardConfig): this {
		if (isRouteGuardConfig(guard)) {
			if (!this._handleUnknownRouteRegistration(routeName, "addRouteGuard")) {
				return this;
			}
			let hasHandler = false;

			if (guard.beforeEnter !== undefined) {
				hasHandler = true;
				if (this._isFn(guard.beforeEnter, "addRouteGuard", routeName)) {
					this._pipeline.addEnterGuard(routeName, guard.beforeEnter);
				}
			}
			if (guard.beforeLeave !== undefined) {
				hasHandler = true;
				if (this._isFn(guard.beforeLeave, "addRouteGuard", routeName)) {
					this._pipeline.addLeaveGuard(routeName, guard.beforeLeave);
				}
			}

			if (!hasHandler) {
				Log.info("addRouteGuard: config has no beforeEnter or beforeLeave", routeName, LOG_COMPONENT);
			}
			return this;
		}
		if (!this._isFn(guard, "addRouteGuard", routeName)) return this;
		if (!this._handleUnknownRouteRegistration(routeName, "addRouteGuard")) {
			return this;
		}
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
	 * @since 1.0.1
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
		if (!this._isFn(guard, "removeRouteGuard", routeName)) return this;
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
	 * @param routeName - Route name as defined in `manifest.json`. If the route is unknown, the {@link GuardRouterOptions.unknownRouteRegistration} policy applies (default: warn).
	 * @param guard - Leave guard function to register. Non-functions are ignored with a warning.
	 * @returns `this` for chaining.
	 * @since 1.0.1
	 */
	addLeaveGuard(routeName: string, guard: LeaveGuardFn): this {
		if (!this._isFn(guard, "addLeaveGuard", routeName)) return this;
		if (!this._handleUnknownRouteRegistration(routeName, "addLeaveGuard")) {
			return this;
		}
		this._pipeline.addLeaveGuard(routeName, guard);
		return this;
	}

	/**
	 * Disambiguate the `navTo()` overload shapes into resolved arguments.
	 *
	 * UI5's native `navTo` has two signatures where the third parameter is either
	 * `componentTargetInfo` (object) or `bReplace` (boolean). This method normalizes
	 * both forms so the rest of `navTo` can work with a single set of variables.
	 */
	private _resolveNavToArgs(
		componentTargetInfoOrReplace?: Record<string, ComponentTargetParameters> | boolean,
		replaceOrOptions?: boolean | GuardNavToOptions,
		options?: GuardNavToOptions,
	): {
		componentTargetInfo?: Record<string, ComponentTargetParameters>;
		replace?: boolean;
		guardOptions?: GuardNavToOptions;
	} {
		if (typeof componentTargetInfoOrReplace === "boolean") {
			// Short form: navTo(name, params, replace, options?)
			return {
				replace: componentTargetInfoOrReplace,
				guardOptions:
					typeof replaceOrOptions === "object" && replaceOrOptions !== null ? replaceOrOptions : undefined,
			};
		}
		// Long form: navTo(name, params, componentTargetInfo, replace, options?)
		return {
			componentTargetInfo: componentTargetInfoOrReplace,
			replace: typeof replaceOrOptions === "boolean" ? replaceOrOptions : undefined,
			guardOptions: options,
		};
	}

	/** Return `true` when the value is a function; otherwise log a warning. */
	private _isFn(value: unknown, method: string, detail?: string): boolean {
		if (typeof value === "function") return true;
		Log.warning(`${method}: not a function, ignoring`, detail, LOG_COMPONENT);
		return false;
	}

	/**
	 * Handle guard registration for a potentially unknown route.
	 * Returns `true` if registration should proceed, `false` if not.
	 */
	private _handleUnknownRouteRegistration(routeName: string, methodName: string): boolean {
		if (this.getRoute(routeName)) return true;

		switch (this._options.unknownRouteRegistration) {
			case "ignore":
				return true;
			case "throw":
				throw new Error(
					`${methodName} called for unknown route "${routeName}". ` +
						`Set guardRouter.unknownRouteRegistration to "warn" or "ignore" to allow this.`,
				);
			case "warn":
			default:
				Log.warning(`${methodName}: unknown route, guard registered anyway`, routeName, LOG_COMPONENT);
				return true;
		}
	}

	/**
	 * Remove a leave guard from a specific route.
	 *
	 * @param routeName - Route name as defined in `manifest.json`.
	 * @param guard - Leave guard function to remove by reference. Non-functions are ignored with a warning.
	 * @returns `this` for chaining.
	 * @since 1.0.1
	 */
	removeLeaveGuard(routeName: string, guard: LeaveGuardFn): this {
		if (!this._isFn(guard, "removeLeaveGuard", routeName)) return this;
		this._pipeline.removeLeaveGuard(routeName, guard);
		return this;
	}

	/**
	 * Return the resolved metadata for a route.
	 *
	 * When `inheritance` is `"pattern-tree"`, walks the ancestor chain and
	 * shallow-merges metadata shallowest-first (child values win on conflict).
	 * Both manifest and runtime metadata participate in inheritance.
	 * The router caches results; {@link setRouteMeta} and `addRoute()` clear the cache.
	 *
	 * Logs a warning for unknown non-empty route names and returns an empty
	 * frozen object. The empty string `""` is treated as a valid root route.
	 *
	 * @param routeName - Route name as defined in `manifest.json`.
	 * @returns Frozen record of metadata key-value pairs, or an empty frozen object if the route has no metadata.
	 * @since 1.6.0
	 */
	getRouteMeta(routeName: string): Readonly<Record<string, unknown>> {
		// Empty string is a valid root route name (initial state before first navigation)
		if (routeName !== "" && !this.getRoute(routeName)) {
			Log.warning("getRouteMeta: unknown route, returning empty metadata", routeName, LOG_COMPONENT);
			return EMPTY_META;
		}
		return this._meta.get(routeName);
	}

	/**
	 * Set runtime metadata for a route.
	 *
	 * Runtime metadata is merged on top of any manifest-declared metadata
	 * when retrieved via {@link getRouteMeta}. When `inheritance` is
	 * `"pattern-tree"`, descendant routes also see the updated values.
	 * Invalidates the resolved-metadata cache. Non-object values are
	 * ignored with a warning. Subject to the `unknownRouteRegistration` policy.
	 *
	 * @param routeName - Route name as defined in `manifest.json`.
	 * @param meta - Plain object of metadata key-value pairs.
	 * @returns `this` for chaining.
	 * @since 1.6.0
	 */
	setRouteMeta(routeName: string, meta: Record<string, unknown>): this {
		if (!isRecord(meta)) {
			Log.warning("setRouteMeta: expected object, ignoring", routeName, LOG_COMPONENT);
			return this;
		}
		if (routeName !== "" && !this._handleUnknownRouteRegistration(routeName, "setRouteMeta")) {
			return this;
		}
		this._meta.set(routeName, meta);
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
	 * @since 1.2.0
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
	 * @since 1.3.0
	 */
	attachNavigationSettled(
		oData: object,
		fnFunction: (evt: Router$NavigationSettledEvent) => void,
		oListener?: object,
	): this;
	attachNavigationSettled(fnFunction: (evt: Router$NavigationSettledEvent) => void, oListener?: object): this;
	attachNavigationSettled(oData: unknown, fnFunction?: unknown, oListener?: unknown): this {
		this.attachEvent(
			"navigationSettled",
			oData as object,
			fnFunction as (...args: unknown[]) => void,
			oListener as object,
		);
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
	 * @since 1.3.0
	 */
	detachNavigationSettled(fnFunction: (evt: Router$NavigationSettledEvent) => void, oListener?: object): this {
		this.detachEvent("navigationSettled", fnFunction as (...args: unknown[]) => void, oListener);
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
	 * @since 1.0.1
	 */
	override navTo(
		routeName: string,
		parameters?: object,
		componentTargetInfo?: Record<string, ComponentTargetParameters>,
		bReplace?: boolean,
	): this;
	override navTo(routeName: string, parameters?: object, bReplace?: boolean): this;
	override navTo(routeName: string, parameters?: object, bReplace?: boolean, options?: GuardNavToOptions): this;
	override navTo(
		routeName: string,
		parameters?: object,
		componentTargetInfo?: Record<string, ComponentTargetParameters>,
		bReplace?: boolean,
		options?: GuardNavToOptions,
	): this;
	override navTo(
		routeName: string,
		parameters?: object,
		componentTargetInfoOrReplace?: Record<string, ComponentTargetParameters> | boolean,
		replaceOrOptions?: boolean | GuardNavToOptions,
		options?: GuardNavToOptions,
	): this {
		const { componentTargetInfo, replace, guardOptions } = this._resolveNavToArgs(
			componentTargetInfoOrReplace,
			replaceOrOptions,
			options,
		);

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

		const skipGuards = guardOptions?.skipGuards === true;

		// Bypass mode: skip guards for programmatic navTo() -- commit directly.
		if (skipGuards || this._options.navToPreflight === "bypass") {
			this._phase = { kind: "committing", hash: targetHash, route: toRoute, origin: "preflight" };
			super.navTo(routeName, parameters, componentTargetInfo, replace);
			// Safety: if super.navTo didn't trigger parse (e.g. hash didn't change),
			// clear the marker to avoid stale state.
			if (this._phase.kind === "committing" && this._phase.hash === targetHash) {
				this._commitNavigation(targetHash, toRoute);
			}
			return this;
		}

		// Off mode: defer guard evaluation to parse() fallback.
		if (this._options.navToPreflight === "off") {
			super.navTo(routeName, parameters, componentTargetInfo, replace);
			return this;
		}

		// Default "guard" mode: evaluate guards before hash change.
		const controller = new AbortController();
		const generation = this._parseGeneration;

		const attempt: NavigationAttempt = { hash: targetHash, route: toRoute, controller, generation };
		this._phase = { kind: "evaluating", attempt };

		const context = this._createGuardContext(toRoute, targetHash, routeInfo, controller.signal);

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
						context.bag,
						attempt,
					);
				})
				.catch((error: unknown) => {
					// Only check generation here, not phase. If _redirect threw and its
					// finally already reset phase to idle, we still need to drain
					// settlement resolvers via _errorNavigation.
					if (generation !== this._parseGeneration) return;
					Log.error(
						`Async preflight guard failed for route "${routeName}", navigation failed`,
						String(error),
						LOG_COMPONENT,
					);
					this._errorNavigation(error, targetHash, false);
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
			context.bag,
			attempt,
		);
		return this;
	}

	/**
	 * Apply a preflight guard decision. For "allow", enter the committing
	 * phase and call super.navTo(). For "block", flush settlement without
	 * touching the hash. For "redirect", start a redirect chain.
	 * For "error", flush Error settlement with the guard's error.
	 *
	 * @param decision - Normalized guard pipeline result.
	 * @param routeName - Original route name passed to navTo().
	 * @param parameters - Original route parameters.
	 * @param componentTargetInfo - Optional component target info from the navTo() overload.
	 * @param bReplace - Whether to replace the current history entry.
	 * @param targetHash - Resolved hash for the target route.
	 * @param toRoute - Resolved route name (may differ from routeName for nested routes).
	 */
	private _applyPreflightDecision(
		decision: GuardDecision,
		routeName: string,
		parameters: object | undefined,
		componentTargetInfo: Record<string, ComponentTargetParameters> | undefined,
		bReplace: boolean | undefined,
		targetHash: string,
		toRoute: string,
		bag: Map<string, unknown>,
		attempt: NavigationAttempt,
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
			case "redirect":
				this._startRedirectChain(decision.target, targetHash, false, bag, attempt);
				break;
			case "error":
				this._errorNavigation(decision.error, targetHash, false);
				break;
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
	 * @since 1.0.1
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

		const attempt: NavigationAttempt = { hash: newHash, route: toRoute, controller, generation };
		this._phase = { kind: "evaluating", attempt };

		const context = this._createGuardContext(toRoute, newHash, routeInfo, controller.signal);

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
					this._applyDecision(d, newHash, toRoute, context.bag, attempt);
				})
				.catch((error: unknown) => {
					// Only check generation here, not phase. If _redirect threw and its
					// finally already reset phase to idle, we still need to drain
					// settlement resolvers via _errorNavigation.
					if (generation !== this._parseGeneration) return;
					Log.error(
						`Guard pipeline failed for "${newHash}", navigation failed`,
						String(error),
						LOG_COMPONENT,
					);
					this._errorNavigation(error, newHash);
				});
			return;
		}

		this._applyDecision(decision, newHash, toRoute, context.bag, attempt);
	}

	/**
	 * Stop listening to hash changes and reset guard state.
	 *
	 * Resets `_currentRoute` and `_currentHash` so that a subsequent
	 * `initialize()` re-parses the current hash and fires `routeMatched`,
	 * matching the native `sap.m.routing.Router` behavior.
	 *
	 * @override sap.ui.core.routing.Router#stop
	 * @since 1.0.1
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
	private _applyDecision(
		decision: GuardDecision,
		hash: string,
		route: string,
		bag: Map<string, unknown>,
		attempt: NavigationAttempt,
	): void {
		switch (decision.action) {
			case "allow":
				this._phase = { kind: "committing", hash, route, origin: "parse" };
				this._commitNavigation(hash, route);
				break;
			case "block":
				this._blockNavigation(hash);
				break;
			case "redirect":
				this._startRedirectChain(decision.target, hash, true, bag, attempt);
				break;
			case "error":
				this._errorNavigation(decision.error, hash);
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
	private _commitNavigation(hash: string, route: string): void {
		const wasRedirect = this._phase.kind === "committing" && this._phase.origin === "redirect";
		this._currentHash = hash;
		this._currentRoute = route;
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

	/**
	 * Evaluate guards on a redirect target and apply the resulting decision.
	 *
	 * Handles loop detection (visited-hash set + depth cap), unknown-route
	 * fallback, sync/async guard evaluation, and recursive chaining when
	 * the target's guard itself returns a redirect. All hops in a chain
	 * share the same AbortSignal and generation counter from the original
	 * navigation so that a superseding navigation correctly discards
	 * in-flight redirect work.
	 *
	 * @param target - Redirect target: a route name string or {@link GuardRedirect} with parameters.
	 * @param chain - Mutable context threaded through the redirect chain (visited set, signals, etc.).
	 */
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
		if (chain.visited.size > MAX_REDIRECT_DEPTH) {
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

		// Narrowed after the null-branch early return; const carries it into the async closure.
		const resolvedHash: string = targetHash;

		// Build guard context for the redirect target.
		const routeInfo = this.getRouteInfoByHash(resolvedHash);
		const context: GuardContext = {
			toRoute: routeInfo?.name ?? "",
			toHash: resolvedHash,
			toArguments: routeInfo?.arguments ?? {},
			fromRoute: chain.fromRoute,
			fromHash: chain.fromHash,
			signal: chain.signal,
			bag: chain.bag,
			toMeta: this.getRouteMeta(routeInfo?.name ?? ""),
			fromMeta: this.getRouteMeta(chain.fromRoute),
			ownerComponent: this._ownerComponent,
		};

		const decision = this._pipeline.evaluate(context, { skipLeaveGuards: true });

		if (isPromiseLike(decision)) {
			decision
				.then((d: GuardDecision) => {
					if (chain.generation !== this._parseGeneration) return;
					this._applyRedirectDecision(d, target, resolvedHash, chain);
				})
				.catch((error: unknown) => {
					if (chain.generation !== this._parseGeneration) return;
					Log.error(
						`Guard pipeline failed during redirect chain for "${targetName}", navigation failed`,
						String(error),
						LOG_COMPONENT,
					);
					this._errorNavigation(error, chain.attemptedHash, chain.restoreHash);
				});
			return;
		}

		this._applyRedirectDecision(decision, target, resolvedHash, chain);
	}

	/**
	 * Apply a guard decision within a redirect chain. For "allow", enter
	 * committing phase and delegate to navTo (which hits the existing bypass).
	 * For "block", block the entire chain. For "redirect", recurse.
	 *
	 * @param decision - Normalized guard pipeline result for this hop.
	 * @param target - The redirect target (route name or {@link GuardRedirect}).
	 * @param targetHash - Resolved hash for the redirect target (guaranteed non-null).
	 * @param chain - Shared redirect chain context with visited set, signals, etc.
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
			case "error":
				this._errorNavigation(decision.error, chain.attemptedHash, chain.restoreHash);
				break;
		}
	}

	/**
	 * Build a guard context for a new navigation.
	 * Called by {@link navTo} (preflight path) and {@link parse} (browser-initiated path).
	 */
	private _createGuardContext(
		toRoute: string,
		toHash: string,
		routeInfo: { arguments: Record<string, string | Record<string, string>> } | undefined,
		signal: AbortSignal,
	): GuardContext {
		return {
			toRoute,
			toHash,
			toArguments: routeInfo?.arguments ?? {},
			fromRoute: this._currentRoute,
			fromHash: this._currentHash ?? "",
			signal,
			bag: new Map(),
			toMeta: this.getRouteMeta(toRoute),
			fromMeta: this.getRouteMeta(this._currentRoute),
			ownerComponent: this._ownerComponent,
		};
	}

	/**
	 * Start a new redirect chain for the given evaluating attempt.
	 * Called by {@link _applyPreflightDecision} and {@link _applyDecision}
	 * when a guard returns a redirect. Delegates to {@link _redirect} with
	 * a fresh {@link RedirectChainContext}.
	 */
	private _startRedirectChain(
		target: string | GuardRedirect,
		hash: string,
		restoreHash: boolean,
		bag: Map<string, unknown>,
		attempt: NavigationAttempt,
	): void {
		const visited = new Set<string>();
		visited.add(hash);
		this._redirect(target, {
			visited,
			attemptedHash: hash,
			restoreHash,
			fromRoute: this._currentRoute,
			fromHash: this._currentHash ?? "",
			signal: attempt.controller.signal,
			generation: attempt.generation,
			bag,
		});
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
		this._restoreHashIfNeeded(attemptedHash, restoreHash);
	}

	/**
	 * Clear pending state and flush an Error settlement.
	 * Same structure as {@link _blockNavigation} but with `NavigationOutcome.Error`
	 * and the error that caused the failure.
	 */
	private _errorNavigation(error: unknown, attemptedHash?: string, restoreHash = true): void {
		this._phase = IDLE;
		this._flushSettlement({
			status: NavigationOutcome.Error,
			route: this._currentRoute,
			hash: this._currentHash ?? "",
			error,
		});
		this._restoreHashIfNeeded(attemptedHash, restoreHash);
	}

	/** Conditionally restore the browser hash after a blocked or errored navigation. */
	private _restoreHashIfNeeded(attemptedHash: string | undefined, restoreHash: boolean): void {
		if (!restoreHash) return;
		if (this._currentHash === null && attemptedHash) {
			this._restoreHash("", false);
			return;
		}
		this._restoreHash(this._currentHash ?? "");
	}

	/**
	 * Restore the previous hash without creating a history entry.
	 * Assumes replaceHash fires hashChanged synchronously (validated by test).
	 * `_currentRoute` stays unchanged because the navigation never
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

	/**
	 * Collect all route names and their patterns from the router.
	 * Skips routes whose pattern is undefined (no pattern configured).
	 */
	private _collectRoutePatterns(): RoutePattern[] {
		const result: RoutePattern[] = [];
		for (const name of this._routeNames) {
			const route = this.getRoute(name);
			if (route) {
				const pattern = route.getPattern();
				if (pattern !== undefined) {
					result.push({ name, pattern });
				}
			}
		}
		return result;
	}

	/**
	 * Load all guard modules, then register their guards in declaration order.
	 * Registration errors (e.g. from `unknownRouteRegistration: "throw"`) are
	 * caught per guard.
	 */
	private _loadAndRegisterGuards(descriptors: GuardDescriptor[]): Promise<void> {
		return loadGuardModules(descriptors).then((results) => {
			for (const { descriptor, guards } of results) {
				for (const fn of guards) {
					try {
						this._registerGuardFromDescriptor(descriptor, fn);
					} catch (err: unknown) {
						Log.error(
							`guardRouter.guards: failed to register "${descriptor.modulePath}"`,
							String(err),
							LOG_COMPONENT,
						);
					}
				}
			}
		});
	}

	/**
	 * Route a parsed guard descriptor to the correct registration method.
	 */
	private _registerGuardFromDescriptor(descriptor: GuardDescriptor, guardFn: GuardFn): void {
		if (descriptor.route === "*") {
			this.addGuard(guardFn);
		} else if (descriptor.type === "leave") {
			if (!this._handleUnknownRouteRegistration(descriptor.route, "addLeaveGuard")) return;
			this._pipeline.addLeaveGuard(descriptor.route, guardFn);
		} else {
			this.addRouteGuard(descriptor.route, guardFn);
		}
	}

	/** Register the guards of each descriptor, loading their modules on first use (see `createLazyGuards`). */
	private _registerLazyGuards(descriptors: GuardDescriptor[]): void {
		for (const descriptor of descriptors) {
			for (const fn of createLazyGuards(descriptor)) {
				this._registerGuardFromDescriptor(descriptor, fn);
			}
		}
	}

	/**
	 * Clean up guards on destroy. Bumps generation to discard pending async results.
	 *
	 * @since 1.0.1
	 */
	override destroy(): this {
		this._destroyed = true;
		this._pipeline.clear();
		this._pendingGuardDescriptors = [];
		this._sourceDescriptors = [];
		this._cancelPendingNavigation();
		this._suppressedHash = null;
		this._lastSettlement = null;
		this._meta.clear();
		super.destroy();
		return this;
	}
}
