import type { GuardResult } from "ui5/guard/router/types";

// Loaded only by the lazy first-navigation test, so the app starts before the module is cached.
export default function (): GuardResult {
	return false;
}
