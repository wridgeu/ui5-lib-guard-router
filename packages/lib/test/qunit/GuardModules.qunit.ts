import Log from "sap/base/Log";
import { resolveModuleExports, runGuardsInOrder } from "ui5/guard/router/GuardModules";
import type { GuardContext, GuardFn } from "ui5/guard/router/types";

interface SinonTestContext {
	stub: sinon.SinonStubStatic;
}

const COMPONENT = "ui5.guard.router.Router";
const PATH = "app/guards/auth";
const a: GuardFn = () => true;
const b: GuardFn = () => true;

function messages(stub: sinon.SinonStub): string[] {
	return stub.getCalls().map((call) => {
		const [message, , component] = call.args as [string, unknown, string];
		return component === COMPONENT ? message : `${message} (component: ${component})`;
	});
}

function warned(detail: string): string[] {
	return [`guardRouter.guards: "${PATH}" ${detail}`];
}

QUnit.module("GuardModules - resolveModuleExports");

QUnit.test("function export", function (this: SinonTestContext, assert) {
	const debug = this.stub(Log, "debug");
	assert.deepEqual(resolveModuleExports(a, PATH), [a]);
	assert.strictEqual(debug.callCount, 0, "no key, no debug log");
	assert.deepEqual(resolveModuleExports(a, PATH, "x"), [a], "the export key is ignored");
	assert.deepEqual(messages(debug), [`guardRouter.guards: "${PATH}#x" is a single function, ignoring export key`]);
});

QUnit.test("array export", function (this: SinonTestContext, assert) {
	const warning = this.stub(Log, "warning");
	assert.deepEqual(resolveModuleExports([a, "x", b], PATH), [a, b]);
	assert.deepEqual(messages(warning), warned("[1] is not a function, skipping"));
});

QUnit.test("array export picked by index", function (this: SinonTestContext, assert) {
	const warning = this.stub(Log, "warning");
	assert.deepEqual(resolveModuleExports([a, b], PATH, "0"), [a]);
	assert.deepEqual(resolveModuleExports([a, b], PATH, "1"), [b]);
	assert.strictEqual(warning.callCount, 0);
	for (const key of ["2", "-1", "x"]) {
		warning.resetHistory();
		assert.deepEqual(resolveModuleExports([a, b], PATH, key), [], `#${key}`);
		assert.deepEqual(messages(warning), warned(`#${key} - index out of range, skipping`));
	}
	warning.resetHistory();
	assert.deepEqual(resolveModuleExports([a, "x"], PATH, "1"), []);
	assert.deepEqual(messages(warning), warned("#1 is not a function, skipping"));
});

QUnit.test("object export", function (this: SinonTestContext, assert) {
	const warning = this.stub(Log, "warning");
	assert.deepEqual(resolveModuleExports({ first: a, bad: 1, second: b }, PATH), [a, b]);
	assert.deepEqual(messages(warning), warned(".bad is not a function, skipping"));
});

QUnit.test("object export picked by key or index", function (this: SinonTestContext, assert) {
	const warning = this.stub(Log, "warning");
	const mod = { first: a, second: b };
	assert.deepEqual(resolveModuleExports(mod, PATH, "second"), [b]);
	assert.deepEqual(resolveModuleExports(mod, PATH, "0"), [a]);
	assert.deepEqual(resolveModuleExports(mod, PATH, "1"), [b]);
	assert.deepEqual(resolveModuleExports({ first: a, "1": b }, PATH, "1"), [b], "a key wins over an index");
	assert.strictEqual(warning.callCount, 0);
	for (const key of ["2", "-1", "missing"]) {
		warning.resetHistory();
		assert.deepEqual(resolveModuleExports(mod, PATH, key), [], `#${key}`);
		assert.deepEqual(messages(warning), warned(`#${key} - key not found, skipping`));
	}
	warning.resetHistory();
	assert.deepEqual(resolveModuleExports({ first: a, bad: 1 }, PATH, "bad"), []);
	assert.deepEqual(messages(warning), warned("#bad is not a function, skipping"));
});

QUnit.test("empty and unsupported exports", function (this: SinonTestContext, assert) {
	const warning = this.stub(Log, "warning");
	assert.deepEqual(resolveModuleExports([], PATH), []);
	assert.deepEqual(resolveModuleExports({}, PATH), []);
	assert.deepEqual(resolveModuleExports("x", PATH), []);
	assert.deepEqual(messages(warning), [
		...warned("exported an empty array, skipping"),
		...warned("exported an empty object, skipping"),
		...warned("did not export a function, array, or plain object, skipping"),
	]);
});

QUnit.module("GuardModules - runGuardsInOrder");

function createContext(signal = new AbortController().signal): GuardContext {
	return {
		toRoute: "t",
		toHash: "t",
		toArguments: {},
		toMeta: {},
		fromRoute: "",
		fromHash: "",
		fromMeta: {},
		signal,
		bag: new Map(),
	};
}

QUnit.test("runs synchronously and stops at the first result that is not true", function (assert) {
	const calls: string[] = [];
	const result = runGuardsInOrder(
		[() => (calls.push("a"), true), () => (calls.push("b"), "home"), () => (calls.push("c"), true)],
		createContext(),
	);
	assert.strictEqual(result, "home");
	assert.deepEqual(calls, ["a", "b"]);
	assert.strictEqual(runGuardsInOrder([], createContext()), true);
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
		createContext(),
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
		createContext(controller.signal),
	);
	controller.abort();
	assert.strictEqual(await result, false);
	assert.deepEqual(calls, ["a"]);
});
