import Log from "sap/base/Log";
import type { GuardContext, GuardResult } from "ui5/guard/router/types";

const LOG_COMPONENT = "demo.app.guards";

/**
 * Global navigation logger guard (manifest-declared).
 *
 * Runs for every navigation via the `"*"` wildcard in the manifest
 * `guardRouter.guards` block. Always allows navigation but logs the
 * transition for observability.
 *
 * Demonstrates reading `toMeta` and `fromMeta` from the guard context.
 * With `inheritance: "pattern-tree"` enabled, child routes inherit
 * metadata from ancestor routes automatically.
 *
 * Note: Uses Log.info() which may be filtered in browser console by default.
 * Set console log level to "Info" or use sap-ui-log-level=INFO URL parameter.
 */
export default function navigationLogger(context: GuardContext): GuardResult {
	const from = context.fromRoute || "(initial)";
	const to = context.toRoute || "(no match)";
	const metaKeys = Object.keys(context.toMeta);
	const metaInfo = metaKeys.length > 0 ? ` [meta: ${metaKeys.join(", ")}]` : "";
	Log.info(`Navigation logger: ${from} → ${to}${metaInfo}`, "", LOG_COMPONENT);
	return true;
}
