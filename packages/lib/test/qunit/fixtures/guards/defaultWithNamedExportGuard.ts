import type { GuardResult } from "ui5/guard/router/types";
import probe from "./lazyProbe";

// A default export with a named export beside it: the transpiled module is the default function, with `named` as a property.
export default function defaultGuard(): GuardResult {
	probe.calls.push("default");
	return true;
}

export function named(): GuardResult {
	probe.calls.push("named");
	return true;
}
