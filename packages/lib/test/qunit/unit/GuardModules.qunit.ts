import Log from "sap/base/Log";
import { createLazyGuards, resolveModuleExports, runGuardsInOrder } from "ui5/guard/router/GuardModules";
import type { GuardFn } from "ui5/guard/router/types";
import { createGuardContext, loadModule, logMessages, type SinonTestContext } from "../testHelpers";

const PATH = "app/guards/auth";
const a: GuardFn = () => true;
const b: GuardFn = () => true;

function warned(detail: string): string[] {
	return [`guardRouter.guards: "${PATH}" ${detail}`];
}

QUnit.module("GuardModules - resolveModuleExports");

QUnit.test("function export", function (this: SinonTestContext, assert) {
	const debug = this.stub(Log, "debug");
	assert.deepEqual(resolveModuleExports(a, PATH), [{ name: "auth", fn: a }]);
	assert.strictEqual(debug.callCount, 0, "no key, no debug log");
	assert.deepEqual(resolveModuleExports(a, PATH, "x"), [{ name: "x", fn: a }], "the export key only names it");
	assert.deepEqual(logMessages(debug), [`guardRouter.guards: "${PATH}#x" is a single function, ignoring export key`]);
});

QUnit.test("array export", function (this: SinonTestContext, assert) {
	const warning = this.stub(Log, "warning");
	assert.deepEqual(resolveModuleExports([a, "x", b], PATH), [
		{ name: "auth#0", fn: a },
		{ name: "auth#2", fn: b },
	]);
	assert.deepEqual(logMessages(warning), warned("[1] is not a function, skipping"));
});

QUnit.test("array export picked by index", function (this: SinonTestContext, assert) {
	const warning = this.stub(Log, "warning");
	assert.deepEqual(resolveModuleExports([a, b], PATH, "0"), [{ name: "auth#0", fn: a }]);
	assert.deepEqual(resolveModuleExports([a, b], PATH, "1"), [{ name: "auth#1", fn: b }]);
	assert.deepEqual(
		resolveModuleExports([...Array<GuardFn>(10).fill(a), b], PATH, "10"),
		[{ name: "auth#10", fn: b }],
		"an index of several digits",
	);
	assert.strictEqual(warning.callCount, 0);
	for (const key of ["2", "-1", "x", "1x", "1.0", " 1"]) {
		warning.resetHistory();
		assert.deepEqual(resolveModuleExports([a, b], PATH, key), [], `#${key}`);
		assert.deepEqual(logMessages(warning), warned(`#${key} - index out of range, skipping`));
	}
	warning.resetHistory();
	assert.deepEqual(resolveModuleExports([a, "x"], PATH, "1"), []);
	assert.deepEqual(logMessages(warning), warned("#1 is not a function, skipping"));
});

QUnit.test("object export", function (this: SinonTestContext, assert) {
	const warning = this.stub(Log, "warning");
	assert.deepEqual(resolveModuleExports({ first: a, bad: 1, second: b }, PATH), [
		{ name: "first", fn: a },
		{ name: "second", fn: b },
	]);
	assert.deepEqual(logMessages(warning), warned(".bad is not a function, skipping"));
});

QUnit.test("object export picked by key or index", function (this: SinonTestContext, assert) {
	const warning = this.stub(Log, "warning");
	const mod = { first: a, second: b };
	assert.deepEqual(resolveModuleExports(mod, PATH, "second"), [{ name: "second", fn: b }]);
	assert.deepEqual(resolveModuleExports(mod, PATH, "0"), [{ name: "first", fn: a }]);
	assert.deepEqual(resolveModuleExports(mod, PATH, "1"), [{ name: "second", fn: b }]);
	assert.deepEqual(
		resolveModuleExports({ first: a, "1": b }, PATH, "1"),
		[{ name: "1", fn: b }],
		"a key wins over an index",
	);
	assert.strictEqual(warning.callCount, 0);
	for (const key of ["2", "-1", "missing", "1faGuard", "1.5", " 1"]) {
		warning.resetHistory();
		assert.deepEqual(resolveModuleExports(mod, PATH, key), [], `#${key}`);
		assert.deepEqual(logMessages(warning), warned(`#${key} - key not found, skipping`));
	}
	warning.resetHistory();
	assert.deepEqual(resolveModuleExports({ first: a, bad: 1 }, PATH, "bad"), []);
	assert.deepEqual(logMessages(warning), warned("#bad is not a function, skipping"));
});

