import HashChanger from "sap/ui/core/routing/HashChanger";

/** Initialize HashChanger for tests (idempotent). */
export function initHashChanger(): void {
	const hashChanger = HashChanger.getInstance();
	if (!(hashChanger as any).hasListeners("hashChanged")) {
		hashChanger.init();
	}
	hashChanger.setHash("");
}

/** Wait for next tick (let async parse() settle). */
export function nextTick(ms = 50): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
