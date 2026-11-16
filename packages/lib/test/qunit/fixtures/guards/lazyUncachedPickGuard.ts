import type { GuardContext, GuardResult } from "ui5/guard/router/types";

// Loaded only by the uncached cherry-pick test, so its first use always misses the module cache.
export default {
	allow(_context: GuardContext): GuardResult {
		return true;
	},
	block(_context: GuardContext): GuardResult {
		return false;
	},
};
