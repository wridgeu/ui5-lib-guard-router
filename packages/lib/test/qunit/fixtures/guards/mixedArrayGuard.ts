import type { GuardContext, GuardResult } from "ui5/guard/router/types";

export default [
	function allowFirst(_context: GuardContext): GuardResult {
		return true;
	},
	"not a function",
	function allowThird(_context: GuardContext): GuardResult {
		return true;
	},
];
