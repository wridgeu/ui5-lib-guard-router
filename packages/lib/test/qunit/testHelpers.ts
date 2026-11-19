import type Component from "sap/ui/core/Component";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type HashChangerBase from "sap/ui/core/routing/HashChangerBase";
import type { HashChangerBase$HashChangedEvent } from "sap/ui/core/routing/HashChangerBase";
import UIComponent from "sap/ui/core/UIComponent";
import Log from "sap/base/Log";
import jQuery from "sap/ui/thirdparty/jquery";
import Router from "ui5/guard/router/Router";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { GuardContext, GuardRouter, GuardRouterOptions } from "ui5/guard/router/types";

export interface CapturedLogEntry {
	message: string;
	details?: string;
}

export const GuardRouterClass = Router;

/**
 * Sinon-qunit-bridge puts `stub` and `spy` on the QUnit test context (`this`), from a sandbox
 * per test that is restored in afterEach. Unlike `sinon.stub`, they need no manual restore.
 */
export interface SinonTestContext {
	stub: sinon.SinonStubStatic;
	spy: sinon.SinonSpyStatic;
}

/**
 * Load a module by the name that fixtures and the router resolve it to: the test page loads
 * test files under test-resources/, so a relative import would get a second instance.
 */
export function loadModule<T>(path: string): Promise<T> {
	return new Promise((resolve, reject) => {
		sap.ui.require([path], (mod: T) => resolve(mod), reject);
	});
}

/** A guard context for tests of the pipeline and of guard modules, which need no router. */
export function createGuardContext(overrides: Partial<GuardContext> = {}): GuardContext {
	return {
		toRoute: "target",
		toHash: "target",
		toArguments: {},
		fromRoute: "",
		fromHash: "",
		signal: new AbortController().signal,
		bag: new Map(),
		toMeta: Object.freeze({}),
		fromMeta: Object.freeze({}),
		...overrides,
	};
}

const TEST_ROUTES = [
	{ name: "home", pattern: "" },
	{ name: "protected", pattern: "protected" },
	{ name: "forbidden", pattern: "forbidden" },
	{ name: "detail", pattern: "detail/{id}" },
];

export function createRouter(): GuardRouter {
	return new GuardRouterClass(TEST_ROUTES, { async: true });
}

export function createRouterWithOptions(guardRouter: GuardRouterOptions): GuardRouter {
	return new GuardRouterClass(TEST_ROUTES, { async: true, guardRouter });
}

/**
 * QUnit module hooks for a test file that keeps its router in a variable. Before each test the
 * hash is reset and `use` receives a new router on the standard routes. After each test the
 * router that `current` returns is destroyed: a test may have replaced the one it was given.
 */
export function routerHooks(
	use: (router: GuardRouter) => void,
	current: () => GuardRouter,
): { beforeEach: () => void; afterEach: () => void } {
	return {
		beforeEach: () => {
			initHashChanger();
			use(createRouter());
		},
		afterEach: () => {
			current().destroy();
			HashChanger.getInstance().setHash("");
		},
	};
}

/**
 * QUnit module hooks for tests that create their router themselves: the hash is reset before
 * each test, the router that `current` returns is destroyed after it.
 */
export function createdRouterHooks(current: () => GuardRouter): { beforeEach: () => void; afterEach: () => void } {
	return {
		beforeEach: initHashChanger,
		afterEach: () => {
			current().destroy();
			HashChanger.getInstance().setHash("");
		},
	};
}

/** Construct a router as an untyped JS caller would, to test runtime validation of invalid config. */
export function createRouterUnsafe(routes: object[], config: unknown, ...rest: unknown[]): GuardRouter {
	const router: unknown = Reflect.construct(GuardRouterClass, [routes, config, ...rest]);
	if (!(router instanceof GuardRouterClass)) {
		throw new Error("The guard router class constructed no guard router");
	}
	return router;
}

/** {@link createRouterWithOptions} for invalid `guardRouter` values. */
export function createRouterWithOptionsUnsafe(guardRouter: unknown): GuardRouter {
	return createRouterUnsafe(TEST_ROUTES, { async: true, guardRouter });
}

/** The guard router of a fixture component; throws if the component has none. */
export function getComponentRouter(component: Component): GuardRouter {
	const router = component instanceof UIComponent ? component.getRouter() : undefined;
	if (!(router instanceof Router)) {
		throw new Error(`Component "${component.getId()}" has no guard router`);
	}
	return router;
}

/** Call `target[methodName]` as an untyped JS caller would, to test runtime validation of invalid arguments. */
export function callUnsafe(target: object, methodName: string, ...args: unknown[]): unknown {
	const method: unknown = Reflect.get(target, methodName);
	if (typeof method !== "function") {
		throw new Error(`Method "${methodName}" is not available`);
	}
	return Reflect.apply(method, target, args);
}

export function addGuardUnsafe(router: GuardRouter, guard: unknown): void {
	callUnsafe(router, "addGuard", guard);
}

export function removeGuardUnsafe(router: GuardRouter, guard: unknown): void {
	callUnsafe(router, "removeGuard", guard);
}

