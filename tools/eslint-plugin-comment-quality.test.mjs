import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";
import plugin from "./eslint-plugin-comment-quality.mjs";

// Every case has to finish within a second: a pattern that backtracks takes many seconds for the long comments below.
RuleTester.describe = (name, run) => {
	void describe(name, run);
};
RuleTester.it = (name, run) => {
	void it(name, () => {
		const start = performance.now();
		run();
		assert.ok(performance.now() - start < 1000, "the case is linted within a second");
	});
};

const tester = new RuleTester();
/** @param {string} comment */
const code = (comment) => `${comment}\nlet a;`;
/** @param {string} comment */
const divider = (comment) => ({ code: code(comment), errors: [{ messageId: "noSectionDivider" }] });

tester.run("no-section-divider", plugin.rules["no-section-divider"], {
	valid: [
		{ name: "5000 underscores that end in no label", code: code(`// ---${"_".repeat(5000)}!`) },
		{ name: "150000 empty lines", code: code(`/*${"\n".repeat(150000)}x*/`) },
		code("// --- not a divider!"),
		code("// plain text"),
	],
	invalid: [
		divider("// --- Helpers ---"),
		divider("// ====="),
		divider("// ### Route guards"),
		divider("// --- snake_case label ___"),
		divider("/*\n * ---- Helpers ----\n */"),
	],
});

tester.run("no-hedging-comment", plugin.rules["no-hedging-comment"], {
	valid: [code("// PERF: hopefully fast"), code("// @typedef {string} Hopefully"), code("// TODO fix this later")],
	invalid: [
		{
			name: "a word that only starts like a directive does not exempt a comment",
			code: code("// hopefully the performance is ok"),
			errors: [{ messageId: "noHedgingComment" }],
		},
	],
});

const obvious = "// increment counter\n\tcounter = increment(counter);";
tester.run("no-obvious-comment", plugin.rules["no-obvious-comment"], {
	valid: [
		{ name: "the comment names nothing of the next statement", code: "// increment counter\nlet other;" },
		{
			name: "the next statement is the one in the block of the comment",
			code: `function f() {\n\t// increment counter\n}\ncounter = increment(counter);`,
		},
	],
	invalid: [
		{ name: "a comment of the program", code: obvious, errors: [{ messageId: "noObviousComment" }] },
		{
			name: "a comment in a function body",
			code: `function f() {\n\t${obvious}\n}\nlet other;`,
			errors: [{ messageId: "noObviousComment" }],
		},
	],
});
