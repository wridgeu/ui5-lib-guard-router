/**
 * The titles of the tests a source file declares with `QUnit.test()`, a `...Test()` helper or `it()`.
 *
 * @param {string} source
 * @returns {Set<string>}
 */
export function testTitles(source) {
	return new Set(
		[...source.matchAll(/\b(?:QUnit\.test|\w+Test|it)\(\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/g)].map(([, , title]) =>
			title.replace(/\\(.)/g, "$1"),
		),
	);
}
