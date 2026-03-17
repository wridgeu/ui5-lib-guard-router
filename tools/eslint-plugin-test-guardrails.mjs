/**
 * Custom oxlint JS plugin that enforces test stability guardrails.
 *
 * Detects flaky hard-wait patterns in test files and guides towards
 * proper condition-based waiting (waitUntil / waitFor*).
 *
 * @see https://oxc.rs/docs/guide/usage/linter/writing-js-plugins
 */

/**
 * Reports `browser.pause()` calls that introduce flaky, time-based waits.
 *
 * Scope: all test files (configured via oxlintrc overrides).
 */
const noBrowserPause = {
	meta: {
		type: "problem",
		docs: {
			description: "Disallow browser.pause() in tests - use waitUntil/waitFor* instead",
		},
		messages: {
			noBrowserPause: "Use waitUntil/waitFor* conditions instead of browser.pause().",
		},
		schema: [],
	},
	create(context) {
		return {
			CallExpression(node) {
				const { callee } = node;
				if (
					callee.type === "MemberExpression" &&
					callee.object.type === "Identifier" &&
					callee.object.name === "browser" &&
					callee.property.type === "Identifier" &&
					callee.property.name === "pause"
				) {
					context.report({ node, messageId: "noBrowserPause" });
				}
			},
		};
	},
};

/**
 * Returns the inner call expression from an arrow/function callback body,
 * handling both concise (`resolve => fn()`) and block (`resolve => { fn(); }`)
 * forms. Returns `undefined` when the body doesn't match.
 */
function extractSingleCallFromBody(body) {
	if (body.type === "CallExpression") return body;
	if (body.type === "BlockStatement" && body.body.length === 1) {
		const stmt = body.body[0];
		if (stmt.type === "ExpressionStatement" && stmt.expression.type === "CallExpression") {
			return stmt.expression;
		}
	}
	return undefined;
}

/**
 * Reports `await new Promise(resolve => setTimeout(resolve, N))` where N > 0.
 *
 * Intentionally allows `setTimeout(resolve, 0)` since that's a microtask flush
 * pattern, not a hard wait.
 *
 * Scope: e2e test files only (configured via oxlintrc overrides).
 */
const noHardWait = {
	meta: {
		type: "problem",
		docs: {
			description: "Disallow await setTimeout sleeps in e2e tests - use waitUntil/waitFor* instead",
		},
		messages: {
			noHardWait: "Use waitUntil/waitFor* conditions instead of fixed setTimeout sleeps in e2e tests.",
		},
		schema: [],
	},
	create(context) {
		return {
			AwaitExpression(node) {
				const inner = node.argument;
				if (inner?.type !== "NewExpression") return;
				if (inner.callee.type !== "Identifier" || inner.callee.name !== "Promise") return;

				const args = inner.arguments;
				if (args?.length !== 1) return;

				const callback = args[0];
				if (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression") return;

				const callExpr = extractSingleCallFromBody(callback.body);
				if (!callExpr) return;

				if (callExpr.callee.type !== "Identifier" || callExpr.callee.name !== "setTimeout") return;
				if (callExpr.arguments?.length < 2) return;

				const delay = callExpr.arguments[1];
				if (delay.type === "Literal" && typeof delay.value === "number" && delay.value > 0) {
					context.report({ node, messageId: "noHardWait" });
				}
			},
		};
	},
};

/** @type {import('eslint').ESLint.Plugin} */
export default {
	meta: { name: "test-guardrails" },
	rules: {
		"no-browser-pause": noBrowserPause,
		"no-hard-wait": noHardWait,
	},
};
