import type { GuardContext, GuardResult } from "ui5/guard/router/types";
export default function redirectGuard(_context: GuardContext): GuardResult {
	return "home";
}
