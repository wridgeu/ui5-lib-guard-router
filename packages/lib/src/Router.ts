import MobileRouter from "sap/m/routing/Router";
import Log from "sap/base/Log";
import coreLibrary from "sap/ui/core/library";
import type { ComponentTargetParameters, Router$RouteMatchedEvent } from "sap/ui/core/routing/Router";
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
import GuardPipeline, { type GuardDecision, isPromiseLike, isPromiseResolver } from "./GuardPipeline";
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
	/** Whether the URL shows a hash that never committed, so that it must be restored unless this attempt moves it. */
	readonly restoreHash: boolean;
}

interface PhaseIdle {
	readonly kind: "idle";
}

interface PhaseEvaluating {
	readonly kind: "evaluating";
	readonly attempt: NavigationAttempt;
	/** Whether the navigation waits for async guards: the native router would be matching its route by now. */
	readonly postponed?: true;
}

interface PhaseCommitting {
	readonly kind: "committing";
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
	/** Whether to restore the hash on block (see {@link NavigationAttempt.restoreHash}). */
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
	/** What UI5 itself wrote to `_bMatchingProcessStarted` (see {@link _mirrorMatchingProcess}). */
	private _nativeMatching = false;
	/** Promises that wait for the `routeMatched` of a match that has not started (see {@link attachRouteMatched}). */
	private _matchWaiters: (() => void)[] = [];
	/**
	 * Set while block-mode guard modules load; `start` says whether to initialize once they have,
	 * `ignoreInitialHash` is the argument of the `initialize()` call that asked for it.
	 */
	private _blockLoad: { start: boolean; ignoreInitialHash?: boolean } | null = null;
	private _meta: RouteMetaStore;
	private _routeNames: string[];
	private readonly _ownerComponent: UIComponent | undefined;

	constructor(routes?: object | object[], config?: GuardRouterConfig, owner?: UIComponent, targetsConfig?: object);
	constructor(routes?: object | object[], config?: GuardRouterConfig, owner?: UIComponent, ...rest: unknown[]) {
		const isRecordConfig = isRecord(config);
		const { guardRouter, ...cleanConfig } = isRecordConfig ? config : {};
		// UI5 passes more than its types declare: after the targets config comes the
		// hash changer of a component that is loaded as a routing target.
		super(routes, isRecordConfig ? cleanConfig : config, owner, ...(rest as [object?]));
		this._ownerComponent = owner;
		this._mirrorMatchingProcess();
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

		// Collect route names for pattern-tree traversal the way UI5 names the routes:
		// an entry's own name, or its key in an object map when it has none.
		this._routeNames = Array.isArray(routes)
			? (routes as { name: string }[]).map((r) => r.name)
			: Object.entries((routes ?? {}) as Record<string, { name?: string }>).map(([key, r]) => r.name ?? key);

		// Fire-and-forget preload hint: a module cached by initialize()
		// needs no async load on navigation (see _registerLazyGuards).
		// Block mode loads modules itself in initialize().
		if (this._options.guardLoading === "lazy") {
			const uniquePaths = [...new Set(this._pendingGuardDescriptors.map((d) => d.modulePath))];
			// A failed preload is reported when the guard runs: its lazy load warns
			// and the navigation settles as Error.
			sap.ui.require(uniquePaths, undefined, () => {});
		}
	}

