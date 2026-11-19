import assert from "node:assert/strict";
import { test } from "node:test";
import plugin from "./eslint-plugin-comment-quality.mjs";

/** Runs one rule over line comments and returns the texts of the reported ones. */
function reported(ruleName, ...values) {
	const reports = [];
	const context = {
		sourceCode: { getAllComments: () => values.map((value) => ({ type: "Line", value })) },
		report: ({ node }) => reports.push(node.value),
	};
	plugin.rules[ruleName].create(context).Program();
	return reports;
}

/** The time one rule takes for one comment, in milliseconds. */
function elapsed(ruleName, value) {
	const start = performance.now();
	reported(ruleName, value);
	return performance.now() - start;
}

await test("no-section-divider takes linear time for underscores that end in no label", () => {
	const adversarial = `---${"_".repeat(5000)}!`;
	assert.ok(elapsed("no-section-divider", adversarial) < 1000, "5000 underscores are checked within a second");
	assert.deepEqual(reported("no-section-divider", adversarial), []);
	const dividers = [" --- Helpers ---", " =====", " ### Route guards", " --- snake_case label ___"];
	assert.deepEqual(reported("no-section-divider", ...dividers, " --- not a divider!", " plain text"), dividers);
});

await test("the comment text is read in linear time for a comment of empty lines", () => {
	const adversarial = `${"\n".repeat(150000)}x`;
	assert.ok(elapsed("no-section-divider", adversarial) < 1000, "150000 empty lines are read within a second");
	assert.deepEqual(reported("no-section-divider", "*\n * ---- Helpers ----\n "), ["*\n * ---- Helpers ----\n "]);
});

await test("a word that only starts like a directive does not exempt a comment", () => {
	assert.deepEqual(reported("no-hedging-comment", " hopefully the performance is ok"), [
		" hopefully the performance is ok",
	]);
	assert.deepEqual(
		reported("no-hedging-comment", " PERF: hopefully fast", " @typedef {string} Hopefully", " TODO fix this later"),
		[],
		"a directive still does",
	);
});
