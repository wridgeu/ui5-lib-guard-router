import type { GuardFn } from "ui5/guard/router/types";

/**
 * Shared state for the fixture guards: tests read `calls`, the guards that ran in order, and set
 * what each guard of the lazyUncached fixtures does (allow when unset).
 */
interface Probe {
	calls: string[];
	behaviors: GuardFn[];
}

const probe: Probe = {
	calls: [],
	behaviors: [],
};
export default probe;
