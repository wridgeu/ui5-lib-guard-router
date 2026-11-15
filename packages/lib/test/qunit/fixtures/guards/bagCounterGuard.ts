import type { GuardContext, GuardResult } from "ui5/guard/router/types";
export default function bagCounterGuard(context: GuardContext): GuardResult {
	const count = context.bag.get("count");
	context.bag.set("count", (typeof count === "number" ? count : 0) + 1);
	return true;
}
