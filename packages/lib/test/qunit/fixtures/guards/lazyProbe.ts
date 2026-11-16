import type { GuardFn } from "ui5/guard/router/types";

/**
 * Shared state for the lazy fixture guards: tests read `calls` and set what each
 * guard of lazyUncachedGuard does (allow when unset).
 */
const probe = {
	calls: [] as string[],
	behaviors: [] as GuardFn[],
};
export default probe;
