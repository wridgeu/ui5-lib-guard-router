import type { GuardContext, GuardResult } from "ui5/guard/router/types";
export default function metaWriterGuard(context: GuardContext): GuardResult {
	context.meta.set("writer", "was-here");
	return true;
}
