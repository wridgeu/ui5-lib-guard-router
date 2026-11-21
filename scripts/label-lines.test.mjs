import assert from "node:assert/strict";
import { test } from "node:test";
import { longLabelLines } from "./label-lines.mjs";

await test("a flowchart node line may take a tenth of the wrapping width in characters, 120px without one", () => {
	const chart = `flowchart TD
    a["twelve chars<br/>thirteen char"]
    subgraph s ["a subgraph title is never wrapped"]
    end
`;
	assert.deepEqual(longLabelLines(chart), ['"thirteen char" is longer than 12 characters']);
	assert.deepEqual(longLabelLines(`---\nconfig:\n  flowchart:\n    wrappingWidth: 300\n---\n${chart}`), []);
});

await test("a flowchart edge label line and a state transition line may take 20 characters", () => {
	assert.deepEqual(
		longLabelLines(`flowchart TD\n    a -- "twenty characters ok" --> b\n    a -. "twenty-one characters" .-> b\n`),
		['"twenty-one characters" is longer than 20 characters'],
	);
	assert.deepEqual(
		longLabelLines(
			"stateDiagram-v2\n    a --> b: twenty-one characters<br/>short\n    b --> a: twenty characters ok\n",
		),
		['"twenty-one characters" is longer than 20 characters'],
	);
});

await test("a sequence diagram is not checked: its text is not wrapped", () => {
	assert.deepEqual(longLabelLines("sequenceDiagram\n    A->>B: a message far longer than any wrapping width\n"), []);
});
