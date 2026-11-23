import { composeHashChangeUndo, type HashChangeUndo, type HistoryStep } from "ui5/guard/router/HistoryUndo";

QUnit.module("HistoryUndo - composeHashChangeUndo");

QUnit.test("creates a fresh undo entry when no pending undo exists", function (assert: Assert) {
	const step: HistoryStep = { offset: -1, href: "https://example.test/#a" };
	const undo = composeHashChangeUndo(null, "a", step);

	assert.deepEqual(undo, {
		first: "a",
		fullHash: undefined,
		shown: "a",
		step,
		started: false,
	});
});

QUnit.test("combines step offsets when superseding a pending undo", function (assert: Assert) {
	const pending: HashChangeUndo = {
		first: "b",
		fullHash: "a",
		shown: "b",
		step: { offset: -1, href: "https://example.test/#b" },
		started: false,
	};
	const second: HistoryStep = { offset: -1, href: "https://example.test/#c" };
	const combined = composeHashChangeUndo(pending, "c", second);

	assert.deepEqual(combined, {
		first: "b",
		fullHash: "a",
		shown: "c",
		step: { offset: -2, href: "https://example.test/#c" },
		started: false,
	});
});

QUnit.test("drops step when combined offsets cancel out or either change is not a step", function (assert: Assert) {
	const pending: HashChangeUndo = {
		first: "b",
		fullHash: "a",
		shown: "b",
		step: { offset: -1, href: "https://example.test/#b" },
		started: false,
	};
	const cancelled = composeHashChangeUndo(pending, "a", { offset: 1, href: "https://example.test/#a" });
	assert.strictEqual(cancelled.step, null, "opposite steps cancel out to null");

	const nonStep = composeHashChangeUndo(pending, "c", null);
	assert.strictEqual(nonStep.step, null, "non-step clears step");

	const pendingNonStep: HashChangeUndo = { first: "b", fullHash: "a", shown: "b", step: null, started: false };
	const afterNonStep = composeHashChangeUndo(pendingNonStep, "c", { offset: -1, href: "https://example.test/#c" });
	assert.strictEqual(afterNonStep.step, null, "step after non-step stays null");
});
