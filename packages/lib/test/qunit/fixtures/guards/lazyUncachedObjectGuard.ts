import type { GuardContext, GuardResult } from "ui5/guard/router/types";
import probe from "./lazyProbe";

// Loaded only by the uncached object-module test, so its first use always misses the module cache.
export default {
	objectFirst(context: GuardContext): GuardResult | PromiseLike<GuardResult> {
		probe.calls.push("objectFirst");
		return probe.behaviors[0]?.(context) ?? true;
	},
	objectSecond(context: GuardContext): GuardResult | PromiseLike<GuardResult> {
		probe.calls.push("objectSecond");
		return probe.behaviors[1]?.(context) ?? true;
	},
};
