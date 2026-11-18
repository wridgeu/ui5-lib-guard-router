import type { GuardResult } from "ui5/guard/router/types";

// Loaded only by the block-mode load-timing test, so that test sees when the module is first fetched.
export default function (): GuardResult {
	return true;
}
