import type { GuardContext, GuardResult } from "ui5/guard/router/types";
import probe from "./lazyProbe";

// Loaded only by the uncached lazy test, so its first use always misses the module cache.
export default [
	function uncachedFirst(context: GuardContext): GuardResult | PromiseLike<GuardResult> {
		probe.calls.push("uncachedFirst");
		return probe.behaviors[0]?.(context) ?? true;
	},
	function uncachedSecond(context: GuardContext): GuardResult | PromiseLike<GuardResult> {
		probe.calls.push("uncachedSecond");
		return probe.behaviors[1]?.(context) ?? true;
	},
];
