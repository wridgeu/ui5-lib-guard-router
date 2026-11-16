import type { GuardContext, GuardResult } from "ui5/guard/router/types";
import probe from "./lazyProbe";

export default [
	function cachedFirst(_context: GuardContext): GuardResult {
		probe.calls.push("cachedFirst");
		return true;
	},
	function cachedSecond(_context: GuardContext): GuardResult {
		probe.calls.push("cachedSecond");
		return true;
	},
];
