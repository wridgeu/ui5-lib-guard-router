import type { GuardContext, GuardResult } from "ui5/guard/router/types";
export default function bagReaderGuard(context: GuardContext): GuardResult {
	return context.bag.has("writer");
}
