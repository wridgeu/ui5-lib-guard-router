import type { GuardResult } from "ui5/guard/router/types";
import probe from "./lazyProbe";

// Loaded only by the uncached array-index cherry-pick test, so its first use always misses the module cache.
export default [
	function arrayFirst(): GuardResult {
		probe.calls.push("arrayFirst");
		return true;
	},
	function arraySecond(): GuardResult {
		probe.calls.push("arraySecond");
		return true;
	},
];
