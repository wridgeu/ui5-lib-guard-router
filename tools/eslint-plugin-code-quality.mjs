/**
 * Custom oxlint JS plugin that catches AI-generated code anti-patterns.
 *
 * Detects common patterns left behind by AI coding assistants:
 * console-only error handling, redundant boolean returns, and
 * em-dashes in string literals.
 *
 * Type-assertion rules (no-as-any, no-double-type-assertion) have been
 * replaced by native typescript/no-explicit-any, no-unsafe-type-assertion,
 * and no-unnecessary-type-assertion.
 *
 * @see https://oxc.rs/docs/guide/usage/linter/writing-js-plugins
 */

/**
 * Detects catch blocks where the only statement is a console call.
 *
 * AI assistants routinely generate `catch (e) { console.error(e); }`
 * as "error handling" which silently swallows the error. The catch
 * should either re-throw, return an error value, or do meaningful
 * recovery.
 */
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
				if (!body || body.body.length !== 1) return;

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
							// Always wrap in parens so any expression (a === b, typeof x, etc.)
							// keeps correct precedence after the ! or !! prefix.
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
 */
function unwrapSingleReturn(node) {
	if (node.type === "ReturnStatement") return node.argument;
	if (node.type === "BlockStatement" && node.body.length === 1) {
		const stmt = node.body[0];
		if (stmt.type === "ReturnStatement") return stmt.argument;
	}
	return undefined;
}

function isBooleanLiteral(node) {
	return node?.type === "Literal" && typeof node.value === "boolean";
}

// Em-dash character built at runtime so the rule source does not contain it.
const EM_DASH = String.fromCodePoint(0x2014);
const EM_DASH_RE = new RegExp(EM_DASH, "g");

/**
 * Detects em-dashes (U+2014) in strings and/or comments.
 *
 * Em-dashes are a strong signal of AI-generated text that was pasted
 * without review. Configurable via `checkStrings` and `checkComments`
 * options (both default to true).
 *
 * Auto-fix: replaces with `-` in strings, `--` in comments.
 */
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
		schema: [
			{
				type: "object",
				properties: {
					checkStrings: { type: "boolean" },
					checkComments: { type: "boolean" },
				},
				additionalProperties: false,
			},
		],
	},
	create(context) {
		const opts = context.options[0] || {};
		const checkStrings = opts.checkStrings !== false;
		const checkComments = opts.checkComments !== false;

		const visitors = {};

		if (checkStrings) {
			visitors.Literal = function (node) {
				if (typeof node.value === "string" && node.value.includes(EM_DASH)) {
					context.report({
						node,
						messageId: "emDashInString",
						fix(fixer) {
							return fixer.replaceText(node, context.sourceCode.getText(node).replace(EM_DASH_RE, "-"));
						},
					});
				}
			};
			visitors.TemplateLiteral = function (node) {
				for (const quasi of node.quasis) {
					if (quasi.value.raw.includes(EM_DASH)) {
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
			};
		}

		if (checkComments) {
			visitors.Program = function () {
				for (const comment of context.sourceCode.getAllComments()) {
					if (!comment.value.includes(EM_DASH)) continue;
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
			};
		}

		return visitors;
	},
};

/** @type {import('eslint').ESLint.Plugin} */
export default {
	meta: { name: "code-quality" },
	rules: {
		"no-console-only-catch": noConsoleOnlyCatch,
		"no-redundant-boolean-return": noRedundantBooleanReturn,
		"no-em-dash": noEmDash,
	},
};
