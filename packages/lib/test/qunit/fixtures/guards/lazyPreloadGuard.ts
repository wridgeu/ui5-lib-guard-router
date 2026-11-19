import type { GuardResult } from "ui5/guard/router/types";

// Loaded only by the constructor-preload test, so its first use always misses the module cache.
export default function (): GuardResult {
	return true;
}