	/**
	 * Report a navigation that waits for async guards as a route match in progress, through the
	 * UI5-private member `_bMatchingProcessStarted` of `sap.ui.core.routing.Router`.
	 *
	 * This is one of two places where the router depends on UI5 behavior that no public contract
	 * covers. The other is {@link attachRouteMatched}.
	 *
	 * What UI5 does with the member. The native router sets it to `true` inside `parse()`, as soon
	 * as a route matches (`Route#_routeMatched`), and back to `false` once the targets of the route
	 * are displayed, right before it fires `routeMatched`. UI5 reads it in three places:
	 * - `Target#waitForComponentTarget` (nested component readiness): a component target counts as
	 *   displayed only after the next `routeMatched` of the nested component's router, if that
	 *   router is not initialized or is matching.
	 * - The `display` handler that the `Router` constructor attaches to its targets: a target
	 *   displayed outside of a route match resets the router's hash changer (`resetHash`), so that
	 *   the route that matched before can match again. Not during a match.
	 * - `Router#fireTitleChanged`: a `titleChanged` during a match is fired after `routeMatched`.
	 *
	 * Why the router is involved. It postpones `super.parse()` while guards are async, such as on
	 * the first navigation in lazy mode while a guard module loads. If the member stayed `false` in
	 * that time, a parent route would count the nested component as displayed, and fire its own
	 * `routeMatched`, before the first route of the nested component matched.
	 *
	 * What the router does. It does not write the member. It replaces it with an accessor on the
	 * instance, which keeps the value UI5 writes in {@link _nativeMatching} and reads `true`
	 * - while the value UI5 wrote is `true`, and
	 * - from the moment a navigation (initial hash, hash change, `navTo()` preflight or redirect
	 *   hop) starts to wait for async guards, until that navigation settles.
	 *
	 * A navigation that commits calls `super.parse()` in the call that settles it, where UI5 sets
	 * the member and later clears it as it does natively. A navigation that is blocked, fails, is
	 * cancelled or superseded, or ends with `stop()` or `destroy()`, reads `false` from its
	 * settlement on. Guards that decide synchronously never make it read `true`.
	 *
	 * All three readers see the same value. While a navigation waits for async guards, UI5
	 * therefore also defers a `titleChanged` to the next `routeMatched` and skips `resetHash`, as
	 * during a native match.
	 *
	 * Assumptions about UI5 that no public contract covers:
	 * - The member exists under this name, and `Route#_routeMatched` is its only writer.
	 * - `true` means to UI5 that a `routeMatched` follows. A navigation that guards veto breaks
	 *   that, which {@link attachRouteMatched} makes up for.
	 *
	 * Verified against OpenUI5 1.144.0 (`sap/ui/core/routing/Route.js` lines 745 and 831,
	 * `Target.js` 819, `Router.js` 289 and 1527) and OpenUI5 1.120.0 (`sap/ui/core/routing/async/Route.js`
	 * lines 49 and 135, `async/Target.js` 275, `Router.js` 264 and 1495). Pinned by the QUnit module
	 * "Router - Native matching flag" (`RouterAsync.qunit.ts`) and the nested component tests of
	 * "Router - Manifest-driven instantiation" (`RouterManifestGuards.qunit.ts`): they fail on both
	 * UI5 lanes if UI5 renames the member, stops writing it, or stops reading it. See
	 * docs/reference/upstream-parity.md for what to do then.
	 */
	private _mirrorMatchingProcess(): void {
		Object.defineProperty(this, "_bMatchingProcessStarted", {
			get: () => this._isMatching(),
			set: (matching: boolean) => {
				this._nativeMatching = matching;
			},
		});
	}

	/** Whether a route match is in progress: in UI5, or postponed until async guards have decided. */
	private _isMatching(): boolean {
		return this._nativeMatching || (this._phase.kind === "evaluating" && this._phase.postponed === true);
	}

