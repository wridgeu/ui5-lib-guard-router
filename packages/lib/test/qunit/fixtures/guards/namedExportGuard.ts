import type { GuardResult } from "ui5/guard/router/types";
import probe from "./lazyProbe";

// Named exports instead of a default export: the transpiled module is an object that also holds `__esModule`.
export function namedFirst(): GuardResult {
	probe.calls.push("namedFirst");
	return true;
}

export function namedSecond(): GuardResult {
	probe.calls.push("namedSecond");
	return true;
}
