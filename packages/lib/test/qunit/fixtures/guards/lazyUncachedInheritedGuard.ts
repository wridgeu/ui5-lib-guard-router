import type { GuardResult } from "ui5/guard/router/types";

// Loaded only by the addRoute() inheritance test, so it is not cached when the route is added.
export default function (): GuardResult {
	return false;
}
