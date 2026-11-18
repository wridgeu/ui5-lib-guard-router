import type { GuardContext, GuardResult } from "ui5/guard/router/types";
import probe from "./lazyProbe";

export default [
	function allowFirst(_context: GuardContext): GuardResult {
		probe.calls.push("allowFirst");
		return true;
	},
	function blockSecond(_context: GuardContext): GuardResult {
		probe.calls.push("blockSecond");
		return false;
	},
];
