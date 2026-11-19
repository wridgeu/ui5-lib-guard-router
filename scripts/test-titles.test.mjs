import assert from "node:assert/strict";
import { test } from "node:test";
import { testTitles } from "./test-titles.mjs";

await test("a test title is read from either kind of quotes", () => {
	const source = String.raw`
		QUnit.test("double \"quoted\" title", function () {});
		QUnit.test('single "quoted" title', function () {});
		it('it\'s a title', () => {});
		parityTest(
			'title on its own line',
		);
	`;
	assert.deepEqual(
		[...testTitles(source)],
		['double "quoted" title', 'single "quoted" title', "it's a title", "title on its own line"],
	);
});
