import type { GuardContext, GuardResult } from "ui5/guard/router/types";

export default {
	checkAuth(_context: GuardContext): GuardResult {
		return true;
	},
	checkRole(_context: GuardContext): GuardResult {
		return false;
	},
};
