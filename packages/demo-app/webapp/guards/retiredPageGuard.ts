import type { GuardContext, GuardResult } from "ui5/guard/router/types";

/**
 * Guard of the retired `team` page (manifest-declared): redirects to the people list
 * under its legacy route name `staff`.
 *
 * `staff` is an alias kept after the route was renamed to `employees`: both routes have
 * the pattern `employees`, and UI5 matches the first one in manifest order, `employees`.
 * The redirect therefore settles on `employees`, the route that matches the hash and
 * that UI5 displays, not on the name returned here.
 */
export default function retiredPageGuard(_context: GuardContext): GuardResult {
	return "staff";
}