export function addRouteGuardUnsafe(router: GuardRouter, routeName: string, guard: unknown): void {
	callUnsafe(router, "addRouteGuard", routeName, guard);
}

export function removeRouteGuardUnsafe(router: GuardRouter, routeName: string, guard: unknown): void {
	callUnsafe(router, "removeRouteGuard", routeName, guard);
}

export function addLeaveGuardUnsafe(router: GuardRouter, routeName: string, guard: unknown): void {
	callUnsafe(router, "addLeaveGuard", routeName, guard);
}

export function removeLeaveGuardUnsafe(router: GuardRouter, routeName: string, guard: unknown): void {
	callUnsafe(router, "removeLeaveGuard", routeName, guard);
}

export function setRouteMetaUnsafe(router: GuardRouter, routeName: string, meta: unknown): void {
	callUnsafe(router, "setRouteMeta", routeName, meta);
}

/**
 * Initialize HashChanger for tests (idempotent).
 */
export function initHashChanger(): void {
	const hashChanger = HashChanger.getInstance();
	if (!hashChanger.hasListeners("hashChanged")) {
		hashChanger.init();
	}
	hashChanger.setHash("");
}

/** A non-native thenable (jQuery Deferred), for testing that guards accept any PromiseLike. */
export function createPromiseLike<T>(value: T): PromiseLike<T> {
	return jQuery.Deferred<T>().resolve(value).promise();
}

/**
 * Resolve on the next task, after every promise reaction queued so far has run.
 * Use it to let a just-resolved guard reach the router before asserting what it did.
 */
export function flushPromises(): Promise<void> {
	return new Promise((resolve) => {
		const { port1, port2 } = new MessageChannel();
		port1.addEventListener(
			"message",
			() => {
				port1.close();
				resolve();
			},
			{ once: true },
		);
		port1.start();
		port2.postMessage(undefined);
	});
}

/**
 * Wait for the next patternMatched on `routeName`.
 *
 * Waits for future events only. Tests must call `waitForRoute` before or
 * immediately after `navTo()`. This is safe because the router config uses
 * `async: true`, which defers patternMatched to a microtask. With sync
 * routing the event would fire inside `navTo()` before the listener is
 * attached, and the test would time out.
 */
export function waitForRoute(router: GuardRouter, routeName: string): Promise<void> {
	const route = router.getRoute(routeName);
	if (!route) {
		return Promise.reject(new Error(`Route "${routeName}" is not available`));
	}
	return new Promise((resolve) => {
		route.attachEventOnce("patternMatched", () => resolve());
	});
}

/**
 * Assert that navigation is blocked by the guard pipeline.
 *
 * Calls `navigationSettled()` and verifies the outcome is `Blocked`.
 */
export async function assertBlocked(
	assert: Assert,
	router: GuardRouter,
	navigate: () => void,
	message: string,
): Promise<void> {
	navigate();
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, message);
}

/**
 * Record every hash the HashChanger reports via `hashChanged` until `stop()`.
 * Proves a hash was never set, which a final `getHash()` check cannot:
 * the parse() fallback restores the hash after a block.
 */
export function recordHashChanges(): { hashes: string[]; stop: () => void } {
	const hashChanger = HashChanger.getInstance();
	const hashes: string[] = [];
	const listener = (event: HashChangerBase$HashChangedEvent): void => {
		// The UI5 types declare the hash as an object.
		const newHash: unknown = event.getParameter("newHash");
		if (typeof newHash === "string") hashes.push(newHash);
	};
	hashChanger.attachEvent("hashChanged", listener);
	return { hashes, stop: () => hashChanger.detachEvent("hashChanged", listener) };
}

/**
 * The hash writes that reach `hashChanger` while `act` runs, in order: `set:<hash>` adds a
 * history entry, `replace:<hash>` does not.
 */
export async function captureHashWrites(
	hashChanger: HashChangerBase,
	act: () => void | Promise<void>,
): Promise<string[]> {
	const writes: string[] = [];
	const setHash = sinon.stub(hashChanger, "setHash").callsFake(function (this: HashChangerBase, ...args) {
		writes.push(`set:${args[0]}`);
		return setHash.wrappedMethod.apply(this, args);
	});
	const replaceHash = sinon.stub(hashChanger, "replaceHash").callsFake(function (this: HashChangerBase, ...args) {
		writes.push(`replace:${args[0]}`);
		return replaceHash.wrappedMethod.apply(this, args);
	});
	try {
		await act();
		await flushPromises();
	} finally {
		setHash.restore();
		replaceHash.restore();
	}
	return writes;
}

/** Record each settlement's status as it fires, so a test can check what settled before navTo/setHash returned. */
export function recordSettlements(router: GuardRouter): NavigationOutcome[] {
	const statuses: NavigationOutcome[] = [];
	router.attachNavigationSettled((event) => {
		statuses.push(event.getParameter("status"));
	});
	return statuses;
}

