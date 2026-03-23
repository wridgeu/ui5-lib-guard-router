import type { GuardContext, GuardResult } from "ui5/guard/router/types";

/**
 * Guard that always blocks navigation (manifest-declared).
 *
 * Demonstrates the simplest enter-guard block shape as a declarative guard.
 */
export default function blockedGuard(_context: GuardContext): GuardResult {
	return false;
}