	/**
	 * Attach an event handler for the `routeMatched` event, as the native router does. In addition,
	 * remember a Promise by which a UI5 component target waits for this router, so that a
	 * navigation that ends without a route match does not leave it waiting forever.
	 *
	 * What UI5 does. A component target (`"type": "Component"`) of a parent router that displays
	 * the component of this router waits for the next `routeMatched` of this router, if the router
	 * is not initialized or reports a match in progress (see {@link _mirrorMatchingProcess}), a
	 * route with targets matches the router's current hash, and the parent route did not ask to
	 * ignore that hash. It waits with
	 * `oRouter.attachRouteMatched(resolve)`, where `resolve` is the bare resolve function of a
	 * Promise that only the target holds. The Promise is never rejected and nothing else releases
	 * it: UI5 relies on a match in progress always ending in `routeMatched`. A stopped router is
	 * initialized by the target right after.
	 *
	 * Why the router is involved. A navigation that guards block, fail or cancel never fires
	 * `routeMatched`. The parent route would then never fire its own `routeMatched`, and in
	 * `sap.m.routing.Router` later target placements of the parent queue behind the one that
	 * waits (`TargetHandler#_chainNavigation`). This does not depend on the mirrored member alone.
	 * UI5 also waits when the router is not initialized: when a parent route displays the
	 * component again and starts its stopped router, and while guard modules load in block mode.
	 *
	 * What the router does. A listener that is subscribed while UI5 would wait (the router is not
	 * initialized, or a match is in progress) and that is a Promise resolve function
	 * ({@link isPromiseResolver}) is remembered. {@link _settleMatchWaiters} resolves it when a
	 * navigation ends without a route match. The parent route then displays the component, in
	 * which no route matched. The listener is subscribed as usual in any case, so a `routeMatched`
	 * resolves it as in UI5.
	 *
	 * Assumptions about UI5 that no public contract covers:
	 * - The component target subscribes through `attachRouteMatched()`, with the resolve function
	 *   itself as the only argument, under the condition above.
	 * - A second call of the resolve function has no effect, so the `routeMatched` of a later
	 *   navigation may still call it.
	 *
	 * False positives. The router cannot see who subscribes. Application code that subscribes a
	 * Promise resolve function (or another anonymous built-in with one parameter, such as a Promise
	 * reject function) under the same condition is treated in the same way: its Promise settles
	 * without an event when the navigation ends without a match. Handler functions written in
	 * JavaScript are never remembered and are only ever called by the `routeMatched` event.
	 *
	 * Verified against OpenUI5 1.144.0 (`sap/ui/core/routing/Target.js` line 786 for the Promise,
	 * 819 for the condition, 821 for the subscription, 823 to 826 for the start of a stopped router,
	 * 619 for the stop; `sap/m/routing/Target.js` line 61 for the queue) and OpenUI5 1.120.0
	 * (`sap/ui/core/routing/async/Target.js` lines 245, 275, 277, 279 to 282 and 81;
	 * `sap/m/routing/async/Target.js` line 25). Pinned by the QUnit module "GuardPipeline - Promise
	 * resolve functions" (`GuardPipeline.qunit.ts`), by the Promise tests of "Router - Native
	 * matching flag" (`RouterAsync.qunit.ts`) and by the nested component tests of "Router -
	 * Manifest-driven instantiation" (`RouterManifestGuards.qunit.ts`), which time out on both UI5
	 * lanes if the component target waits in another way. See docs/reference/upstream-parity.md.
	 *
	 * @override sap.ui.core.routing.Router#attachRouteMatched
	 * @since 1.7.0
	 */
	override attachRouteMatched(
		oData: object,
		fnFunction: (evt: Router$RouteMatchedEvent) => void,
		oListener?: object,
	): this;
	override attachRouteMatched(fnFunction: (evt: Router$RouteMatchedEvent) => void, oListener?: object): this;
	override attachRouteMatched(oData: unknown, fnFunction?: unknown, oListener?: unknown): this {
		if (isPromiseResolver(oData) && (!this.isInitialized() || this._isMatching())) {
			this._matchWaiters.push(oData);
		}
		return super.attachRouteMatched(
			oData as object,
			fnFunction as (evt: Router$RouteMatchedEvent) => void,
			oListener as object,
		);
	}

	/**
	 * Decide what becomes of the Promises that wait for a `routeMatched`
	 * (see {@link attachRouteMatched}). Runs in a microtask after a settlement, so that a commit
	 * has reached `super.parse()` and a navigation that supersedes the settled one has started:
	 * - A navigation waits for async guards: the Promises keep waiting, for its settlement.
	 * - UI5 is matching a route: the Promises are forgotten, the `routeMatched` of that match
	 *   resolves them. If UI5 never fires it, because the display of a target fails, they wait
	 *   forever, as with the native router.
	 * - Otherwise no match is coming, and the Promises are resolved.
	 *
	 * A navigation that starts after this microtask is not waited for. A Promise that is resolved
	 * here stays subscribed, and UI5 calls it again with the next `routeMatched`, which has no
	 * effect on a Promise.
	 */
	private _settleMatchWaiters(): void {
		if (this._phase.kind === "evaluating" && this._phase.postponed) return;
		const waiters = this._matchWaiters;
		this._matchWaiters = [];
		if (this._nativeMatching) return;
		for (const resolve of waiters) resolve();
	}

