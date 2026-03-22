import type { GuardContext, GuardResult } from "ui5/guard/router/types";

export default {
	validGuard(_context: GuardContext): GuardResult {
		return true;
	},
	notAFunction: 42,
	alsoNotAFunction: "hello",
};
