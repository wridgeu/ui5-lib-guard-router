import type Component from "sap/ui/core/Component";
import HashChanger from "sap/ui/core/routing/HashChanger";
import UIComponent from "sap/ui/core/UIComponent";
import Log from "sap/base/Log";
import jQuery from "sap/ui/thirdparty/jquery";
import Router from "ui5/guard/router/Router";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { GuardRouter, GuardRouterOptions } from "ui5/guard/router/types";

export interface CapturedLogEntry {
	message: string;
	details?: string;
}

/** @deprecated Use {@link CapturedLogEntry} instead. */
export type CapturedWarning = CapturedLogEntry;

export const GuardRouterClass = Router;

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

/** Construct a router as an untyped JS caller would, to test runtime validation of invalid config. */
export function createRouterUnsafe(routes: object[], config: unknown): GuardRouter {
	return Reflect.construct(GuardRouterClass, [routes, config]);
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
	const method = Reflect.get(target, methodName);
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
 * Wait for a single patternMatched on `routeName`, then detach.
 *
 * Waits for future events only. Tests must call `waitForRoute` before or
 * immediately after `navTo()`. This is safe because the router config uses
 * `async: true`, which defers patternMatched to a microtask. With sync
 * routing the event would fire inside `navTo()` before the listener is
 * attached, and these tests would hang.
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
	const listener = (event: { getParameter(name: string): unknown }): void => {
		hashes.push(String(event.getParameter("newHash")));
	};
	hashChanger.attachEvent("hashChanged", listener);
	return { hashes, stop: () => hashChanger.detachEvent("hashChanged", listener) };
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
	return { message, details: details === undefined ? undefined : String(details) };
}

/**
 * Capture `Log.warning` calls during `fn` using a Sinon stub.
 * The stub is restored automatically via `finally` to prevent leaks.
 */
export function captureWarnings(fn: () => void): CapturedWarning[] {
	const stub = sinon.stub(Log, "warning");
	try {
		fn();
	} finally {
		stub.restore();
	}
	return stub.getCalls().map((call) => toLogEntry(call.args[0] as string, call.args[1]));
}

/**
 * Async variant of {@link captureWarnings} for tests that `await` inside
 * the capture window.
 */
export async function captureWarningsAsync(fn: () => Promise<void>): Promise<CapturedWarning[]> {
	const stub = sinon.stub(Log, "warning");
	try {
		await fn();
	} finally {
		stub.restore();
	}
	return stub.getCalls().map((call) => toLogEntry(call.args[0] as string, call.args[1]));
}

/**
 * Capture `Log.error` calls during `fn`, restoring the original in a
 * `finally` block so the stub never leaks to subsequent tests.
 */
export function captureErrors(fn: () => void): CapturedLogEntry[] {
	const errors: CapturedLogEntry[] = [];
	const original = Log.error;
	Log.error = (message: string, details?: unknown) => {
		errors.push(toLogEntry(message, details));
	};
	try {
		fn();
	} finally {
		Log.error = original;
	}
	return errors;
}

/**
 * Async variant of {@link captureErrors} for tests that `await` inside
 * the capture window.
 */
export async function captureErrorsAsync(fn: () => Promise<void>): Promise<CapturedLogEntry[]> {
	const errors: CapturedLogEntry[] = [];
	const original = Log.error;
	Log.error = (message: string, details?: unknown) => {
		errors.push(toLogEntry(message, details));
	};
	try {
		await fn();
	} finally {
		Log.error = original;
	}
	return errors;
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
