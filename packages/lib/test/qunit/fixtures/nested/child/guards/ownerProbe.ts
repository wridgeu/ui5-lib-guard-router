import type UIComponent from "sap/ui/core/UIComponent";
import type { GuardFn } from "ui5/guard/router/types";

/**
 * Shared state for ownerGuard: tests read the owner component of each guard context
 * and set what the guard decides (allow when unset).
 */
interface Probe {
	owners: (UIComponent | undefined)[];
	decide?: GuardFn;
}

const probe: Probe = {
	owners: [],
};
export default probe;
