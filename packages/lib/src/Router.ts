import MobileRouter from "sap/m/routing/Router";
import Log from "sap/base/Log";
import coreLibrary from "sap/ui/core/library";
import HashChanger from "sap/ui/core/routing/HashChanger";
import History from "sap/ui/core/routing/History";
import type { HashChangerBase$HashChangedEvent } from "sap/ui/core/routing/HashChangerBase";
import type { ComponentTargetParameters, RouteInfo, Router$RouteMatchedEvent } from "sap/ui/core/routing/Router";
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
import GuardPipeline, { type GuardDecision, isPromiseLike, isPromiseResolver, LOG_COMPONENT } from "./GuardPipeline";
import { type GuardDescriptor, isRecord, parseGuardRouterConfig, type ResolvedGuardRouterOptions } from "./GuardConfig";
import { createLazyGuards, loadGuardModules } from "./GuardModules";
import { byRouteDepth, expandForNewRoute, expandToDescendants, type RoutePattern } from "./PatternTree";
import RouteMetaStore, { EMPTY_META } from "./RouteMeta";

const HistoryDirection = coreLibrary.routing.HistoryDirection;
type Direction = ReturnType<History["getDirection"]>;

/**
 * The router config as UI5 gets it: the caller's object without `guardRouter`. It is a view and
 * not a copy, because UIComponent adds `targetParent` (the ID of the root view) to its config
 * object after it has constructed the router, and the native router reads it from that object.
 */
function withoutGuardRouter(config: object): object {
	const hidden = (key: PropertyKey): boolean => key === "guardRouter";
	return new Proxy(config, {
		get: (target, key, receiver): unknown => (hidden(key) ? undefined : Reflect.get(target, key, receiver)),
		has: (target, key) => !hidden(key) && Reflect.has(target, key),
		ownKeys: (target) => Reflect.ownKeys(target).filter((key) => !hidden(key)),
		getOwnPropertyDescriptor: (target, key) =>
			hidden(key) ? undefined : Reflect.getOwnPropertyDescriptor(target, key),
	});
}

function isRouteGuardConfig(guard: GuardFn | RouteGuardConfig): guard is RouteGuardConfig {
	return typeof guard === "object" && guard !== null;
}

function hasComponentTargets(info: Record<string, ComponentTargetParameters> | undefined): boolean {
	return !!info && Object.keys(info).length > 0;
}

/** A step through the browser history (back, forward): how far it went, and the URL it arrived at. */
interface HistoryStep {
	readonly offset: number;
	readonly href: string;
}

/** The step through the browser history that brought the browser to the URL it shows, if a step did. */
let lastStep: HistoryStep | null = null;
/** The URL of a step that a router is taking back, until the browser reports the next URL change. */
let undoneHref: string | null = null;

// The Navigation API tells how far a step through the history went, before UI5 learns of the
// hash change. UI5's History only infers it, and wrongly once an entry lacks its state. Without
// the API (Firefox before 147, Safari before 26.2) no step is known and the entry is replaced.
window.navigation?.addEventListener("currententrychange", (event) => {
	const href = window.location.href;
	if (undoneHref !== href) undoneHref = null;
	const entry = window.navigation.currentEntry;
	if (entry && event.navigationType === "traverse") {
		lastStep = { offset: entry.index - event.from.index, href };
	} else if (lastStep?.href !== href) {
		// Not an entry whose state alone is replaced, as UI5's History does after a step.
		lastStep = null;
	}
});

/** What it takes to undo the hash change that an uncommitted navigation arrived with. */
interface HashChangeUndo {
	/** The hash of the root hash changer after the first change that this takes back. */
	readonly first: string;
	/**
	 * The hash of the root hash changer before that change, with the hashes of nested routers.
	 * The root hash changer reports it with the change, after the routers have parsed their part.
	 */
	fullHash: string | undefined;
	/** The hash of the root hash changer after the change. */
	readonly shown: string;
	/** Whether the router has started to put the URL back, and the hash change that does it is still to come. */
	started: boolean;
	/** The step through the browser history that the change was, if it was one. */
	readonly step: HistoryStep | null;
}

/** A manifest guard entry of a route, with the declared entry it stems from: itself, or the entry of an ancestor route. */
interface ManifestGuardDescriptor extends GuardDescriptor {
	readonly source: GuardDescriptor;
}

/** Snapshot of an in-flight navigation being evaluated by the guard pipeline. */
interface NavigationAttempt {
	readonly hash: string;
	readonly controller: AbortController;
	readonly generation: number;
	/** Whether the URL shows a hash that never committed, so that it must be restored unless this attempt moves it. */
	readonly restoreHash: boolean;
	/** How the browser got to the hash that started the navigation; `undefined` after `navTo()` or `parse()`. */
	readonly direction: Direction | undefined;
	/** Whether the `navTo()` call passed non-empty `componentTargetInfo`. */
	readonly hasComponentTargets?: boolean;
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
	/** The hash of the route: `parse()` commits the navigation when it receives this hash. */
	readonly hash: string;
	readonly origin: "preflight" | "redirect" | "parse";
	/** How the browser got to the history entry that the route replaces (see {@link RedirectChainContext.direction}). */
	readonly direction?: Direction;
	/** Whether the URL showed a hash that never committed when `navTo()` wrote the hash (see {@link NavigationAttempt.restoreHash}). */
	readonly restoreHash: boolean;
	/** What the root hash changer showed before `navTo()` wrote the hash: the write is undone with it. */
	readonly writtenOver?: string;
}

/**
 * An allowed navigation waits for UI5 to write its hash. With component targets UI5 does that
 * once the nested components are loaded, and never if one of them fails to load.
 */
interface PhaseAwaitingHash {
	readonly kind: "awaitingHash";
	/** The phase that commits the navigation when `parse()` receives its hash. */
	readonly commit: PhaseCommitting;
}

/** A navigation that did not commit waits for the URL to be back before it settles. */
interface PhaseRestoring {
	readonly kind: "restoring";
	readonly result: NavigationResult;
	/** Whether the previous hash is written once UI5 has reported the hash change to every router. */
	readonly awaitsReport?: true;
	/** What a redirect to the route that is shown still has to do once the navigation has settled. */
	readonly whenBack?: () => void;
}