	/**
	 * Initialize the router. When manifest guards are declared and
	 * `guardLoading` is `"block"`, module loading starts and
	 * `super.initialize()` is deferred until all modules are loaded.
	 * In `"lazy"` mode, lazy wrappers are registered synchronously
	 * and `super.initialize()` is called immediately.
	 *
	 * While block-mode modules load, the router is not initialized yet:
	 * calling `initialize()` again changes nothing, and `stop()` cancels
	 * the pending start until `initialize()` is called again.
	 *
	 * @param bIgnoreInitialHash - Whether the current hash is left unparsed, as in the native router.
	 * @override sap.ui.core.routing.Router#initialize
	 * @since 1.0.1
	 */
	override initialize(bIgnoreInitialHash?: boolean): this {
		if (this._blockLoad) {
			if (!this._blockLoad.start) {
				this._blockLoad.start = true;
				this._blockLoad.ignoreInitialHash = bIgnoreInitialHash;
			}
			return this;
		}
		if (this._pendingGuardDescriptors.length === 0) {
			return super.initialize(bIgnoreInitialHash);
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
			return super.initialize(bIgnoreInitialHash);
		}

		// "block" mode: load all modules, then register their guards in declaration order
		// and initialize. Load and registration failures are logged per module and never
		// reject. A router destroyed while modules load stays destroyed.
		const blockLoad = { start: true, ignoreInitialHash: bIgnoreInitialHash };
		this._blockLoad = blockLoad;
		loadGuardModules(expandedDescriptors).then((results) => {
			this._blockLoad = null;
			if (this._destroyed) return;
			for (const { descriptor, guards } of results) {
				for (const fn of guards) this._registerManifestGuard(descriptor, fn);
			}
			if (blockLoad.start) super.initialize(blockLoad.ignoreInitialHash);
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
			this._handleUnknownRouteRegistration(routeName, "addRouteGuard");
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
		this._handleUnknownRouteRegistration(routeName, "addRouteGuard");
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
		this._handleUnknownRouteRegistration(routeName, "addLeaveGuard");
		this._pipeline.addLeaveGuard(routeName, guard);
		return this;
	}

	/**
	 * Disambiguate the `navTo()` overload shapes into resolved arguments.
	 *
	 * UI5's native `navTo` has two signatures where the third parameter is either
	 * `componentTargetInfo` (object) or `bReplace` (boolean). This method normalizes
	 * both forms so the rest of `navTo` can work with a single set of variables.
	 * The options follow `bReplace`, or take its place when it is left out.
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
				guardOptions: typeof replaceOrOptions === "object" ? replaceOrOptions : undefined,
			};
		}
		// Long form: navTo(name, params, componentTargetInfo, replace, options?)
		return {
			componentTargetInfo: componentTargetInfoOrReplace,
			replace: typeof replaceOrOptions === "boolean" ? replaceOrOptions : undefined,
			guardOptions: typeof replaceOrOptions === "object" ? replaceOrOptions : options,
		};
	}

	/** Return `true` when the value is a function; otherwise log a warning. */
	private _isFn(value: unknown, method: string, detail?: string): boolean {
		if (typeof value === "function") return true;
		Log.warning(`${method}: not a function, ignoring`, detail, LOG_COMPONENT);
		return false;
	}

	/** Apply the `unknownRouteRegistration` policy: warn or throw when the route is unknown. */
	private _handleUnknownRouteRegistration(routeName: string, methodName: string, kept = "guard registered"): void {
		if (this.getRoute(routeName)) return;

		switch (this._options.unknownRouteRegistration) {
			case "ignore":
				return;
			case "throw":
				throw new Error(
					`${methodName} called for unknown route "${routeName}". ` +
						`Set guardRouter.unknownRouteRegistration to "warn" or "ignore" to allow this.`,
				);
			case "warn":
			default:
				Log.warning(`${methodName}: unknown route, ${kept} anyway`, routeName, LOG_COMPONENT);
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
		if (routeName !== "") this._handleUnknownRouteRegistration(routeName, "setRouteMeta", "metadata stored");
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
		// After the call that settled: by then a commit has reached super.parse(), and a navigation
		// that supersedes this one has started.
		if (this._matchWaiters.length > 0) queueMicrotask(() => this._settleMatchWaiters());
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
	 * On a router that is not initialized (before `initialize()`, while
	 * block-mode guard modules load, after `stop()`) the call goes straight
	 * to the native `navTo()`, which only sets the hash or does nothing when
	 * stopped. The guards run when the router starts and parses the hash.
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

		// A router that does not listen to hash changes (not initialized, loading block-mode
		// guards, or stopped) navigates like the native one: the guards run once it parses the hash.
		if (!this.isInitialized()) {
			super.navTo(routeName, parameters, componentTargetInfo, replace);
			return this;
		}

		// Resolve the target hash so we can build a guard context.
		// getURL() returns the hash pattern with parameters substituted.
		const route = this.getRoute(routeName);
		if (!route) {
			// Unknown route -- let the parent handle it (it logs a warning).
			// Cancel any pending async navigation so settlement resolvers drain
			// and the stale pipeline does not commit a superseded navigation.
			this._cancelPendingNavigation(true);
			super.navTo(routeName, parameters, componentTargetInfo, replace);
			return this;
		}

		const targetHash = route.getURL(parameters ?? {});
		const routeInfo = this.getRouteInfoByHash(targetHash);
		const toRoute = routeInfo?.name ?? "";

		// Same-hash dedup: cancel any pending navigation and return without navigating.
		if (targetHash === this._currentHash) {
			this._cancelPendingNavigation(true);
			return this;
		}

		const skipGuards = guardOptions?.skipGuards === true || this._options.navToPreflight === "bypass";

		// Pending-hash dedup: if an async preflight for this exact hash is
		// already running, don't cancel and restart it. A navigation that skips
		// the guards does not wait for them.
		if (!skipGuards && this._phase.kind === "evaluating" && targetHash === this._phase.attempt.hash) {
			return this;
		}

		// Cancel any pending navigation (including previous async preflight).
		// A superseded hash-change navigation leaves its hash in the URL: restore it
		// unless this navigation moves the URL.
		const restoreHash = this._phase.kind === "evaluating" && this._phase.attempt.restoreHash;
		this._cancelPendingNavigation();

		// Bypass mode: skip guards for programmatic navTo() -- commit directly.
		if (skipGuards) {
			this._navigateAllowed(routeName, parameters, componentTargetInfo, replace, targetHash, toRoute);
			return this;
		}

		// Off mode: defer guard evaluation to parse() fallback.
		if (this._options.navToPreflight === "off") {
			super.navTo(routeName, parameters, componentTargetInfo, replace);
			return this;
		}

		// Default "guard" mode: evaluate guards before hash change.
		const attempt = this._startAttempt(targetHash, toRoute, restoreHash);
		const { generation } = attempt;

		const context = this._createGuardContext(toRoute, targetHash, routeInfo, attempt.controller.signal);

		const decision = this._pipeline.evaluate(context);

		if (isPromiseLike(decision)) {
			this._applyWhenDecided(
				decision,
				(d) => {
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
						context.bag,
						attempt,
					);
				},
				targetHash,
				restoreHash,
			);
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

	/** Navigate to a `navTo()` target that needs no guards (allowed or bypassed) and commit it. */
	private _navigateAllowed(
		routeName: string,
		parameters: object | undefined,
		componentTargetInfo: Record<string, ComponentTargetParameters> | undefined,
		bReplace: boolean | undefined,
		targetHash: string,
		toRoute: string,
	): void {
		this._phase = { kind: "committing", route: toRoute, origin: "preflight" };
		try {
			super.navTo(routeName, parameters, componentTargetInfo, bReplace);
			// parse() has not run: the hash is already the target, or changes later
			// (component targets). Commit manually.
			if (this._phase.kind === "committing") {
				this._commitNavigation(targetHash, toRoute);
			}
		} finally {
			// A failed hash change must not leave the next one to be committed without guards.
			if (this._phase.kind === "committing") {
				this._phase = IDLE;
			}
		}
	}

	/**
	 * Apply a preflight guard decision. For "allow", enter the committing
	 * phase and call super.navTo(). For "block", flush settlement; the hash is
	 * only touched to restore it after a superseded hash-change navigation.
	 * For "redirect", start a redirect chain.
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
		// A guard that navigated itself has superseded the navigation it was guarding.
		if (attempt.generation !== this._parseGeneration) return;
		switch (decision.action) {
			case "allow":
				this._navigateAllowed(routeName, parameters, componentTargetInfo, bReplace, targetHash, toRoute);
				break;
			case "block":
				this._blockNavigation(targetHash, attempt.restoreHash);
				break;
			case "redirect":
				this._startRedirectChain(decision.target, targetHash, bag, attempt);
				break;
			case "error":
				this._errorNavigation(decision.error, targetHash, attempt.restoreHash);
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
		if (this._destroyed) {
			// The base router only warns about a hash change that reaches a destroyed router.
			super.parse(newHash);
			return;
		}
		if (newHash === this._suppressedHash) {
			this._suppressedHash = null;
			return;
		}
		this._suppressedHash = null;

		if (this._phase.kind === "committing") {
			this._commitNavigation(newHash, this._phase.route);
			return;
		}

		const currentHash = this._currentHash;
		if (newHash === currentHash) {
			// The URL is back on the committed hash. That ends a navigation that had moved it away,
			// but not a navTo() that started while the hash change of a committed navigation was
			// still on its way (component targets).
			if (this._phase.kind === "evaluating" && this._phase.attempt.restoreHash) {
				this._cancelPendingNavigation();
			}
			return;
		}

		const routeInfo = this.getRouteInfoByHash(newHash);
		const toRoute = routeInfo?.name ?? "";

		this._cancelPendingNavigation();
		// A navigationSettled handler that navigated on the cancellation has moved the URL on.
		if (this._currentHash !== currentHash) return;

		const attempt = this._startAttempt(newHash, toRoute, true);
		const { generation } = attempt;

		const context = this._createGuardContext(toRoute, newHash, routeInfo, attempt.controller.signal);

		const decision = this._pipeline.evaluate(context);

		if (isPromiseLike(decision)) {
			this._applyWhenDecided(
				decision,
				(d) => {
					if (generation !== this._parseGeneration) {
						Log.debug(
							"Async guard result discarded (superseded by newer navigation)",
							newHash,
							LOG_COMPONENT,
						);
						return;
					}
					this._applyDecision(d, newHash, toRoute, context.bag, attempt);
				},
				newHash,
				true,
			);
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
		if (this._blockLoad) this._blockLoad.start = false;
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
	 * and transitions to idle. With `restoreHash`, a cancelled hash-change
	 * navigation also gets its hash restored: `navTo()` passes it when the
	 * call itself will not move the URL.
	 */
	private _cancelPendingNavigation(restoreHash = false): void {
		++this._parseGeneration;
		const phase = this._phase;
		// Idle before the settlement fires, so that a handler can navigate.
		this._phase = IDLE;
		if (phase.kind !== "evaluating") return;
		phase.attempt.controller.abort();
		this._settleUncommitted(
			{ status: NavigationOutcome.Cancelled, route: this._currentRoute, hash: this._currentHash ?? "" },
			phase.attempt.hash,
			restoreHash && phase.attempt.restoreHash,
		);
	}

	/**
	 * Start evaluating a navigation. Its generation is its own, so the result of any earlier
	 * attempt is stale: also one that a navigationSettled handler started while this
	 * navigation cancelled its predecessor, which is aborted here without a settlement.
	 */
	private _startAttempt(hash: string, route: string, restoreHash: boolean): NavigationAttempt {
		if (this._phase.kind === "evaluating") this._phase.attempt.controller.abort();
		const attempt: NavigationAttempt = {
			hash,
			route,
			controller: new AbortController(),
			generation: ++this._parseGeneration,
			restoreHash,
		};
		this._phase = { kind: "evaluating", attempt };
		return attempt;
	}

	/**
	 * Apply the decision of async guards once it is there. Until then the navigation is postponed,
	 * which UI5 sees as a route match in progress (see {@link _mirrorMatchingProcess}). The pipeline
	 * turns a failing guard into an error decision, so an error thrown here comes from applying the
	 * decision, which has no caller to throw to: it is logged, and fails the navigation unless that
	 * has settled.
	 */
	private _applyWhenDecided(
		decision: PromiseLike<GuardDecision>,
		apply: (decision: GuardDecision) => void,
		attemptedHash: string | undefined,
		restoreHash: boolean,
	): void {
		if (this._phase.kind === "evaluating") this._phase = { ...this._phase, postponed: true };
		decision.then((d) => {
			const lastSettlement = this._lastSettlement;
			try {
				apply(d);
			} catch (error) {
				Log.error("Navigation failed after its guards had settled", String(error), LOG_COMPONENT);
				if (this._lastSettlement === lastSettlement) {
					this._errorNavigation(error, attemptedHash, restoreHash);
				}
			}
		});
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
		// A guard that navigated itself has superseded the navigation it was guarding.
		if (attempt.generation !== this._parseGeneration) return;
		switch (decision.action) {
			case "allow":
				this._phase = { kind: "committing", route, origin: "parse" };
				this._commitNavigation(hash, route);
				break;
			case "block":
				this._blockNavigation(hash);
				break;
			case "redirect":
				this._startRedirectChain(decision.target, hash, bag, attempt);
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
	 * run for the correct (new) route rather than the old one. The settlement
	 * fires before parse as well, so the settlements of such nested navigations
	 * follow it.
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
		// A navigationSettled handler that navigated on has committed its own hash.
		if (this._currentHash === hash) super.parse(hash);
	}

	/**
	 * Evaluate guards on a redirect target and apply the resulting decision.
	 *
	 * Handles the unknown-route block, loop detection (visited-hash set +
	 * depth cap), sync/async guard evaluation, and recursive chaining when
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
		const targetRoute = this.getRoute(targetName);
		if (!targetRoute) {
			Log.warning(
				`Guard redirect target "${targetName}" is not a known route, treating as blocked`,
				undefined,
				LOG_COMPONENT,
			);
			this._blockNavigation(chain.attemptedHash, chain.restoreHash);
			return;
		}
		let targetHash: string;
		try {
			targetHash = targetRoute.getURL(typeof target === "string" ? {} : (target.parameters ?? {}));
		} catch (error) {
			Log.error(
				`Guard redirect target "${targetName}" has no valid hash, navigation failed`,
				String(error),
				LOG_COMPONENT,
			);
			this._errorNavigation(error, chain.attemptedHash, chain.restoreHash);
			return;
		}

		// Loop detection: visited set (exact hash match) + depth cap.
		if (chain.visited.has(targetHash)) {
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
		chain.visited.add(targetHash);

		// Build guard context for the redirect target.
		const routeInfo = this.getRouteInfoByHash(targetHash);
		const context: GuardContext = {
			toRoute: routeInfo?.name ?? "",
			toHash: targetHash,
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
			this._applyWhenDecided(
				decision,
				(d) => this._applyRedirectDecision(d, target, targetHash, chain),
				chain.attemptedHash,
				chain.restoreHash,
			);
			return;
		}

		this._applyRedirectDecision(decision, target, targetHash, chain);
	}

	/**
	 * Apply a guard decision within a redirect chain. For "allow", enter
	 * committing phase and delegate to navTo (which hits the existing bypass);
	 * if that does not reach parse(), commit the target directly.
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
		// Superseded while the hop's guards ran: by a newer navigation, or by a guard that navigated.
		if (chain.generation !== this._parseGeneration) return;
		switch (decision.action) {
			case "allow": {
				const targetName = typeof target === "string" ? target : target.route;
				this._phase = { kind: "committing", route: targetName, origin: "redirect" };
				try {
					if (typeof target === "string") {
						this.navTo(target, {}, {}, true);
					} else {
						this.navTo(target.route, target.parameters ?? {}, target.componentTargetInfo, true);
					}
					// parse() has not run: the hash is already the target, or changes later
					// (component targets). Commit manually, like the preflight does.
					if (this._phase.kind === "committing") {
						this._commitNavigation(targetHash, targetName);
					}
				} finally {
					if (this._phase.kind === "committing") {
						this._phase = IDLE;
					}
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
		bag: Map<string, unknown>,
		attempt: NavigationAttempt,
	): void {
		const visited = new Set<string>();
		visited.add(hash);
		this._redirect(target, {
			visited,
			attemptedHash: hash,
			restoreHash: attempt.restoreHash,
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
	 * to `_currentHash`. Preflight callers pass false unless they superseded
	 * a hash-change navigation: otherwise the hash was never changed.
	 */
	private _blockNavigation(attemptedHash?: string, restoreHash = true): void {
		this._phase = IDLE;
		this._settleUncommitted(
			{ status: NavigationOutcome.Blocked, route: this._currentRoute, hash: this._currentHash ?? "" },
			attemptedHash,
			restoreHash,
		);
	}

	/**
	 * Clear pending state and flush an Error settlement.
	 * Same structure as {@link _blockNavigation} but with `NavigationOutcome.Error`
	 * and the error that caused the failure.
	 */
	private _errorNavigation(error: unknown, attemptedHash?: string, restoreHash = true): void {
		this._phase = IDLE;
		this._settleUncommitted(
			{ status: NavigationOutcome.Error, route: this._currentRoute, hash: this._currentHash ?? "", error },
			attemptedHash,
			restoreHash,
		);
	}

	/**
	 * Settle a navigation that did not commit. With `restoreHash`, the hash it left in the URL
	 * is restored first, so that settlement handlers run on the final URL and a hash they set
	 * is not overwritten. The exception is a first navigation: nothing is committed yet, so the
	 * empty hash is restored after the settlement and parsed as a navigation of its own.
	 */
	private _settleUncommitted(
		result: NavigationResult,
		attemptedHash: string | undefined,
		restoreHash: boolean,
	): void {
		const loadDefaultRoute = restoreHash && this._currentHash === null && !!attemptedHash;
		if (restoreHash && !loadDefaultRoute) this._restoreHash(this._currentHash ?? "");
		this._flushSettlement(result);
		// Unless a handler navigated and committed in the meantime.
		if (loadDefaultRoute && this._currentHash === null) this._restoreHash("", false);
	}

	/**
	 * Restore the previous hash without creating a history entry.
	 * Assumes replaceHash fires hashChanged synchronously (validated by test).
	 * `_currentRoute` stays unchanged because the navigation never
	 * committed. The user remains on the same logical route.
	 *
	 * A hash that the hash changer already shows is not written again: the navigation never
	 * moved it. For a nested router, writing its empty hash would add its prefix to the browser
	 * hash (`shell` becomes `shell&/child/`).
	 */
	private _restoreHash(hash: string, suppressParse = true): void {
		const hashChanger = this.getHashChanger();
		if (hashChanger.getHash() === hash) return;
		this._suppressedHash = suppressParse ? hash : null;
		hashChanger.replaceHash(hash, HistoryDirection.Unknown);
		this._suppressedHash = null;
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
	 * Register one manifest guard. A registration error (`unknownRouteRegistration: "throw"`
	 * for an unknown route) is logged and skips the guard: no caller of the manifest config
	 * could catch it, and it must not keep the router from starting.
	 */
	private _registerManifestGuard(descriptor: GuardDescriptor, guardFn: GuardFn): void {
		try {
			this._registerGuardFromDescriptor(descriptor, guardFn);
		} catch (err: unknown) {
			Log.error(`guardRouter.guards: failed to register "${descriptor.modulePath}"`, String(err), LOG_COMPONENT);
		}
	}

	/**
	 * Route a parsed guard descriptor to the correct registration method.
	 */
	private _registerGuardFromDescriptor(descriptor: GuardDescriptor, guardFn: GuardFn): void {
		if (descriptor.route === "*") {
			this.addGuard(guardFn);
		} else if (descriptor.type === "leave") {
			this._handleUnknownRouteRegistration(descriptor.route, "addLeaveGuard");
			this._pipeline.addLeaveGuard(descriptor.route, guardFn);
		} else {
			this.addRouteGuard(descriptor.route, guardFn);
		}
	}

	/** Register the guards of each descriptor, loading their modules on first use (see `createLazyGuards`). */
	private _registerLazyGuards(descriptors: GuardDescriptor[]): void {
		for (const descriptor of descriptors) {
			for (const fn of createLazyGuards(descriptor)) this._registerManifestGuard(descriptor, fn);
		}
	}

	/**
	 * Clean up guards on destroy. Bumps generation to discard pending async results.
	 * A second call does nothing, like `sap.ui.core.routing.Router#destroy`.
	 *
	 * @since 1.0.1
	 */
	override destroy(): this {
		if (this._destroyed) return this;
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
