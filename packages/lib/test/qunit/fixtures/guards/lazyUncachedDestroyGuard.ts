import type { GuardResult } from "ui5/guard/router/types";
import probe from "./lazyProbe";

// Loaded only by the destroy-during-load test, so its first use always misses the module cache.
export default function (): GuardResult {
	probe.calls.push("destroyGuard");
	return true;
}
