import HashChanger from "sap/ui/core/routing/HashChanger";

/**
 * Initialize HashChanger for tests (idempotent).
 * Uses the private `hasListeners` method from `sap.ui.base.EventProvider`
 * to avoid double-init. This is an internal API; if UI5 removes it,
 * a try/catch around `init()` is an acceptable fallback.
 */
export function initHashChanger(): void {
	const hashChanger = HashChanger.getInstance();
	if (!hashChanger.hasListeners("hashChanged")) {
		hashChanger.init();
	}
	hashChanger.setHash("");
}

/** Wait for next tick (let async parse() settle). */
export function nextTick(ms = 50): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
