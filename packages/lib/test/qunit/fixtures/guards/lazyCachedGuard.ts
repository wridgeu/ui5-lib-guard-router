import type { GuardResult } from "ui5/guard/router/types";
import probe from "./lazyProbe";

export default [
	function cachedFirst(): GuardResult {
		probe.calls.push("cachedFirst");
		return true;
	},
	function cachedSecond(): GuardResult {
		probe.calls.push("cachedSecond");
		return true;
	},
];
