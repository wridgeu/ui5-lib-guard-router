/**
 * Custom oxlint JS plugin: catch blocks that only log, if/else that returns true/false,
 * and em-dashes in strings and comments.
 *
 * @see https://oxc.rs/docs/guide/usage/linter/writing-js-plugins
 */

/** @import { ESTree, Plugin, Rule } from "@oxlint/plugins" */

/**
 * Detects catch blocks where the only statement is a console call: such a catch swallows
 * the error. Re-throw, return a failure value, or recover.
 */
/** @type {Rule} */
const noConsoleOnlyCatch = {
	meta: {
		type: "problem",
		docs: {
			description: "Disallow catch blocks with only a console call",
		},
		messages: {
			noConsoleOnlyCatch:
				"Catch block only contains a console call. Re-throw the error, return a failure value, or add meaningful error handling.",
		},
		schema: [],
	},
	create(context) {
		return {
			CatchClause(node) {
				const body = node.body;
				if (body.body.length !== 1) return;

				const stmt = body.body[0];
				if (stmt.type !== "ExpressionStatement") return;

				const expr = stmt.expression;
				if (expr.type !== "CallExpression") return;

				const callee = expr.callee;
				if (
					callee.type === "MemberExpression" &&
					callee.object.type === "Identifier" &&
					callee.object.name === "console"
				) {
					context.report({ node, messageId: "noConsoleOnlyCatch" });
				}
			},
		};
	},
};

/**
 * Detects `if (cond) { return true; } else { return false; }` and
 * the inverse. Auto-fix always wraps the condition in parens to
 * preserve correct operator precedence for any expression type.
 *
 * Same-value branches (true/true or false/false) are dead code:
 * reported without auto-fix so the developer decides what was intended.
 */
/** @type {Rule} */
const noRedundantBooleanReturn = {
	meta: {
		type: "suggestion",
		fixable: "code",
		docs: {
			description: "Disallow if/else that just returns true/false",
		},
		messages: {
			noRedundantBooleanReturn: "Simplify to a direct boolean return instead of if/else with true/false.",
		},
		schema: [],
	},
	create(context) {
		return {
			IfStatement(node) {
				if (!node.alternate) return;

				const consequent = unwrapSingleReturn(node.consequent);
				const alternate = unwrapSingleReturn(node.alternate);
				if (!consequent || !alternate) return;

				if (isBooleanLiteral(consequent) && isBooleanLiteral(alternate)) {
					if (consequent.value === alternate.value) {
						context.report({ node, messageId: "noRedundantBooleanReturn" });
						return;
					}

					context.report({
						node,
						messageId: "noRedundantBooleanReturn",
						fix(fixer) {
							const condText = context.sourceCode.getText(node.test);
							const replacement = consequent.value ? `return !!(${condText});` : `return !(${condText});`;
							return fixer.replaceText(node, replacement);
						},
					});
				}
			},
		};
	},
};

/**
 * Extracts the return argument from a single-statement block or bare
 * return statement. Returns `undefined` when the shape doesn't match.
 *
 * @param {ESTree.Statement} node
 * @returns {ESTree.Expression | null | undefined}
 */
function unwrapSingleReturn(node) {
	if (node.type === "ReturnStatement") return node.argument;
	if (node.type === "BlockStatement" && node.body.length === 1) {
		const stmt = node.body[0];
		if (stmt.type === "ReturnStatement") return stmt.argument;
	}
	return undefined;
}

/**
 * @param {ESTree.Expression | null | undefined} node
 * @returns {node is ESTree.BooleanLiteral}
 */
function isBooleanLiteral(node) {
	return node?.type === "Literal" && typeof node.value === "boolean";
}

const EM_DASH = /\u2014/;
const EM_DASH_RE = /\u2014/g;

/**
 * Detects em-dashes (U+2014) in strings, template literals and comments.
 *
 * Auto-fix: replaces with `-` in strings, `--` in comments.
 */
/** @type {Rule} */
const noEmDash = {
	meta: {
		type: "suggestion",
		fixable: "code",
		docs: {
			description: "Disallow em-dashes (U+2014) in strings and comments",
		},
		messages: {
			emDashInString: "String contains an em-dash (U+2014). Use a regular dash (-) instead.",
			emDashInComment: "Comment contains an em-dash (U+2014). Use -- instead.",
		},
		schema: [],
	},
	create(context) {
		return {
			Literal(node) {
				if (typeof node.value === "string" && EM_DASH.test(node.value)) {
					context.report({
						node,
						messageId: "emDashInString",
						fix(fixer) {
							return fixer.replaceText(node, context.sourceCode.getText(node).replace(EM_DASH_RE, "-"));
						},
					});
				}
			},
			TemplateLiteral(node) {
				for (const quasi of node.quasis) {
					if (EM_DASH.test(quasi.value.raw)) {
						context.report({
							node,
							messageId: "emDashInString",
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
			Program() {
				for (const comment of context.sourceCode.getAllComments()) {
					if (!EM_DASH.test(comment.value)) continue;
					context.report({
						node: comment,
						messageId: "emDashInComment",
						fix(fixer) {
							// Replace only the content between delimiters to preserve
							// the original prefix (/** for JSDoc vs /* for block).
							const fixed = comment.value.replace(EM_DASH_RE, "--");
							if (comment.type === "Line") {
								return fixer.replaceTextRange([comment.range[0] + 2, comment.range[1]], fixed);
							}
							return fixer.replaceTextRange([comment.range[0] + 2, comment.range[1] - 2], fixed);
						},
					});
				}
			},
		};
	},
};

/** @type {Plugin} */
export default {
	meta: { name: "code-quality" },
	rules: {
		"no-console-only-catch": noConsoleOnlyCatch,
		"no-redundant-boolean-return": noRedundantBooleanReturn,
		"no-em-dash": noEmDash,
	},
};
