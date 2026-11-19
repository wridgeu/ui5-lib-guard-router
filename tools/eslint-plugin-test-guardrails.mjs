/**
 * Custom oxlint JS plugin that enforces test stability guardrails.
 *
 * Detects flaky hard-wait patterns in test files and guides towards
 * proper condition-based waiting (waitUntil / waitFor*), and timers of
 * any kind in unit tests.
 *
 * @see https://oxc.rs/docs/guide/usage/linter/writing-js-plugins
 */

import { definePlugin, defineRule } from "@oxlint/plugins";

/** @import { ESTree } from "@oxlint/plugins" */

/**
 * Reports `browser.pause()` calls that introduce flaky, time-based waits.
 *
 * Scope: all test files (configured via oxlintrc overrides).
 */
const noBrowserPause = defineRule({
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
});

/**
 * Returns the inner call expression from an arrow/function callback body,
 * handling both concise (`resolve => fn()`) and block (`resolve => { fn(); }`)
 * forms. Returns `undefined` when the body doesn't match.
 *
 * @param {ESTree.FunctionBody | ESTree.Expression | null} body
 * @returns {ESTree.CallExpression | undefined}
 */
function extractSingleCallFromBody(body) {
	if (body?.type === "CallExpression") return body;
	if (body?.type === "BlockStatement" && body.body.length === 1) {
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
 * Intentionally allows `setTimeout(resolve, 0)` since it yields to the event loop
 * once (a macrotask), not a timed wait.
 *
 * Scope: e2e test files only (configured via oxlintrc overrides).
 */
const noHardWait = defineRule({
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
				if (inner.type !== "NewExpression") return;
				if (inner.callee.type !== "Identifier" || inner.callee.name !== "Promise") return;

				const args = inner.arguments;
				if (args.length !== 1) return;

				const callback = args[0];
				if (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression") return;

				const callExpr = extractSingleCallFromBody(callback.body);
				if (!callExpr) return;

				if (callExpr.callee.type !== "Identifier" || callExpr.callee.name !== "setTimeout") return;
				if (callExpr.arguments.length < 2) return;

				const delay = callExpr.arguments[1];
				if (delay.type === "Literal" && typeof delay.value === "number" && delay.value > 0) {
					context.report({ node, messageId: "noHardWait" });
				}
			},
		};
	},
});

const TIMER_FUNCTIONS = new Set(["setTimeout", "setInterval"]);

/**
 * The name of the called function: `name()`, `window.name()` or `globalThis.name()`.
 *
 * @param {ESTree.Expression} callee
 * @returns {string | undefined}
 */
function calledGlobal(callee) {
	if (callee.type === "Identifier") return callee.name;
	if (callee.type !== "MemberExpression" || callee.object.type !== "Identifier") return undefined;
	if (callee.object.name !== "window" && callee.object.name !== "globalThis") return undefined;
	return callee.property.type === "Identifier" ? callee.property.name : undefined;
}

/**
 * Reports any `setTimeout` / `setInterval` call, including `window.` and `globalThis.` forms.
 *
 * A timer in a unit test either sleeps until the code under test is "probably" done
 * or races it, and both flake under load. Tests wait on what the code does instead.
 *
 * Scope: library QUnit test files (configured via oxlintrc overrides).
 */
const noTimers = defineRule({
	meta: {
		type: "problem",
		docs: {
			description: "Disallow timers in unit tests - wait on router events or test-controlled promises instead",
		},
		messages: {
			noTimers:
				"Do not use timers in unit tests. Await a router event or navigationSettled(), resolve a Promise.withResolvers() deferred, or use flushPromises().",
		},
		schema: [],
	},
	create(context) {
		return {
			CallExpression(node) {
				const name = calledGlobal(node.callee);
				if (name && TIMER_FUNCTIONS.has(name)) {
					context.report({ node, messageId: "noTimers" });
				}
			},
		};
	},
});

export default definePlugin({
	meta: { name: "test-guardrails" },
	rules: {
		"no-browser-pause": noBrowserPause,
		"no-hard-wait": noHardWait,
		"no-timers": noTimers,
	},
});
