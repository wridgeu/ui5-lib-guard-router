import {
	expandForNewRoute,
	expandToDescendants,
	isPatternAncestor,
	patternSegments,
} from "ui5/guard/router/PatternTree";

QUnit.module("PatternTree - patternSegments");

QUnit.test("keeps mandatory segments and drops empty, optional and rest segments", function (assert) {
	assert.deepEqual(patternSegments("/a//{id}/:opt:/:rest*:/b/"), ["a", "{id}", "b"]);
});

QUnit.test("strips inline query suffixes", function (assert) {
	assert.deepEqual(patternSegments("product{?query}/{id}:?query:"), ["product", "{id}"]);
	assert.deepEqual(patternSegments("product:?opt:{?req}"), ["product"]);
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
	assert.strictEqual(isPatternAncestor("a/{id}-summary", "a/{other}-details/x"), false);
	assert.strictEqual(isPatternAncestor("a/{id}", "a/{id}-details/x"), false);
});

const ROUTES = [
	{ name: "home", pattern: "" },
	{ name: "employees", pattern: "employees" },
	{ name: "employee", pattern: "employees/{id}" },
	{ name: "resume", pattern: "employees/{id}/resume" },
	{ name: "other", pattern: "other" },
];

QUnit.module("PatternTree - expandToDescendants");

QUnit.test("copies route entries to descendants, ancestors' entries first", function (assert) {
	const entries = [
		{ route: "employee", id: "e" },
		{ route: "employees", id: "s" },
		{ route: "unknown", id: "u" },
	];
	assert.deepEqual(expandToDescendants(entries, ROUTES), [
		{ route: "unknown", id: "u" },
		{ route: "employees", id: "s" },
		{ route: "employee", id: "s" },
		{ route: "resume", id: "s" },
		{ route: "employee", id: "e" },
		{ route: "resume", id: "e" },
	]);
});

QUnit.test("entries of routes at the same depth keep their declaration order", function (assert) {
	const entries = [
		{ route: "other", id: "o" },
		{ route: "employees", id: "s2" },
		{ route: "employees", id: "s1" },
	];
	assert.deepEqual(
		expandToDescendants(entries, ROUTES).filter((entry) => entry.route === "employee"),
		[
			{ route: "employee", id: "s2" },
			{ route: "employee", id: "s1" },
		],
	);
});

QUnit.test("keeps global entries without copying them", function (assert) {
	const expanded = expandToDescendants([{ route: "*" }, { route: "employee" }], ROUTES);
	assert.deepEqual(
		expanded.filter((entry) => entry.route === "*"),
		[{ route: "*" }],
	);
	assert.strictEqual(expanded.length, 3);
});

QUnit.test("an entry of the empty-pattern route is not copied to that route again", function (assert) {
	assert.deepEqual(
		expandToDescendants([{ route: "home" }], ROUTES),
		ROUTES.map(({ name }) => ({ route: name })),
	);
});

QUnit.test('global entries are not copied even when a route is named "*"', function (assert) {
	const routes = [
		{ name: "*", pattern: "a" },
		{ name: "child", pattern: "a/b" },
	];
	assert.deepEqual(expandToDescendants([{ route: "*" }], routes), [{ route: "*" }]);
	assert.deepEqual(expandForNewRoute([{ route: "*" }], "child", routes), []);
});

QUnit.test("without known routes the entries are returned as they are", function (assert) {
	const entries = [{ route: "employee" }];
	assert.strictEqual(expandToDescendants(entries, []), entries);
});

QUnit.module("PatternTree - expandForNewRoute");

QUnit.test("a new route inherits its ancestors' entries, the shallowest ancestor's first", function (assert) {
	const entries = [
		{ route: "employee", id: "e" },
		{ route: "*", id: "g" },
		{ route: "employees", id: "s" },
		{ route: "other", id: "o" },
	];
	assert.deepEqual(expandForNewRoute(entries, "resume", ROUTES), [
		{ route: "resume", id: "s" },
		{ route: "resume", id: "e" },
	]);
});

QUnit.test("a new route's own entries go to its existing descendants", function (assert) {
	assert.deepEqual(expandForNewRoute([{ route: "employees" }], "employees", ROUTES), [
		{ route: "employee" },
		{ route: "resume" },
	]);
});

QUnit.test("a new empty-pattern route's entries go to every other route, not to itself", function (assert) {
	const routes = ROUTES.toReversed();
	assert.deepEqual(
		expandForNewRoute([{ route: "home" }], "home", routes),
		routes.filter(({ name }) => name !== "home").map(({ name }) => ({ route: name })),
	);
});

QUnit.test("a new route without a known pattern inherits nothing", function (assert) {
	assert.deepEqual(expandForNewRoute([{ route: "employees" }], "missing", ROUTES), []);
});
