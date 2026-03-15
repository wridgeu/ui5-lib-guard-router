import HashChanger from "sap/ui/core/routing/HashChanger";
import type MobileRouter from "sap/m/routing/Router";
import Router from "ui5/guard/router/Router";
import type { GuardRouter } from "ui5/guard/router/types";

/** Typed constructor so test files don't need `as any` casts. */
type GuardRouterConstructor = new (...args: ConstructorParameters<typeof MobileRouter>) => GuardRouter;

export const GuardRouterClass = Router as GuardRouterConstructor;

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

export function addRouteGuardUnsafe(router: GuardRouter, routeName: string, guard: unknown): void {
	getRouterMethod(router, "addRouteGuard")(routeName, guard);
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
export function waitForRoute(router: GuardRouter, routeName: string): Promise<void> {
	return new Promise((resolve) => {
		const route = router.getRoute(routeName)!;
		route.attachPatternMatched(function handler() {
			route.detachPatternMatched(handler);
			resolve();
		});
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
	timeout = 500,
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
