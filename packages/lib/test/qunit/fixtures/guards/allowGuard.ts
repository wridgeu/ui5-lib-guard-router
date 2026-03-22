import type { GuardContext, GuardResult } from "ui5/guard/router/types";
export default function allowGuard(_context: GuardContext): GuardResult {
	return true;
}
