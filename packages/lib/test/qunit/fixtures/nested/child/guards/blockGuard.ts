import type { GuardContext, GuardResult } from "ui5/guard/router/types";
export default function blockGuard(_context: GuardContext): GuardResult {
	return false;
}