/**
 * Run `act` and return the reasons of the promise rejections that nothing handled meanwhile.
 * The browser reports unhandled rejections in order, from a task of its own, so everything
 * `act` caused is reported before the marker that is rejected once `act` is done.
 */
export async function captureUnhandledRejections(act: () => Promise<void>): Promise<string[]> {
	const marker = new Error("marker");
	const unhandled: string[] = [];
	const markerReported = new Promise<void>((resolve) => {
		const onUnhandled = (event: PromiseRejectionEvent): void => {
			if (event.reason !== marker) {
				unhandled.push(String(event.reason));
				return;
			}
			event.preventDefault();
			window.removeEventListener("unhandledrejection", onUnhandled);
			resolve();
		};
		window.addEventListener("unhandledrejection", onUnhandled);
	});
	try {
		await act();
	} finally {
		void Promise.reject(marker);
		await markerReported;
	}
	return unhandled;
}

/**
 * The UI5-private member by which a router reports a route match in progress. The guard router
 * also reports one while a navigation waits for async guards (see `Router._mirrorMatchingProcess`).
 */
export function isMatching(router: GuardRouter): unknown {
	return Reflect.get(router, "_bMatchingProcessStarted");
}

/** Return the current hash from the HashChanger. */
export function getHash(): string {
	return HashChanger.getInstance().getHash();
}

/**
 * A captured log call. UI5 passes objects such as the router itself as details; keeping them
 * would hand a cyclic value to a failing assertion, which wdio cannot transfer out of the browser.
 */
function toLogEntry(message: string, details: unknown): CapturedLogEntry {
	const text = String(details);
	return { message, details: details === undefined ? undefined : text };
}

/** Messages a stubbed `Log` method received; a message logged under another component says so. */
export function logMessages(stub: sinon.SinonStub): string[] {
	return stub.getCalls().map((call) => {
		const [message, , component] = call.args as [string, unknown, string];
		return component === "ui5.guard.router.Router" ? message : `${message} (component: ${component})`;
	});
}

/**
 * Capture `Log.warning` calls during `fn` using a Sinon stub.
 * The stub is restored automatically via `finally` to prevent leaks.
 */
export function captureWarnings(fn: () => void): CapturedLogEntry[] {
	const stub = sinon.stub(Log, "warning");
	try {
		fn();
	} finally {
		stub.restore();
	}
	return stub.getCalls().map((call) => toLogEntry(call.args[0], call.args[1]));
}

/**
 * Async variant of {@link captureWarnings} for tests that `await` inside
 * the capture window.
 */
export async function captureWarningsAsync(fn: () => Promise<void>): Promise<CapturedLogEntry[]> {
	const stub = sinon.stub(Log, "warning");
	try {
		await fn();
	} finally {
		stub.restore();
	}
	return stub.getCalls().map((call) => toLogEntry(call.args[0], call.args[1]));
}

/** {@link captureWarnings} for `Log.error` calls. */
export function captureErrors(fn: () => void): CapturedLogEntry[] {
	const stub = sinon.stub(Log, "error");
	try {
		fn();
	} finally {
		stub.restore();
	}
	return stub.getCalls().map((call) => toLogEntry(call.args[0], call.args[1]));
}

/**
 * Async variant of {@link captureErrors} for tests that `await` inside
 * the capture window.
 */
export async function captureErrorsAsync(fn: () => Promise<void>): Promise<CapturedLogEntry[]> {
	const stub = sinon.stub(Log, "error");
	try {
		await fn();
	} finally {
		stub.restore();
	}
	return stub.getCalls().map((call) => toLogEntry(call.args[0], call.args[1]));
}

/** Routes forming a URL tree: `employees` → `employees/{id}` → `employees/{id}/resume`. */
export const HIERARCHICAL_ROUTES = [
	{ name: "home", pattern: "" },
	{ name: "employees", pattern: "employees" },
	{ name: "employee", pattern: "employees/{id}" },
	{ name: "employeeResume", pattern: "employees/{id}/resume" },
	{ name: "settings", pattern: "settings" },
	{ name: "settingsProfile", pattern: "settings/profile" },
];

/** Create a router on {@link HIERARCHICAL_ROUTES} for inheritance tests. */
export function createHierarchicalRouter(guardRouter: GuardRouterOptions): GuardRouter {
	return new GuardRouterClass(HIERARCHICAL_ROUTES, { async: true, guardRouter });
}

/** The part of hasher, through which UI5's hash changer reads and writes the URL, that tests use. */
interface Hasher {
	changed: { active: boolean };
	setHash(hash: string): void;
	replaceHash(hash: string): void;
}

/**
 * Change the URL without a `hashChanged` event of the hash changer. The Fiori launchpad does
 * that when a navigation filter handles a hash change itself, as it does to put the URL back
 * after a cross-app navigation that the user cancelled.
 */
export async function changeHashSilently(write: (hasher: Hasher) => void): Promise<void> {
	const hasher = await loadModule<Hasher>("sap/ui/thirdparty/hasher");
	hasher.changed.active = false;
	try {
		write(hasher);
	} finally {
		hasher.changed.active = true;
	}
}
