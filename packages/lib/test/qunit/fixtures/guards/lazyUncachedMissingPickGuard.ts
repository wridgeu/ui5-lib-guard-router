import type { GuardResult } from "ui5/guard/router/types";

// Loaded only to cherry-pick an export it does not have, so the first use misses the module cache.
export default {
	allow: (): GuardResult => true,
};
