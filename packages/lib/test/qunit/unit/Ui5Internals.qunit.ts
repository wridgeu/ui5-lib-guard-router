import { isPromiseResolver, isTitleHistoryEntry, withoutGuardRouter } from "ui5/guard/router/Ui5Internals";

QUnit.module("Ui5Internals - Promise resolve functions");

function createPromiseFunctions(): [(value?: unknown) => void, (reason?: unknown) => void] {
	let resolve!: (value?: unknown) => void;
	let reject!: (reason?: unknown) => void;
	void new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return [resolve, reject];
}

QUnit.test("the resolve function of a Promise is recognized by its exact shape", function (assert: Assert) {
	const [resolve] = createPromiseFunctions();

	assert.strictEqual(resolve.name, "", "it has no name");
	assert.strictEqual(resolve.length, 1, "it takes one argument");
	assert.strictEqual(
		Function.prototype.toString.call(resolve),
		"function () { [native code] }",
		"Chrome prints it as an anonymous built-in function",
	);
	assert.strictEqual(isPromiseResolver(resolve), true, "it is recognized");
});

QUnit.test("functions of any other shape are not Promise resolve functions", function (assert: Assert) {
	function named(event: unknown): unknown {
		return event;
	}
	const controller = {
		onRouteMatched(event: unknown): unknown {
			return event;
		},
	};
	const [resolve] = createPromiseFunctions();
	const others: [what: string, value: unknown][] = [
		// Without a name and with one parameter: only the source text tells them apart.
		["an arrow function", (event: unknown) => event],
		[
			"a function expression",
			function (event: unknown) {
				return event;
			},
		],
		[
			"a function whose code contains the text of a built-in",
			function (event: unknown) {
				return [event, "function () { [native code] }"];
			},
		],
		// Printed like a resolve function, with one parameter: only the name tells them apart.
		[
			"a bound function expression",
			function (this: unknown, event: unknown) {
				return [this, event];
			}.bind(undefined),
		],
		["a bound resolve function", resolve.bind(undefined)],
		// Printed like a resolve function, without a name: only the length tells it apart.
		["Function.prototype", Function.prototype],
		["a named function", named],
		["a bound named function", named.bind(undefined)],
		["a handler method", controller.onRouteMatched],
		["a handler method bound to its controller", controller.onRouteMatched.bind(controller)],
		["a sinon spy", sinon.spy()],
		["console.log", console.log],
		["Math.max", Math.max],
		["an object", {}],
		["undefined", undefined],
	];

	for (const [what, value] of others) {
		assert.strictEqual(isPromiseResolver(value), false, what);
	}
});

QUnit.test("the reject function of a Promise has the shape of its resolve function", function (assert: Assert) {
	const [, reject] = createPromiseFunctions();

	assert.strictEqual(isPromiseResolver(reject), true, "the documented false positive");
});

QUnit.module("Ui5Internals - withoutGuardRouter");

QUnit.test("hides guardRouter while forwarding reads and later additions", function (assert: Assert) {
	const original: Record<string, unknown> = { async: true, guardRouter: { inheritance: "pattern-tree" } };
	const view = withoutGuardRouter(original);

	assert.strictEqual("guardRouter" in view, false, "guardRouter is hidden from `in`");
	assert.strictEqual(Reflect.get(view, "guardRouter"), undefined, "guardRouter reads as undefined");
	assert.strictEqual(
		Object.getOwnPropertyDescriptor(view, "guardRouter"),
		undefined,
		"no descriptor for guardRouter",
	);
	assert.deepEqual(Object.keys(view), ["async"], "guardRouter is omitted from ownKeys");

	original.targetParent = "rootView";
	assert.strictEqual(Reflect.get(view, "targetParent"), "rootView", "later writes on the original are visible");
});

QUnit.module("Ui5Internals - TitleHistoryEntry");

QUnit.test("accepts valid title history entries and rejects malformed shapes", function (assert: Assert) {
	assert.strictEqual(isTitleHistoryEntry({ hash: "" }), true, "hash-only entry");
	assert.strictEqual(isTitleHistoryEntry({ hash: "home", title: "Home", isHome: true }), true, "full entry");
	assert.strictEqual(
		isTitleHistoryEntry({ hash: "a", title: undefined, isHome: undefined }),
		true,
		"optional fields undefined",
	);
	assert.strictEqual(isTitleHistoryEntry(null), false, "null");
	assert.strictEqual(isTitleHistoryEntry({}), false, "missing hash");
	assert.strictEqual(isTitleHistoryEntry({ hash: 42 }), false, "non-string hash");
	assert.strictEqual(isTitleHistoryEntry({ hash: "a", title: 123 }), false, "non-string title");
	assert.strictEqual(isTitleHistoryEntry({ hash: "a", isHome: "true" }), false, "non-boolean isHome");
});
