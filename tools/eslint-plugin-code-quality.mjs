/**
 * Custom oxlint JS plugin that catches AI-generated code anti-patterns.
 *
 * Detects common patterns left behind by AI coding assistants:
 * double type assertions, console-only error handling, redundant
 * boolean returns, and em-dashes in string literals.
 *
 * @see https://oxc.rs/docs/guide/usage/linter/writing-js-plugins
 */

/**
 * Detects `x as unknown as T` double type-assertion chains.
 *
 * AI assistants reach for double assertions instead of proper type
 * narrowing (type guards, `in` checks, `.isA()` etc.). This rule
 * flags the pattern so it can be replaced with safe narrowing.
 *
 * Inspired by unguard's no-type-assertion / no-inline-type-assertion.
 */
const noDoubleTypeAssertion = {
	meta: {
		type: "problem",
		docs: {
			description: "Disallow double type assertions (as unknown as T)",
		},
		messages: {
			noDoubleTypeAssertion:
				"Avoid double type assertions (as unknown as T). Use proper type narrowing (type guards, `in` checks, or .isA()) instead.",
		},
		schema: [],
	},
	create(context) {
		return {
			TSAsExpression(node) {
				if (node.expression?.type === "TSAsExpression") {
					context.report({ node, messageId: "noDoubleTypeAssertion" });
				}
			},
		};
	},
};

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
 * the inverse. Auto-fix wraps with `!!` to preserve boolean return type
 * when the condition might not already be a boolean.
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
					context.report({
						node,
						messageId: "noRedundantBooleanReturn",
						fix(fixer) {
							const condText = context.sourceCode.getText(node.test);
							// if (cond) return true; else return false; -> return !!cond;
							// if (cond) return false; else return true; -> return !cond;
							// Uses !! to preserve boolean return type when cond may not be boolean.
							const replacement = consequent.value
								? `return !!${maybeWrap(condText)};`
								: `return !${maybeWrap(condText)};`;
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

/** Wraps compound expressions in parens so `!a || b` becomes `!(a || b)`. */
function maybeWrap(text) {
	return /[|&?]/.test(text) ? `(${text})` : text;
}

// Em-dash character built at runtime so the rule does not flag itself.
const EM_DASH = String.fromCodePoint(0x2014);

/**
 * Detects em-dashes (U+2014) in string literals.
 *
 * Em-dashes in code strings are a strong signal of AI-generated text
 * that was pasted in without review. Regular dashes (-) or explicit
 * unicode escapes should be used instead.
 */
const EM_DASH_RE = /\u2014/g;

const noEmDashInString = {
	meta: {
		type: "suggestion",
		fixable: "code",
		docs: {
			description: "Disallow em-dashes in string literals",
		},
		messages: {
			noEmDashInString: "String contains an em-dash (U+2014). Use a regular dash (-) instead.",
		},
		schema: [],
	},
	create(context) {
		return {
			Literal(node) {
				if (typeof node.value === "string" && node.value.includes(EM_DASH)) {
					context.report({
						node,
						messageId: "noEmDashInString",
						fix(fixer) {
							const raw = context.sourceCode.getText(node);
							return fixer.replaceText(node, raw.replace(EM_DASH_RE, "-"));
						},
					});
				}
			},
			TemplateLiteral(node) {
				for (const quasi of node.quasis) {
					if (quasi.value.raw.includes(EM_DASH)) {
						context.report({
							node,
							messageId: "noEmDashInString",
							fix(fixer) {
								const raw = context.sourceCode.getText(node);
								return fixer.replaceText(node, raw.replace(EM_DASH_RE, "-"));
							},
						});
						break;
					}
				}
			},
		};
	},
};

/** @type {import('eslint').ESLint.Plugin} */
export default {
	meta: { name: "code-quality" },
	rules: {
		"no-double-type-assertion": noDoubleTypeAssertion,
		"no-console-only-catch": noConsoleOnlyCatch,
		"no-redundant-boolean-return": noRedundantBooleanReturn,
		"no-em-dash-in-string": noEmDashInString,
	},
};
