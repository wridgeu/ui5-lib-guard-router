import type { GuardContext, GuardResult } from "ui5/guard/router/types";
import probe from "./lazyProbe";

// Loaded only by the uncached function-module test, so its first use always misses the module cache.
export default function (context: GuardContext): GuardResult | PromiseLike<GuardResult> {
	probe.calls.push("function");
	return probe.behaviors[0]?.(context) ?? true;
}
