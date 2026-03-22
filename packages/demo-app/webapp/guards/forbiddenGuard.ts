import type { GuardContext, GuardResult } from "ui5/guard/router/types";

/**
 * Guard that always redirects navigation to "home" (manifest-declared).
 *
 * Demonstrates the simplest redirect guard shape as a declarative guard.
 */
export default function forbiddenGuard(_context: GuardContext): GuardResult {
	return "home";
}
