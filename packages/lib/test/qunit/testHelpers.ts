import HashChanger from "sap/ui/core/routing/HashChanger";
import Log from "sap/base/Log";
import Router from "ui5/guard/router/Router";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { GuardRouter } from "ui5/guard/router/types";

export interface CapturedWarning {
	message: string;
	details?: string;
}

export const GuardRouterClass = Router;

function getRouterMethod(router: GuardRouter, methodName: string): (...args: unknown[]) => unknown {
	const method = Reflect.get(router, methodName);
	if (typeof method !== "function") {
		throw new Error(`Router method "${methodName}" is not available`);
	}
	return (...args: unknown[]) => Reflect.apply(method, router, args);
}

export function addGuardUnsafe(router: GuardRouter, guard: unknown): void {
	getRouterMethod(router, "addGuard")(guard);
}

export function removeGuardUnsafe(router: GuardRouter, guard: unknown): void {
	getRouterMethod(router, "removeGuard")(guard);
}

export function addRouteGuardUnsafe(router: GuardRouter, routeName: string, guard: unknown): void {
	getRouterMethod(router, "addRouteGuard")(routeName, guard);
}

export function removeRouteGuardUnsafe(router: GuardRouter, routeName: string, guard: unknown): void {
	getRouterMethod(router, "removeRouteGuard")(routeName, guard);
}

export function addLeaveGuardUnsafe(router: GuardRouter, routeName: string, guard: unknown): void {
	getRouterMethod(router, "addLeaveGuard")(routeName, guard);
}

export function removeLeaveGuardUnsafe(router: GuardRouter, routeName: string, guard: unknown): void {
	getRouterMethod(router, "removeLeaveGuard")(routeName, guard);
}

/**
 * Dynamically add a route to a router.
 *
 * Uses the inherited `sap.ui.core.routing.Router#addRoute` API. The `oParent`
 * parameter is optional at runtime (no parent = top-level route), but the UI5
 * type declarations mark it as required. We call through `getRouterMethod` to
 * avoid fighting the incorrect type signature.
 */
export function addRouteDynamic(router: GuardRouter, config: { name: string; pattern: string }): void {
	getRouterMethod(router, "addRoute")(config);
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

/** Wait for a timer tick. */
export function nextTick(ms = 50): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
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
export function waitForRoute(router: GuardRouter, routeName: string, timeout = 1000): Promise<void> {
	return new Promise((resolve, reject) => {
		const route = router.getRoute(routeName);
		if (!route) {
			reject(new Error(`Route "${routeName}" is not available`));
			return;
		}

		const timer = setTimeout(() => {
			route.detachPatternMatched(handler);
			reject(
				new Error(`Timed out waiting for route "${routeName}", hash="${HashChanger.getInstance().getHash()}"`),
			);
		}, timeout);

		const handler = (): void => {
			clearTimeout(timer);
			route.detachPatternMatched(handler);
			resolve();
		};

		route.attachPatternMatched(handler);
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

/** Return the current hash from the HashChanger. */
export function getHash(): string {
	return HashChanger.getInstance().getHash();
}

/**
 * Capture `Log.warning` calls during `fn`, restoring the original in a
 * `finally` block so the stub never leaks to subsequent tests.
 */
export function captureWarnings(fn: () => void): CapturedWarning[] {
	const warnings: CapturedWarning[] = [];
	const original = Log.warning;
	Log.warning = (message: string, details?: string) => {
		warnings.push({ message, details });
	};
	try {
		fn();
	} finally {
		Log.warning = original;
	}
	return warnings;
}

/**
 * Async variant of {@link captureWarnings} for tests that `await` inside
 * the capture window.
 */
export async function captureWarningsAsync(fn: () => Promise<void>): Promise<CapturedWarning[]> {
	const warnings: CapturedWarning[] = [];
	const original = Log.warning;
	Log.warning = (message: string, details?: string) => {
		warnings.push({ message, details });
	};
	try {
		await fn();
	} finally {
		Log.warning = original;
	}
	return warnings;
}
