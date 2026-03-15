/**
 * Custom oxlint JS plugin: project guardrails.
 *
 * Catches em-dashes (AI-generated text), double type assertions,
 * and flaky test waits.
 *
 * @see https://oxc.rs/docs/guide/usage/linter/writing-js-plugins
 */

// ── Em-dash detection ──

// Built at runtime so the rule source itself does not contain the character.
const EM_DASH = String.fromCodePoint(0x2014);
const EM_DASH_RE = new RegExp(EM_DASH, "g");

/**
 * Flags em-dashes (U+2014) in string literals. Auto-fixes to "-".
 */
const noEmDashInString = {
	meta: {
		type: "suggestion",
		fixable: "code",
		docs: { description: "Disallow em-dashes in string literals" },
		messages: {
			found: "String contains an em-dash (U+2014). Use a regular dash (-) instead.",
		},
		schema: [],
	},
	create(context) {
		return {
			Literal(node) {
				if (typeof node.value === "string" && node.value.includes(EM_DASH)) {
					context.report({
						node,
						messageId: "found",
						fix(fixer) {
							return fixer.replaceText(node, context.sourceCode.getText(node).replace(EM_DASH_RE, "-"));
						},
					});
				}
			},
			TemplateLiteral(node) {
				for (const quasi of node.quasis) {
					if (quasi.value.raw.includes(EM_DASH)) {
						context.report({
							node,
							messageId: "found",
							fix(fixer) {
								return fixer.replaceText(
									node,
									context.sourceCode.getText(node).replace(EM_DASH_RE, "-"),
								);
							},
						});
						break;
					}
				}
			},
		};
	},
};

/**
 * Flags em-dashes (U+2014) in comments. Auto-fixes to "--".
 */
const noEmDashInComment = {
	meta: {
		type: "suggestion",
		fixable: "code",
		docs: { description: "Disallow em-dashes in comments" },
		messages: {
			found: "Comment contains an em-dash (U+2014). Use -- instead.",
		},
		schema: [],
	},
	create(context) {
		return {
			Program() {
				for (const comment of context.sourceCode.getAllComments()) {
					if (!comment.value.includes(EM_DASH)) continue;
					context.report({
						node: comment,
						messageId: "found",
						fix(fixer) {
							const prefix = comment.type === "Line" ? "//" : "/*";
							const suffix = comment.type === "Line" ? "" : "*/";
							const fixed = comment.value.replace(EM_DASH_RE, "--");
							return fixer.replaceTextRange(comment.range, `${prefix}${fixed}${suffix}`);
						},
					});
				}
			},
		};
	},
};

// ── Type safety ──

/**
 * Flags `x as unknown as T` double type-assertion chains.
 */
const noDoubleTypeAssertion = {
	meta: {
		type: "problem",
		docs: { description: "Disallow double type assertions (as unknown as T)" },
		messages: {
			found: "Avoid double type assertions (as unknown as T). Use proper type narrowing instead.",
		},
		schema: [],
	},
	create(context) {
		return {
			TSAsExpression(node) {
				if (node.expression?.type === "TSAsExpression") {
					context.report({ node, messageId: "found" });
				}
			},
		};
	},
};

// ── Test stability ──

/**
 * Flags `browser.pause()` calls that introduce flaky waits.
 */
const noBrowserPause = {
	meta: {
		type: "problem",
		docs: { description: "Disallow browser.pause() in tests" },
		messages: {
			found: "Use waitUntil/waitFor* conditions instead of browser.pause().",
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
					context.report({ node, messageId: "found" });
				}
			},
		};
	},
};

/**
 * Flags `await new Promise(resolve => setTimeout(resolve, N))` where N > 0.
 * Allows `setTimeout(resolve, 0)` (microtask flush, not a hard wait).
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

const noHardWait = {
	meta: {
		type: "problem",
		docs: { description: "Disallow await setTimeout sleeps in e2e tests" },
		messages: {
			found: "Use waitUntil/waitFor* conditions instead of fixed setTimeout sleeps in e2e tests.",
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
					context.report({ node, messageId: "found" });
				}
			},
		};
	},
};

/** @type {import('eslint').ESLint.Plugin} */
export default {
	meta: { name: "guardrails" },
	rules: {
		"no-em-dash-in-string": noEmDashInString,
		"no-em-dash-in-comment": noEmDashInComment,
		"no-double-type-assertion": noDoubleTypeAssertion,
		"no-browser-pause": noBrowserPause,
		"no-hard-wait": noHardWait,
	},
};
