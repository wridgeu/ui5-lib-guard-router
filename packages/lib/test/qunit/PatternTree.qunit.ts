import { isPatternAncestor, patternSegments } from "ui5/guard/router/PatternTree";

QUnit.module("PatternTree - patternSegments");

QUnit.test("keeps mandatory segments and drops empty, optional and rest segments", function (assert) {
	assert.deepEqual(patternSegments("/a//{id}/:opt:/:rest*:/b/"), ["a", "{id}", "b"]);
});

QUnit.test("strips inline query suffixes", function (assert) {
	assert.deepEqual(patternSegments("product{?query}/{id}:?query:"), ["product", "{id}"]);
});

QUnit.test("keeps segments that only contain colons in other places", function (assert) {
	assert.deepEqual(patternSegments("file:v:/:opt:tail"), ["file:v:", ":opt:tail"]);
});

QUnit.module("PatternTree - isPatternAncestor");

QUnit.test("the empty pattern is an ancestor of every pattern", function (assert) {
	assert.strictEqual(isPatternAncestor("", "a"), true);
	assert.strictEqual(isPatternAncestor("", ""), true);
});

QUnit.test("a pattern without mandatory segments is no ancestor", function (assert) {
	assert.strictEqual(isPatternAncestor(":opt:", "a/b"), false);
});

QUnit.test("a pattern is not its own ancestor", function (assert) {
	assert.strictEqual(isPatternAncestor("a/b", "a/b"), false);
	assert.strictEqual(isPatternAncestor("a/b", "a/c"), false);
});

QUnit.test("every ancestor segment must match its position", function (assert) {
	assert.strictEqual(isPatternAncestor("a/b", "a/b/c"), true);
	assert.strictEqual(isPatternAncestor("a/b", "a/c/d"), false);
	assert.strictEqual(isPatternAncestor("a", "b/c"), false);
});

QUnit.test("mandatory parameters match each other regardless of name", function (assert) {
	assert.strictEqual(isPatternAncestor("employees/{empId}", "employees/{id}/resume"), true);
	assert.strictEqual(isPatternAncestor("{id}", "x/y"), false);
	assert.strictEqual(isPatternAncestor("x", "{id}/y"), false);
});
