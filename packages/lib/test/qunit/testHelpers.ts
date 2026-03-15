import HashChanger from "sap/ui/core/routing/HashChanger";
import Router from "ui5/guard/router/Router";
import type { GuardRouter } from "ui5/guard/router/types";

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

/** Wait for a single patternMatched on `routeName`, then detach. */
export function waitForRoute(router: GuardRouter, routeName: string, timeout = 1000): Promise<void> {
	return new Promise((resolve, reject) => {
		const maybeRoute = router.getRoute(routeName);
		if (!maybeRoute) {
			reject(new Error(`Route "${routeName}" is not available`));
			return;
		}
		const route = maybeRoute;

		const timer = setTimeout(() => {
			route.detachPatternMatched(handler);
			reject(
				new Error(`Timed out waiting for route "${routeName}", hash="${HashChanger.getInstance().getHash()}"`),
			);
		}, timeout);

		function handler(): void {
			clearTimeout(timer);
			route.detachPatternMatched(handler);
			resolve();
		}

		route.attachPatternMatched(handler);
	});
}

/**
 * Assert that navigation to `routeName` does not complete within `timeout` ms.
 * Call `navigate()` to trigger the navigation under test.
 */
export async function assertBlocked(
	assert: Assert,
	router: GuardRouter,
	routeName: string,
	navigate: () => void,
	message: string,
	// Sync guards resolve in the same tick; async test guards settle within
	// ~10 ms.  150 ms gives a 15x margin while saving ~11 s wall-time vs the
	// previous 500 ms default.
	timeout = 150,
): Promise<void> {
	let matched = false;
	const route = router.getRoute(routeName)!;
	const handler = () => {
		matched = true;
	};
	route.attachPatternMatched(handler);
	navigate();
	await nextTick(timeout);
	route.detachPatternMatched(handler);
	const assertMsg = matched
		? `${message} (navigation unexpectedly reached "${routeName}", hash="${HashChanger.getInstance().getHash()}")`
		: message;
	assert.notOk(matched, assertMsg);
}
