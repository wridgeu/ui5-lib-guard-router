import type { GuardContext, GuardResult } from "ui5/guard/router/types";
import probe from "../parity/probe";

/** Allows every navigation and tells the parity probe whose router ran it. */
export default function allowGuard(context: GuardContext): GuardResult {
	probe.guardOwners.push(context.ownerComponent?.getId());
	return true;
}
