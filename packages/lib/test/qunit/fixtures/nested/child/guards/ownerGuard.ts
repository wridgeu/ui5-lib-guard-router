import type { GuardContext, GuardResult } from "ui5/guard/router/types";
import probe from "./ownerProbe";

export default function ownerGuard(context: GuardContext): GuardResult | PromiseLike<GuardResult> {
	probe.owners.push(context.ownerComponent);
	return probe.decide?.(context) ?? true;
}
