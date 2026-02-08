import HashChanger from "sap/ui/core/routing/HashChanger";
import type { RouterInstance } from "ui5/ext/routing/types";

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
export function waitForRoute(router: RouterInstance, routeName: string): Promise<void> {
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
	router: RouterInstance,
	routeName: string,
	navigate: () => void,
	message: string,
	timeout = 500,
): Promise<void> {
	let matched = false;
	router.getRoute(routeName)!.attachPatternMatched(() => {
		matched = true;
	});
	navigate();
	await nextTick(timeout);
	assert.notOk(matched, message);
}