QUnit.test(
	"named exports of a transpiled module are picked by key or index",
	async function (this: SinonTestContext, assert) {
		const warning = this.stub(Log, "warning");
		const path = "ui5/guard/router/qunit/fixtures/guards/namedExportGuard";
		const mod = await loadModule<{ namedFirst: GuardFn; namedSecond: GuardFn }>(path);
		assert.strictEqual(
			Reflect.get(mod, "__esModule"),
			true,
			"the module object holds the marker of the transpiler",
		);

		const first = { name: "namedFirst", fn: mod.namedFirst };
		const second = { name: "namedSecond", fn: mod.namedSecond };
		assert.deepEqual(resolveModuleExports(mod, path), [first, second], "the marker is no guard");
		assert.deepEqual(resolveModuleExports(mod, path, "0"), [first], "nor does it take a position");
		assert.deepEqual(resolveModuleExports(mod, path, "1"), [second]);
		assert.deepEqual(resolveModuleExports(mod, path, "namedSecond"), [second]);
		assert.strictEqual(warning.callCount, 0);
	},
);

QUnit.test("empty and unsupported exports", function (this: SinonTestContext, assert) {
	const warning = this.stub(Log, "warning");
	assert.deepEqual(resolveModuleExports([], PATH), []);
	assert.deepEqual(resolveModuleExports({}, PATH), []);
	assert.deepEqual(resolveModuleExports("x", PATH), []);
	assert.deepEqual(logMessages(warning), [
		...warned("exported an empty array, skipping"),
		...warned("exported an empty object, skipping"),
		...warned("did not export a function, array, or plain object, skipping"),
	]);
});

QUnit.module("GuardModules - runGuardsInOrder");

QUnit.test("runs synchronously and stops at the first result that is not true", function (assert) {
	const calls: string[] = [];
	const result = runGuardsInOrder(
		[() => (calls.push("a"), true), () => (calls.push("b"), "home"), () => (calls.push("c"), true)],
		createGuardContext(),
	);
	assert.strictEqual(result, "home");
	assert.deepEqual(calls, ["a", "b"]);
	assert.strictEqual(runGuardsInOrder([], createGuardContext()), true);
});

QUnit.test("continues after an async guard until a result is not true", async function (assert) {
	const calls: string[] = [];
	const result = runGuardsInOrder(
		[
			() => (calls.push("a"), Promise.resolve(true)),
			() => (calls.push("b"), true),
			() => (calls.push("c"), Promise.resolve(false)),
			() => (calls.push("d"), true),
		],
		createGuardContext(),
	);
	assert.strictEqual(result instanceof Promise, true);
	assert.strictEqual(await result, false);
	assert.deepEqual(calls, ["a", "b", "c"]);
});

QUnit.test("skips the remaining guards when the navigation is aborted while awaiting", async function (assert) {
	const controller = new AbortController();
	const calls: string[] = [];
	const result = runGuardsInOrder(
		[() => (calls.push("a"), Promise.resolve(true)), () => (calls.push("b"), true)],
		createGuardContext({ signal: controller.signal }),
	);
	controller.abort();
	assert.strictEqual(await result, false);
	assert.deepEqual(calls, ["a"]);
});

QUnit.module("GuardModules - createLazyGuards");

QUnit.test("a navigation aborted while the module loads resolves false and runs no guard", async function (assert) {
	const modulePath = "ui5/guard/router/qunit/fixtures/guards/lazyUncachedAbortGuard";
	const controller = new AbortController();
	const [wrapper] = createLazyGuards({ route: "t", type: "enter", modulePath });
	assert.strictEqual(sap.ui.require(modulePath), undefined, "module was not cached when the guard was created");

	const result = wrapper(createGuardContext({ signal: controller.signal }));
	controller.abort();
	assert.strictEqual(await result, false, "neither an allow nor the guard's own result");
	assert.strictEqual(await wrapper(createGuardContext()), "ran", "a later navigation runs the guard");
});