type RouterPhase = PhaseIdle | PhaseEvaluating | PhaseCommitting | PhaseAwaitingHash | PhaseRestoring;

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
	/** Whether the target replaces the current history entry: as the `navTo()` call asked, always after a hash change. */
	readonly replace: boolean | undefined;
	/**
	 * How the browser got to the history entry that the target replaces, for the title history
	 * of UI5 (see {@link Router._alignTitleHistory}); `undefined` after `navTo()` or `parse()`.
	 */
	readonly direction: Direction | undefined;
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
 * - `navTo()` runs guards as a preflight check. A blocked navigation
 *   never changes the hash; a redirected one only writes its final target.
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
	/** How to undo the hash change of the pending navigation (see {@link _undoHashChange}). */
	private _undo: HashChangeUndo | null = null;
	/** The history traversal this router has already attributed to a hash change, so it is not reused. */
	private _consumedStep: HistoryStep | null = null;
	/** The hash that the hash changer of this router is reporting, until `parse()` receives it. */
	private _reportedHash: unknown = null;
	/** The hash that the hash changer of this router reported last, reports that are out of date aside. */
	private _lastReport: unknown = null;
	/** Whether the hash changer shows a later hash than the one it is reporting (see {@link _onHashReported}). */
	private _reportOutdated = false;
	/** The global hash changer that {@link _onRootHashChanged} is attached to, behind the listener of UI5 that informs the routers. */
	private _rootHashChanger: HashChanger | null = null;
	/** The route that was current when the router stopped: `initialize(true)` resumes it, as UI5 does. */
	private _stoppedRoute = "";
	private _settlementResolvers: ((result: NavigationResult) => void)[] = [];
	private _lastSettlement: NavigationResult | null = null;
	private _pendingGuardDescriptors: GuardDescriptor[];
	private _sourceDescriptors: ManifestGuardDescriptor[] = [];
	/** The manifest guards registered for a route, by which `addRoute()` places the guards a route inherits then. */
	private _manifestGuards: { descriptor: ManifestGuardDescriptor; fn: GuardFn }[] = [];
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
	/** Recorded by `addRoute()`, which the UI5 constructor calls before field setup; `declare` keeps field setup from resetting it. */
	declare private _routeNames: string[];
	/** Routes that also match when an earlier route has matched the hash (`greedy: true`). */
	declare private _greedyRouteNames: string[];
	private readonly _ownerComponent: UIComponent | undefined;

	constructor(routes?: object | object[], config?: GuardRouterConfig, owner?: UIComponent, targetsConfig?: object);
	constructor(
		routes?: object | object[],
		config?: GuardRouterConfig,
		owner?: UIComponent,
		...rest: [targetsConfig?: object]
	) {
		const isRecordConfig = isRecord(config);
		const guardRouter = isRecordConfig ? config.guardRouter : undefined;
		// UI5 passes more than its types declare: after the targets config comes the
		// hash changer of a component that is loaded as a routing target.
		super(routes, isRecordConfig ? withoutGuardRouter(config) : config, owner, ...rest);
		this._ownerComponent = owner;
		// A config without routes has made no addRoute() call.
		this._routeNames ??= [];
		this._greedyRouteNames ??= [];
		this._mirrorMatchingProcess();
		let componentNamespace = "";
		const appConfig: unknown = owner?.getManifestEntry("sap.app");
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

		// Fire-and-forget preload hint: a module cached by initialize()
		// needs no async load on navigation (see _registerLazyGuards).
		// Block mode loads modules itself in initialize().
		if (this._options.guardLoading === "lazy") {
			const uniquePaths = [...new Set(this._pendingGuardDescriptors.map((d) => d.modulePath))];
			if (uniquePaths.length > 0) {
				// A failed preload is reported when the guard runs: its lazy load warns
				// and the navigation settles as Error.
				sap.ui.require(uniquePaths, undefined, () => {});
			}
		}
	}

	/**
	 * Report a navigation that waits for async guards as a route match in progress, through the
	 * UI5-private member `_bMatchingProcessStarted` of `sap.ui.core.routing.Router`. UI5 reads it
	 * to tell whether the router of a nested component is still matching; without this, a parent
	 * route would count the component as displayed before its first route matched. The router does
	 * not write the member: it replaces it with an accessor that keeps what UI5 writes in
	 * {@link _nativeMatching} and also reads `true` while a navigation is postponed.
	 *
	 * See docs/reference/architecture.md ("UI5 Internals the Router Relies On") for the UI5 code this
	 * relies on, and docs/reference/upstream-parity.md for the tests that pin it.
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
	 * remember a Promise resolve function ({@link isPromiseResolver}) that is subscribed while the
	 * router is not initialized or a match is in progress: that is how a UI5 component target
	 * waits for this router. UI5 relies on a match always ending in `routeMatched`, which a
	 * navigation that guards block, fail or cancel never fires, so {@link _settleMatchWaiters}
	 * resolves the Promise then. Application code that subscribes a Promise resolve function under
	 * the same condition is treated alike.
	 *
	 * See docs/reference/architecture.md ("UI5 Internals the Router Relies On") for the UI5 code this
	 * relies on, and docs/reference/upstream-parity.md for the tests that pin it.
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
	override attachRouteMatched(
		oData: object,
		fnFunction: (evt: Router$RouteMatchedEvent) => void,
		oListener?: object,
	): this {
		if (isPromiseResolver(oData) && (!this.isInitialized() || this._isMatching())) {
			this._matchWaiters.push(oData);
		}
		// The arguments go on as received: EventProvider#attachEvent tells the two call forms apart.
		return super.attachRouteMatched(oData, fnFunction, oListener);
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
	 * @param bIgnoreInitialHash - Whether the current hash is left unparsed, as in the native router (since 1.7.0).
	 * @override sap.ui.core.routing.Router#initialize
	 * @since 1.0.1
	 */
	override initialize(bIgnoreInitialHash?: boolean): this {
		if (this._destroyed) {
			Log.warning("initialize: router is destroyed, ignoring", undefined, LOG_COMPONENT);
			return this;
		}
		if (this._blockLoad) {
			if (!this._blockLoad.start) {
				this._blockLoad.start = true;
				this._blockLoad.ignoreInitialHash = bIgnoreInitialHash;
			}
			return this;
		}
		if (this._pendingGuardDescriptors.length === 0) {
			return this._start(bIgnoreInitialHash);
		}

		const descriptors = this._pendingGuardDescriptors.map((source) => ({ ...source, source }));
		this._pendingGuardDescriptors = [];

		if (this._options.guardLoading === "lazy") {
			const expandedDescriptors =
				this._options.inheritance === "pattern-tree"
					? expandToDescendants(descriptors, this._collectRoutePatterns())
					: descriptors;
			const rejected = this._registerLazyGuards(expandedDescriptors);
			this._sourceDescriptors = descriptors.filter((d) => !rejected.has(d.source));
			return this._start(bIgnoreInitialHash);
		}

		// "block" mode: load declared modules once, then expand with the routes known now
		// (including any added via addRoute() while loading), register in declaration order
		// and initialize. Load and registration failures are logged per module and never
		// reject. A router destroyed while modules load stays destroyed.
		const blockLoad = { start: true, ignoreInitialHash: bIgnoreInitialHash };
		this._blockLoad = blockLoad;
		void loadGuardModules(descriptors).then((results) => {
			this._blockLoad = null;
			if (this._destroyed) return;
			const guardsBySource = new Map(results.map(({ descriptor, guards }) => [descriptor.source, guards]));
			const loadedDescriptors = descriptors.filter((d) => (guardsBySource.get(d.source)?.length ?? 0) > 0);
			const expandedDescriptors =
				this._options.inheritance === "pattern-tree"
					? expandToDescendants(loadedDescriptors, this._collectRoutePatterns())
					: loadedDescriptors;
			const rejected = new Set<GuardDescriptor>();
			for (const descriptor of expandedDescriptors) {
				for (const fn of guardsBySource.get(descriptor.source) ?? []) {
					if (!this._registerManifestGuard(descriptor, fn)) rejected.add(descriptor.source);
				}
			}
			this._sourceDescriptors = loadedDescriptors.filter((d) => !rejected.has(d.source));
			if (blockLoad.start) this._start(blockLoad.ignoreInitialHash);
		});
		return this;
	}

	/**
	 * Start the native router. With `ignoreInitialHash` it parses nothing and resumes the route
	 * that was displayed when the router stopped. That route is the current one again, on the hash
	 * that the URL shows now, so that its leave guards run and a blocked hash change returns to it.
	 */
	private _start(ignoreInitialHash?: boolean): this {
		// UI5 only warns about a router that is initialized already.
		const starting = !this.isInitialized();
		if (starting) {
			// Before the listener of UI5 that calls parse(), which initialize() attaches.
			this.getHashChanger().attachEvent("hashChanged", this._onHashReported, this);
			// After the listener of UI5 that informs the routers, which is attached with the hash
			// changer of the first router: UI5 has reported a hash change to every router when
			// this one runs.
			this._rootHashChanger = HashChanger.getInstance();
			this._rootHashChanger.attachEvent("hashChanged", this._onRootHashChanged, this);
		}
		super.initialize(ignoreInitialHash);
		if (starting && ignoreInitialHash) {
			// UI5 has reset the hash of the hash changer if a target was displayed without a route.
			const shownHash: string | undefined = this.getHashChanger().getHash();
			this._currentRoute = this._stoppedRoute;
			this._currentHash = shownHash ?? null;
		}
		return this;
	}

	/**
	 * The hash changer of this router reports a hash change: `parse()` is called with it next.
	 *
	 * The report is out of date if the hash changer shows a later hash by now, one that it has
	 * reported to this router already. That happens to a router that shares its hash changer, as
	 * the routers of all components that are not routing targets do: a router that is informed
	 * first redirects the hash, UI5 reports the target to every router, and only then the hash
	 * that was redirected to the routers that are informed later. A hash changer that reports
	 * while a parent router collects the hashes of a navigation shows no hash at all.
	 */
	private _onHashReported(event: HashChangerBase$HashChangedEvent): void {
		// A string, which the UI5 types declare as an object.
		const newHash: unknown = event.getParameter("newHash");
		const shown: unknown = this.getHashChanger().getHash();
		this._reportedHash = newHash;
		this._reportOutdated = shown !== newHash && shown === this._lastReport;
		if (!this._reportOutdated) this._lastReport = newHash;
	}

	/**
	 * UI5 has reported a hash change to every router. The event tells what the URL showed before
	 * the change, which is what undoes it. A snapshot of the URL taken at any other time would not
	 * do: the URL also changes without an event, as when the Fiori launchpad puts it back after
	 * a cross-app navigation that the user cancelled. A navigation that waited for this to put
	 * the URL back does so now (see {@link _undoHashChange}).
	 */
	private _onRootHashChanged(event: HashChangerBase$HashChangedEvent): void {
		// A string, which the UI5 types declare as an object.
		const newHash: unknown = event.getParameter("newHash");
		// Only the first hash change that the page reports has no previous hash.
		const oldHash = event.getParameter("oldHash") ?? "";
		const hashChanger = HashChanger.getInstance();
		if (hashChanger === this._rootHashChanger) {
			this._completeUndo(newHash, oldHash);
			return;
		}
		// The global hash changer was replaced (HashChanger.replaceHashChanger(), as the shell of
		// the Fiori launchpad does). UI5 has moved this listener to the new one, in front of its
		// listener that informs the routers. From the next hash change on it runs behind again;
		// for this one, the routers are informed once this listener has returned.
		hashChanger.detachEvent("hashChanged", this._onRootHashChanged, this);
		hashChanger.attachEvent("hashChanged", this._onRootHashChanged, this);
		this._rootHashChanger = hashChanger;
		queueMicrotask(() => this._completeUndo(newHash, oldHash));
	}

	/**
	 * Tell the undo of the pending navigation what the URL showed before the hash change
	 * `newHash`, and put the URL back if the navigation waited for that.
	 */
	private _completeUndo(newHash: unknown, oldHash: string): void {
		const undo = this._undo;
		if (!undo || undo.first !== newHash) return;
		undo.fullHash ??= oldHash;
		if (this._phase.kind === "restoring" && this._phase.awaitsReport) this._replaceFullHash(undo.fullHash);
	}

	/**
	 * Add a route dynamically and integrate it into pattern-tree inheritance.
	 *
	 * Appends the route name to the internal route list so that
	 * `_collectRoutePatterns()` includes it in subsequent inheritance
	 * lookups, clears the metadata cache, and registers any inherited
	 * manifest guards when `inheritance` is `"pattern-tree"`: on every
	 * route, ancestor guards still run before descendant guards.
	 *
	 * @param oConfig - Route configuration object as defined by `sap.ui.core.routing.Route`.
	 * @param oParent - Optional parent route, forwarded to the parent `addRoute`.
	 * @override sap.ui.core.routing.Router#addRoute
	 * @since 1.6.0
	 */
	override addRoute(oConfig: $RouteSettings, oParent?: Route): void {
		super.addRoute(oConfig, oParent);

		const name = oConfig.name;
		this._routeNames ??= [];
		this._greedyRouteNames ??= [];
		if (this._routeNames.includes(name)) return;

		this._routeNames.push(name);
		if (oConfig.greedy) this._greedyRouteNames.push(name);
		// The UI5 constructor adds the routes of the config before this constructor sets up the rest.
		if (!this._meta) return;
		this._meta.invalidate();

		if (this._options.inheritance !== "pattern-tree") return;

		const patterns = this._collectRoutePatterns();
		const declared = byRouteDepth(this._sourceDescriptors, new Map(patterns.map((r) => [r.name, r.pattern])));
		const rankOf = (descriptor: ManifestGuardDescriptor): number =>
			declared.findIndex((entry) => entry.source === descriptor.source);

		// Always use lazy registration: if the module was loaded during
		// initialize() (block mode), the sync cache probe succeeds immediately.
		// This avoids an async gap between addRoute() and the first navigation.
		for (const descriptor of expandForNewRoute(this._sourceDescriptors, name, patterns)) {
			// Ancestor guards run first: the new guards go before the manifest guards of the route
			// that stem from an entry of a deeper route, or from a later entry of the same depth.
			const rank = rankOf(descriptor);
			const next = this._manifestGuards
				.filter(
					(guard) =>
						guard.descriptor.route === descriptor.route &&
						guard.descriptor.type === descriptor.type &&
						rankOf(guard.descriptor) > rank,
				)
				.toSorted((a, b) => rankOf(a.descriptor) - rankOf(b.descriptor))[0];
			for (const fn of createLazyGuards(descriptor)) this._registerManifestGuard(descriptor, fn, next?.fn);
		}
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
			const { beforeEnter, beforeLeave } = guard;
			if (beforeEnter === undefined && beforeLeave === undefined) {
				Log.info("addRouteGuard: config has no beforeEnter or beforeLeave", routeName, LOG_COMPONENT);
				return this;
			}
			// As for a guard function: the route is checked only when something is registered.
			const enter = beforeEnter !== undefined && this._isFn(beforeEnter, "addRouteGuard", routeName);
			const leave = beforeLeave !== undefined && this._isFn(beforeLeave, "addRouteGuard", routeName);
			if (!enter && !leave) return this;
			this._handleUnknownRouteRegistration(routeName, "addRouteGuard");
			if (enter) this._pipeline.addEnterGuard(routeName, beforeEnter);
			if (leave) this._pipeline.addLeaveGuard(routeName, beforeLeave);
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
	 * until a new navigation settles, or `initialize(true)` resumes the route.
	 *
	 * @returns Promise that resolves with a {@link NavigationResult} once the pipeline settles.
	 * @since 1.2.0
	 */
	navigationSettled(): Promise<NavigationResult> {
		if (this._phase.kind === "idle" || this._phase.kind === "committing") {
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
	 * navigation outcome without re-registration. It does not fire for the
	 * navigation that `destroy()` cancels.
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
	attachNavigationSettled(
		oData: object,
		fnFunction: (evt: Router$NavigationSettledEvent) => void,
		oListener?: object,
	): this {
		// The arguments go on as received: EventProvider#attachEvent tells the two call forms apart.
		return this.attachEvent("navigationSettled", oData, fnFunction, oListener);
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
		this.detachEvent("navigationSettled", fnFunction, oListener);
		return this;
	}

	/**
	 * Drain all settlement resolvers with the given result and fire
	 * the `navigationSettled` event.
	 */
	private _flushSettlement(result: NavigationResult): void {
		this._lastSettlement = result;
		Log.debug(`Navigation settled: ${result.status}`, result.hash, LOG_COMPONENT);
		// After the call that settled: by then a commit has reached super.parse(), and a navigation
		// that supersedes this one has started.
		queueMicrotask(() => this._settleMatchWaiters());
		const resolvers = this._settlementResolvers;
		this._settlementResolvers = [];
		for (const resolve of resolvers) {
			resolve(result);
		}
		// No handler runs while destroy() tears the router down; the native destroy() fires no event either.
		if (this._destroyed) return;
		try {
			this.fireEvent("navigationSettled", result);
		} catch (error) {
			// A handler must not keep the router from finishing the navigation it reports.
			Log.error("A navigationSettled handler threw", String(error), LOG_COMPONENT);
		}
	}

	/**
	 * Navigate to a route with preflight guard evaluation.
	 *
	 * For programmatic navigation, guards run BEFORE the hash changes.
	 * This prevents history pollution: blocked navigations never push a
	 * history entry, and redirected navigations go directly to the final
	 * target, which is written the way this call asked for (`bReplace`).
	 *
	 * A `navTo()` to the committed hash changes no route of this router, so
	 * no guard runs: any pending navigation is cancelled and the call goes
	 * to the native `navTo()`, which sets or resets the hashes of nested
	 * components (`componentTargetInfo`). If the target matches the
	 * in-flight attempt's hash, the in-flight preflight continues undisturbed.
	 *
	 * When all guards are synchronous, the decision and the resulting
	 * hash change happen in the same tick. When any guard returns a
	 * Promise, `navTo()` returns `this` immediately and defers the
	 * hash change to when the guard resolves.
	 *
	 * Assumes `super.navTo()` calls `HashChanger.setHash()` which fires
	 * `hashChanged` synchronously, causing `parse()` to re-enter in the
	 * same call stack (validated by test). If the hash changer refuses the
	 * hash change, as the Fiori launchpad's navigation filter does when its
	 * dirty-state check stops it, nothing is committed and the navigation
	 * settles as `Blocked`.
	 *
	 * With component targets (`componentTargetInfo`) UI5 writes the hash
	 * later, once the nested components are loaded. The navigation commits
	 * and settles when `parse()` receives that hash. Until then it is
	 * pending: a navigation that supersedes it, `stop()` or `destroy()`
	 * settles it as `Cancelled`. That also ends a navigation whose hash UI5
	 * never writes, because a nested component failed to load or the router
	 * is not async.
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
		// The guards are gone: code that awaited navigationSettled() may still call navTo().
		if (this._destroyed) {
			Log.warning("navTo: router is destroyed, ignoring", routeName, LOG_COMPONENT);
			return this;
		}
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
		const routeInfo = this._matchRoute(targetHash);
		const toRoute = routeInfo.name;

		// Same hash: no route of this router changes, so there is nothing to guard. Cancel any
		// pending navigation and navigate natively: UI5 still sets the hashes of nested
		// components (componentTargetInfo), or resets them when none are given.
		if (targetHash === this._currentHash) {
			const navigate = (): void => {
				if (this._destroyed || !this.isInitialized()) return;
				// A navigationSettled handler of the cancelled navigation may have navigated on.
				const shownHash: string | undefined = this.getHashChanger().getHash();
				if (shownHash === undefined || shownHash === targetHash) {
					// If UI5 has reset the hash of the hash changer, after a target was displayed without
					// a route, it reports the hash again, and parse() lets the route match again.
					super.navTo(routeName, parameters, componentTargetInfo, replace);
				}
			};
			if (!this._cancelPendingNavigation(true, navigate)) navigate();
			return this;
		}

		const skipGuards = guardOptions?.skipGuards === true || this._options.navToPreflight === "bypass";
		const withComponentTargets = hasComponentTargets(componentTargetInfo);

		// Pending-hash dedup: if an async preflight for this exact hash is
		// already running, don't cancel and restart it unless component targets
		// differ or are involved. A navigation that skips the guards does not wait for them.
		if (
			!skipGuards &&
			!withComponentTargets &&
			this._phase.kind === "evaluating" &&
			!this._phase.attempt.hasComponentTargets &&
			targetHash === this._phase.attempt.hash
		) {
			return this;
		}

		// parse() evaluates the guards once the hash has changed. It supersedes a pending
		// navigation then, and undoes the hash change of that navigation with its own.
		if (!skipGuards && this._options.navToPreflight === "off") {
			super.navTo(routeName, parameters, componentTargetInfo, replace);
			return this;
		}

		// Cancel any pending navigation (including previous async preflight).
		// A superseded hash-change navigation leaves its hash in the URL: restore it
		// unless this navigation moves the URL.
		const restoreHash = this._pendingRestoresHash();
		this._cancelPendingNavigation();
		// A navigationSettled handler of the cancelled navigation may have stopped or destroyed the router.
		if (this._destroyed || !this.isInitialized()) return this;

		if (skipGuards) {
			this._navigateAllowed(
				routeName,
				parameters,
				componentTargetInfo,
				replace,
				targetHash,
				toRoute,
				restoreHash,
			);
			return this;
		}

		const attempt = this._startAttempt(targetHash, restoreHash, undefined, withComponentTargets);
		const { generation } = attempt;

		const context = this._createGuardContext(routeInfo, targetHash, attempt.controller.signal);

		const decision = this._evaluateGuards(context);

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
	 * Navigate to a `navTo()` target that needs no guards (allowed or bypassed) and commit it,
	 * or block it if the hash change was refused (see {@link _commitAfterNavTo}).
	 */
	private _navigateAllowed(
		routeName: string,
		parameters: object | undefined,
		componentTargetInfo: Record<string, ComponentTargetParameters> | undefined,
		bReplace: boolean | undefined,
		targetHash: string,
		toRoute: string,
		restoreHash: boolean,
	): void {
		this._phase = {
			kind: "committing",
			route: toRoute,
			hash: targetHash,
			origin: "preflight",
			restoreHash,
			writtenOver: HashChanger.getInstance().getHash(),
		};
		try {
			super.navTo(routeName, parameters, componentTargetInfo, bReplace);
			if (!this._commitAfterNavTo(componentTargetInfo)) {
				this._blockNavigation(targetHash, restoreHash);
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
				this._navigateAllowed(
					routeName,
					parameters,
					componentTargetInfo,
					bReplace,
					targetHash,
					toRoute,
					attempt.restoreHash,
				);
				break;
			case "block":
				this._blockNavigation(targetHash, attempt.restoreHash);
				break;
			case "redirect":
				this._startRedirectChain(decision.target, targetHash, bag, attempt, bReplace);
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
		const reported = this._reportedHash === newHash;
		this._reportedHash = null;
		// The URL shows a later hash, which this router has parsed.
		if (reported && this._reportOutdated) return;
		// The hash that _restoreHash() is writing.
		if (newHash === this._suppressedHash) return;

		const undo = this._undo;
		if (undo?.started && undo.fullHash === HashChanger.getInstance().getHash()) {
			// The URL is back where the router has put it (see _undoHashChange), so nothing is
			// evaluated. What the hash changer reports now is the hash of the route that is shown.
			this._undo = null;
			this._currentHash = newHash;
			this._finishRestore(newHash);
			return;
		}

		const phase = this._phase;
		const commit = phase.kind === "awaitingHash" ? phase.commit : phase.kind === "committing" ? phase : null;
		if (commit?.hash === newHash) {
			this._phase = commit;
			this._commitNavigation(newHash, commit.route);
			return;
		}

		const currentHash = this._currentHash;
		if (newHash === currentHash) {
			if (this._pendingRestoresHash()) {
				// The URL is back on the committed hash, whose route was never left. That ends the
				// navigation that had moved it away; one that waits for UI5 to write its hash goes on.
				if (this._phase.kind === "evaluating") this._cancelPendingNavigation();
				else this._undo = null;
			} else {
				// The committed hash is reported again, and its route matches again as it does
				// natively: UI5 has written the hash of a navigation with component targets, or has
				// reset the hash of the hash changer after a target was displayed without a route,
				// or parse() was called directly.
				super.parse(newHash);
			}
			return;
		}

		const routeInfo = this._matchRoute(newHash);
		const toRoute = routeInfo.name;

		// A pending navigation that has moved the URL as well leaves this one to undo both changes.
		const pendingUndo = this._pendingRestoresHash() ? undo : null;
		// The router is putting the URL back and gets another hash: that one is not undone as a
		// whole, so that an undo cannot cause the next one.
		const undoing = this._phase.kind === "restoring";
		this._cancelPendingNavigation();
		// A navigationSettled handler that navigated on, stopped, or destroyed the router supersedes this parse.
		if (this._destroyed || this.isStopped() || this._currentHash !== currentHash) return;
		this._undo = undoing ? null : this._describeUndo(pendingUndo, reported);
		// Another listener of the hash change that navTo() caused has replaced the hash, before
		// this router received it: undoing this hash change undoes the one of navTo() as well.
		if (this._undo && commit === phase && !commit.restoreHash) this._undo.fullHash = commit.writtenOver;

		const direction = reported ? History.getInstance().getDirection() : undefined;
		const attempt = this._startAttempt(newHash, true, direction);
		const { generation } = attempt;

		const context = this._createGuardContext(routeInfo, newHash, attempt.controller.signal);

		const decision = this._evaluateGuards(context);

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
	 * matching the native `sap.m.routing.Router` behavior. The route is
	 * kept for `initialize(true)`, which resumes it instead.
	 *
	 * @override sap.ui.core.routing.Router#stop
	 * @since 1.0.1
	 */
	override stop(): this {
		if (this._blockLoad) this._blockLoad.start = false;
		// Cancel first so in-flight navigationSettled() resolvers receive the
		// Cancelled result before _lastSettlement is cleared below.
		this._cancelPendingNavigation();
		if (this._matchWaiters.length > 0) queueMicrotask(() => this._settleMatchWaiters());
		// A hash change that was to put the URL back does not reach a stopped router.
		this._undo = null;
		this._reportedHash = null;
		this._lastReport = null;
		this._reportOutdated = false;
		// Nothing is committed on a router that is stopped already, or stops before its first navigation settles.
		if (this._currentHash !== null) this._stoppedRoute = this._currentRoute;
		this._currentRoute = "";
		this._currentHash = null;
		this._lastSettlement = null;
		this._detachHashListeners();
		super.stop();
		return this;
	}

	/** Detach what {@link _start} has attached. */
	private _detachHashListeners(): void {
		this.getHashChanger().detachEvent("hashChanged", this._onHashReported, this);
		// UI5 moves the listener along when the global hash changer is replaced.
		HashChanger.getInstance().detachEvent("hashChanged", this._onRootHashChanged, this);
		this._rootHashChanger = null;
	}

	/**
	 * Invalidate any in-flight async guard work. Bumps the generation counter
	 * so pending `.then()` callbacks see they are stale, aborts the signal,
	 * and transitions to idle. A navigation that waits for its guards or for
	 * its hash settles as `Cancelled`. With `restoreHash`, a cancelled hash-change
	 * navigation also gets its hash restored: `navTo()` passes it when the
	 * call itself will not move the URL.
	 */
	private _cancelPendingNavigation(restoreHash = false, whenBack?: () => void): boolean {
		++this._parseGeneration;
		const phase = this._phase;
		const pendingRestoresHash = this._pendingRestoresHash();
		// Idle before the settlement fires, so that a handler can navigate.
		this._phase = IDLE;
		// A navigation that is committing ends with the navigation that supersedes it.
		if (phase.kind === "idle" || phase.kind === "committing") return false;
		if (phase.kind === "restoring") {
			// A navigation that waits for the URL to be back has ended already: it settles as it ended.
			this._flushSettlement(phase.result);
			return false;
		}
		if (phase.kind === "evaluating") phase.attempt.controller.abort();
		this._settleUncommitted(
			{ status: NavigationOutcome.Cancelled, route: this._currentRoute, hash: this._currentHash ?? "" },
			phase.kind === "evaluating" ? phase.attempt.hash : phase.commit.hash,
			restoreHash && pendingRestoresHash,
			whenBack,
		);
		return true;
	}

	/**
	 * Whether the pending navigation leaves a hash in the URL that never committed, the one of a
	 * hash-change navigation: it must be restored unless a navigation moves the URL.
	 */
	private _pendingRestoresHash(): boolean {
		const phase = this._phase;
		if (phase.kind === "evaluating") return phase.attempt.restoreHash;
		if (phase.kind === "committing") return phase.restoreHash;
		return phase.kind === "awaitingHash" && phase.commit.restoreHash;
	}

	/**
	 * Start evaluating a navigation. Its generation is its own, so the result of any earlier
	 * attempt is stale: also one that a navigationSettled handler started while this
	 * navigation cancelled its predecessor, which is aborted here without a settlement.
	 */
	private _startAttempt(
		hash: string,
		restoreHash: boolean,
		direction?: Direction,
		withComponentTargets = false,
	): NavigationAttempt {
		if (this._phase.kind === "evaluating") this._phase.attempt.controller.abort();
		const attempt: NavigationAttempt = {
			hash,
			controller: new AbortController(),
			generation: ++this._parseGeneration,
			restoreHash,
			direction,
			hasComponentTargets: withComponentTargets,
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
				Log.error(
					"Navigation failed after its guards had settled",
					error instanceof Error ? error : String(error),
					LOG_COMPONENT,
				);
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
				this._phase = { kind: "committing", route, hash, origin: "parse", restoreHash: false };
				this._commitNavigation(hash, route);
				break;
			case "block":
				this._blockNavigation(hash);
				break;
			case "redirect":
				// The hash that redirects has reached the browser: the target takes its history entry.
				this._startRedirectChain(decision.target, hash, bag, attempt, true);
				break;
			case "error":
				this._errorNavigation(decision.error, hash);
				break;
		}
	}

	/**
	 * Leave the title history of UI5 (`getTitleHistory()`) as after the native equivalent of a
	 * redirected hash change: the hash change, then `navTo(target, ..., true)`. The route of the
	 * hash change never matched, so UI5 has not handled its title:
	 * - A new entry or a step forward would have added a title, which the title of the target
	 *   replaces: UI5 must not remove the title of the route before it.
	 * - A step back would have removed the title of the route that was left, so that the target
	 *   replaces the title of the entry the step arrived at: UI5 removes the first for the
	 *   replaced hash, the router removes the second, under the condition of UI5 for a step back.
	 */
	private _alignTitleHistory(direction: Direction | undefined): void {
		if (direction === HistoryDirection.NewEntry || direction === HistoryDirection.Forwards) {
			Reflect.set(this, "_bLastHashReplaced", false);
		} else if (direction === HistoryDirection.Backwards) {
			const titles: unknown[] = this.getTitleHistory();
			const left = titles.at(-1);
			const replaced = titles.at(-2);
			if (isRecord(left) && isRecord(replaced) && !left.isHome && left.title !== replaced.title) {
				titles.splice(-2, 1);
			}
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
		if (this._phase.kind === "committing") this._alignTitleHistory(this._phase.direction);
		// The URL has moved on: a hash change that was to put it back is not awaited any more.
		this._undo = null;
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
		// A navigationSettled handler that navigated on, stopped, or destroyed the router supersedes super.parse().
		if (this._destroyed || this.isStopped() || this._currentHash !== hash) return;
		super.parse(hash);
	}

	/**
	 * Commit the navigation of the committing phase after `super.navTo()` unless `parse()` has
	 * committed it. Returns whether the navigation takes place:
	 * - The hash changer shows the target hash: the route matches here.
	 * - UI5 writes the hash later, which it does with component targets, once the nested
	 *   components are loaded. The navigation waits for it: it commits, and the route matches,
	 *   when `parse()` gets that hash, as the route does natively. Committed here, the router
	 *   would be on a route that UI5 does not display if the hash is never written.
	 * - Otherwise the hash changer has refused the hash change, as the Fiori launchpad does while
	 *   it asks the user about unsaved data. Nothing changed, so nothing is committed.
	 */
	private _commitAfterNavTo(componentTargetInfo: Record<string, ComponentTargetParameters> | undefined): boolean {
		const phase = this._phase;
		if (phase.kind !== "committing") return true;
		if (this.getHashChanger().getHash() === phase.hash) {
			this._commitNavigation(phase.hash, phase.route);
			return true;
		}
		if (!hasComponentTargets(componentTargetInfo)) return false;
		this._phase = { kind: "awaitingHash", commit: phase };
		return true;
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

		const routeInfo = this._matchRoute(targetHash);
		const toRoute = routeInfo.name;
		const context = this._createGuardContext(routeInfo, targetHash, chain.signal, chain);

		const decision = this._evaluateGuards(context, true);

		if (isPromiseLike(decision)) {
			this._applyWhenDecided(
				decision,
				(d) => this._applyRedirectDecision(d, target, targetHash, toRoute, chain),
				chain.attemptedHash,
				chain.restoreHash,
			);
			return;
		}

		this._applyRedirectDecision(decision, target, targetHash, toRoute, chain);
	}

	/**
	 * Apply a guard decision within a redirect chain. For "allow", enter
	 * committing phase and delegate to navTo (which hits the existing bypass);
	 * if that does not reach parse(), commit the target directly. A target that
	 * is displayed already settles the navigation without a commit.
	 * For "block", block the entire chain. For "redirect", recurse.
	 *
	 * @param decision - Normalized guard pipeline result for this hop.
	 * @param target - The redirect target (route name or {@link GuardRedirect}).
	 * @param targetHash - Resolved hash for the redirect target.
	 * @param toRoute - Route that matches the hash, as in the hop's guard context: the route UI5 displays.
	 * @param chain - Shared redirect chain context with visited set, signals, etc.
	 */
	private _applyRedirectDecision(
		decision: GuardDecision,
		target: string | GuardRedirect,
		targetHash: string,
		toRoute: string,
		chain: RedirectChainContext,
	): void {
		// Superseded while the hop's guards ran: by a newer navigation, or by a guard that navigated.
		if (chain.generation !== this._parseGeneration) return;
		switch (decision.action) {
			case "allow": {
				const componentTargetInfo = typeof target === "string" ? undefined : target.componentTargetInfo;
				if (targetHash === this._currentHash) {
					// The target is displayed already, so no route matches again, as for a navTo() to
					// the committed hash: the URL is put back and UI5 sets the hashes of nested components.
					this._phase = IDLE;
					this._settleUncommitted(
						{ status: NavigationOutcome.Redirected, route: this._currentRoute, hash: targetHash },
						chain.attemptedHash,
						chain.restoreHash,
						typeof target !== "string" && componentTargetInfo
							? () => {
									// Unless a settlement handler has moved the URL on.
									if (this.getHashChanger().getHash() !== targetHash) return;
									super.navTo(
										target.route,
										target.parameters ?? {},
										componentTargetInfo,
										chain.replace,
									);
								}
							: undefined,
					);
					break;
				}
				this._phase = {
					kind: "committing",
					route: toRoute,
					hash: targetHash,
					origin: "redirect",
					direction: chain.direction,
					restoreHash: chain.restoreHash,
					writtenOver: HashChanger.getInstance().getHash(),
				};
				try {
					// Writing the hash the URL already shows changes nothing, except that a nested
					// router would add its prefix for an empty hash (see _restoreHash).
					const hashShown = this.getHashChanger().getHash() === targetHash;
					if (typeof target === "string") {
						if (!hashShown) this.navTo(target, {}, {}, chain.replace);
					} else if (!hashShown || componentTargetInfo) {
						this.navTo(target.route, target.parameters ?? {}, componentTargetInfo, chain.replace);
					}
					if (!this._commitAfterNavTo(componentTargetInfo)) {
						this._blockNavigation(chain.attemptedHash, chain.restoreHash);
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

	/** The route that matches a hash, and its arguments. For a hash that no route matches: no route (`""`), no arguments. */
	private _matchRoute(hash: string): RouteInfo {
		const info = this.getRouteInfoByHash(hash);
		return { name: info?.name ?? "", arguments: info?.arguments ?? {} };
	}

	/**
	 * The greedy routes that match `hash` in addition to `firstMatch`, the first route that
	 * matches it. UI5 matches them as well and fires their events.
	 */
	private _greedyMatches(hash: string, firstMatch: string): string[] {
		return this._greedyRouteNames.filter((name) => name !== firstMatch && this.getRoute(name)?.match(hash));
	}

	/**
	 * Evaluate the guards of a navigation: of the routes in its context, and of the greedy routes
	 * that are left and entered with them. A hop of a redirect chain leaves no route.
	 */
	private _evaluateGuards(context: GuardContext, redirectHop = false): GuardDecision | Promise<GuardDecision> {
		return this._pipeline.evaluate(context, {
			skipLeaveGuards: redirectHop,
			alsoLeaving: this._greedyMatches(context.fromHash, context.fromRoute),
			alsoEntering: this._greedyMatches(context.toHash, context.toRoute),
		});
	}

	/**
	 * Build the guard context of a navigation to `routeInfo`. A hop of a redirect chain passes the
	 * chain, whose source route, source hash and bag are those of the original navigation.
	 */
	private _createGuardContext(
		routeInfo: RouteInfo,
		toHash: string,
		signal: AbortSignal,
		chain?: RedirectChainContext,
	): GuardContext {
		const fromRoute = chain ? chain.fromRoute : this._currentRoute;
		return {
			toRoute: routeInfo.name,
			toHash,
			toArguments: routeInfo.arguments,
			fromRoute,
			fromHash: chain ? chain.fromHash : (this._currentHash ?? ""),
			signal,
			bag: chain ? chain.bag : new Map<string, unknown>(),
			toMeta: this.getRouteMeta(routeInfo.name),
			fromMeta: this.getRouteMeta(fromRoute),
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
		replace: boolean | undefined,
	): void {
		const visited = new Set<string>();
		visited.add(hash);
		this._redirect(target, {
			visited,
			attemptedHash: hash,
			restoreHash: attempt.restoreHash,
			replace,
			direction: attempt.direction,
			fromRoute: this._currentRoute,
			fromHash: this._currentHash ?? "",
			signal: attempt.controller.signal,
			generation: attempt.generation,
			bag,
		});
	}

	/**
	 * Settle as Blocked. With `restoreHash` (default), the hash change of the navigation is
	 * undone first (see {@link _settleUncommitted}). Preflight callers pass false unless they
	 * superseded a hash-change navigation: otherwise the hash was never changed.
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
	 * `whenBack` runs after the settlement.
	 */
	private _settleUncommitted(
		result: NavigationResult,
		attemptedHash: string | undefined,
		restoreHash: boolean,
		whenBack?: () => void,
	): void {
		const loadDefaultRoute = restoreHash && this._currentHash === null && !!attemptedHash;
		// It settles once the URL is back.
		if (restoreHash && !loadDefaultRoute && !this._undoHashChange(result, whenBack)) return;
		this._flushSettlement(result);
		if (this._destroyed || this.isStopped()) return;
		whenBack?.();
		// Unless a handler navigated and committed in the meantime.
		if (loadDefaultRoute && this._currentHash === null) this._restoreHash("", false);
	}

	/**
	 * Describe how to undo the hash change that the navigation starts with. After `pending`, the
	 * undo of a navigation that this one supersedes, it takes back both changes. A `parse()` that
	 * is not `reported` by the hash changer comes with no hash change.
	 */
	private _describeUndo(pending: HashChangeUndo | null, reported: boolean): HashChangeUndo | null {
		if (!reported) return pending;
		const shown = HashChanger.getInstance().getHash();
		const step =
			lastStep && lastStep.href === window.location.href && lastStep !== this._consumedStep ? lastStep : null;
		if (step) this._consumedStep = step;
		if (!pending) return { first: shown, fullHash: undefined, shown, step, started: false };
		const offset = pending.step && step ? pending.step.offset + step.offset : 0;
		return {
			first: pending.first,
			fullHash: pending.fullHash,
			shown,
			step: step && offset ? { offset, href: step.href } : null,
			started: false,
		};
	}

	/**
	 * Put the URL back after a navigation that did not commit. Returns whether it is back;
	 * otherwise `result` settles when it is.
	 *
	 * While the URL still shows the hash change that started the navigation, that change is undone
	 * as a whole, so that the hashes of nested routers are back as well:
	 * - A step through the browser history is taken back, which leaves the history as it was.
	 *   The browser does that asynchronously.
	 * - Any other change (a new entry, or a step the browser does not report) has its entry replaced with
	 *   the full previous hash, once UI5 has reported the change to every router. Nested routers
	 *   have received their part of the refused hash by then; they receive the previous one next.
	 *
	 * `parse()` ends the wait when the hash change arrives that shows the full previous hash.
	 *
	 * If the URL has moved on since, only the hash of this router is restored. So it is while
	 * no navigation has committed: the URL before the change showed no route of this router either.
	 */
	private _undoHashChange(result: NavigationResult, whenBack?: () => void): boolean {
		const undo = this._undo;
		const hash = this._currentHash;
		const rootHash = HashChanger.getInstance().getHash();
		if (undo === null || hash === null || undo.shown !== rootHash || undo.fullHash === rootHash) {
			this._restoreHash(hash ?? "");
			return true;
		}
		const href = window.location.href;
		undo.started = true;
		this._phase = { kind: "restoring", result, whenBack };
		if (undo.step && undoneHref === href) {
			// Another router is taking the step back.
		} else if (undo.step) {
			undoneHref = href;
			window.history.go(-undo.step.offset);
		} else if (undo.fullHash === undefined) {
			// UI5 is still reporting the change to the nested routers.
			this._phase = { ...this._phase, awaitsReport: true };
		} else {
			this._replaceFullHash(undo.fullHash);
		}
		return false;
	}

	/**
	 * Replace the hash of the root hash changer with the full previous hash, and settle the
	 * navigation that waits for it unless `parse()` has done so.
	 */
	private _replaceFullHash(fullHash: string): void {
		HashChanger.getInstance().replaceHash(fullHash, HistoryDirection.Unknown);
		this._finishRestore();
	}

	/**
	 * Settle the navigation that waited for the URL to be back: on `hash`, if the hash changer
	 * has reported one with the URL.
	 */
	private _finishRestore(hash?: string): void {
		const phase = this._phase;
		if (phase.kind !== "restoring") return;
		this._phase = IDLE;
		this._flushSettlement(hash === undefined ? phase.result : { ...phase.result, hash });
		if (this._destroyed || this.isStopped()) return;
		phase.whenBack?.();
	}

	/**
	 * Restore the previous hash of this router without creating a history entry
	 * (see {@link _undoHashChange} for the hash change of a navigation).
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
		void hashChanger.replaceHash(hash, HistoryDirection.Unknown);
		this._suppressedHash = null;
	}

	/**
	 * Collect all route names and their patterns from the router.
	 * Skips routes whose pattern is undefined (no pattern configured).
	 */
	private _collectRoutePatterns(): RoutePattern[] {
		const result: RoutePattern[] = [];
		for (const name of this._routeNames) {
			const pattern = this.getRoute(name)?.getPattern();
			if (pattern !== undefined) result.push({ name, pattern });
		}
		return result;
	}

	/**
	 * Register one manifest guard: as the last guard of its route, or in front of the guard
	 * `before`. A registration error (`unknownRouteRegistration: "throw"` for an unknown route)
	 * is logged and skips the guard: no caller of the manifest config could catch it, and it
	 * must not keep the router from starting.
	 */
	private _registerManifestGuard(descriptor: ManifestGuardDescriptor, guardFn: GuardFn, before?: GuardFn): boolean {
		try {
			if (descriptor.route === "*") {
				this.addGuard(guardFn);
				return true;
			}
			if (descriptor.type === "leave") {
				this._handleUnknownRouteRegistration(descriptor.route, "addLeaveGuard");
				this._pipeline.addLeaveGuard(descriptor.route, guardFn, before);
			} else {
				this._handleUnknownRouteRegistration(descriptor.route, "addRouteGuard");
				this._pipeline.addEnterGuard(descriptor.route, guardFn, before);
			}
			this._manifestGuards.push({ descriptor, fn: guardFn });
			return true;
		} catch (err: unknown) {
			Log.error(`guardRouter.guards: failed to register "${descriptor.modulePath}"`, String(err), LOG_COMPONENT);
			return false;
		}
	}

	/**
	 * Register the guards of each descriptor, loading their modules on first use (see `createLazyGuards`).
	 * Returns the declared source descriptors rejected by `unknownRouteRegistration: "throw"`.
	 */
	private _registerLazyGuards(descriptors: ManifestGuardDescriptor[]): Set<GuardDescriptor> {
		const rejected = new Set<GuardDescriptor>();
		for (const descriptor of descriptors) {
			for (const fn of createLazyGuards(descriptor)) {
				if (!this._registerManifestGuard(descriptor, fn)) rejected.add(descriptor.source);
			}
		}
		return rejected;
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
		this._blockLoad = null;
		this._pipeline.clear();
		this._pendingGuardDescriptors = [];
		this._sourceDescriptors = [];
		this._manifestGuards = [];
		this._cancelPendingNavigation();
		const waiters = this._matchWaiters;
		this._matchWaiters = [];
		for (const resolve of waiters) resolve();
		this._undo = null;
		this._reportedHash = null;
		this._lastReport = null;
		this._reportOutdated = false;
		this._lastSettlement = null;
		this._detachHashListeners();
		this._meta.clear();
		super.destroy();
		return this;
	}
}
