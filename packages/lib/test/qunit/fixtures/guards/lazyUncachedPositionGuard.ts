import type { GuardResult } from "ui5/guard/router/types";
import probe from "./lazyProbe";

// Loaded only by the declared-position test, so its first use always misses the module cache.
export default function (): GuardResult {
	probe.calls.push("uncachedPosition");
	return true;
}
