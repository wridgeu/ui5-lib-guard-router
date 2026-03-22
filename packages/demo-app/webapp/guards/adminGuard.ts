import type { GuardContext, GuardResult } from "ui5/guard/router/types";

/**
 * Guard that always redirects to "protected" (manifest-declared).
 *
 * Demonstrates a redirect chain: navigating to "admin" redirects to
 * "protected", whose own auth guard then runs. When logged out, the
 * chain continues to "home" (admin -> protected -> home). When logged
 * in, the chain stops at "protected" (admin -> protected).
 */
export default function adminGuard(_context: GuardContext): GuardResult {
	return "protected";
}
