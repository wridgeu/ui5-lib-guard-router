import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceNames } from "./source-names.mjs";

await test("the names of the code, also in strings and templates, but not in comments", () => {
	const names = sourceNames(String.raw`
		/** JSDoc of {@link inJSDoc}. @param inTag - text */
		function declared(parameter: TypeName): void {
			// inLineComment
			other.member("inString", ${"`inTemplate ${inExpression} tail`"}); /* inBlockComment */
		}
	`);
	assert.deepEqual(
		names.filter((name) => name.startsWith("in")),
		["inString", "inTemplate", "inExpression"],
	);
	for (const name of ["declared", "parameter", "TypeName", "other", "member", "tail"]) {
		assert.ok(names.includes(name), name);
	}
});
