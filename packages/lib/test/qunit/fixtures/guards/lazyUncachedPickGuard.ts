import type { GuardResult } from "ui5/guard/router/types";

// Loaded only by the uncached cherry-pick test, so its first use always misses the module cache.
export default {
	allow(): GuardResult {
		return true;
	},
	block(): GuardResult {
		return false;
	},
};
