import type { GuardResult } from "ui5/guard/router/types";

// Loaded only by the throwing lazy test, so its first use always misses the module cache.
export default {
	fail(): GuardResult {
		throw new Error("guard failed");
	},
};
