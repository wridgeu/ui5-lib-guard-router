import type { GuardContext, GuardResult } from "ui5/guard/router/types";
import probe from "./lazyProbe";

export default {
	checkAuth(_context: GuardContext): GuardResult {
		probe.calls.push("checkAuth");
		return true;
	},
	checkRole(_context: GuardContext): GuardResult {
		probe.calls.push("checkRole");
		return false;
	},
};
