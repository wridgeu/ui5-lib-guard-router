import sinon from "sinon";
import Log from "sap/base/Log";
import GuardPipeline from "ui5/guard/router/GuardPipeline";
import type { GuardContext, GuardFn, LeaveGuardFn } from "ui5/guard/router/types";

function createContext(overrides: Partial<GuardContext> = {}): GuardContext {
	return {
		toRoute: "target",
		toHash: "target",
		toArguments: {},
		fromRoute: "current",
		fromHash: "current",
		signal: new AbortController().signal,
		...overrides,
	};
}

// ============================================================
// Module: evaluate
// ============================================================
QUnit.module("GuardPipeline - evaluate");

QUnit.test("empty pipeline allows navigation", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const result = pipeline.evaluate(createContext(), "current");
	assert.deepEqual(result, { action: "allow" }, "No guards means allow");
});

QUnit.test("empty pipeline allows when currentRoute is empty string", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const result = pipeline.evaluate(createContext({ fromRoute: "" }), "");
	assert.deepEqual(result, { action: "allow" }, "Initial navigation with no guards allows");
});

// ============================================================
// Module: guard management
// ============================================================
QUnit.module("GuardPipeline - guard management");

QUnit.test("clear removes all guards", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => false);
	pipeline.addEnterGuard("target", () => false);
	pipeline.addLeaveGuard("current", () => false);

	pipeline.clear();

	const result = pipeline.evaluate(createContext(), "current");
	assert.deepEqual(result, { action: "allow" }, "All guards cleared");
});

QUnit.test("removeGlobalGuard removes by reference", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const guard: GuardFn = () => false;
	pipeline.addGlobalGuard(guard);
	pipeline.removeGlobalGuard(guard);

	const result = pipeline.evaluate(createContext(), "");
	assert.deepEqual(result, { action: "allow" }, "Guard removed, navigation allowed");
});

QUnit.test("removeEnterGuard removes by reference", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const guard: GuardFn = () => false;
	pipeline.addEnterGuard("target", guard);
	pipeline.removeEnterGuard("target", guard);

	const result = pipeline.evaluate(createContext(), "");
	assert.deepEqual(result, { action: "allow" }, "Enter guard removed");
});

QUnit.test("removeLeaveGuard removes by reference", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const guard: LeaveGuardFn = () => false;
	pipeline.addLeaveGuard("current", guard);
	pipeline.removeLeaveGuard("current", guard);

	const result = pipeline.evaluate(createContext(), "current");
	assert.deepEqual(result, { action: "allow" }, "Leave guard removed");
});

// ============================================================
// Module: global guards
// ============================================================
QUnit.module("GuardPipeline - global guards");

QUnit.test("global guard returning true allows", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => true);
	const result = pipeline.evaluate(createContext(), "");
	assert.deepEqual(result, { action: "allow" });
});

QUnit.test("global guard returning false blocks", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => false);
	const result = pipeline.evaluate(createContext(), "");
	assert.deepEqual(result, { action: "block" });
});

QUnit.test("global guard returning string redirects", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => "login");
	const result = pipeline.evaluate(createContext(), "");
	assert.deepEqual(result, { action: "redirect", target: "login" });
});

QUnit.test("global guard returning GuardRedirect object redirects", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const redirect = { route: "login", parameters: { reason: "auth" } };
	pipeline.addGlobalGuard(() => redirect);
	const result = pipeline.evaluate(createContext(), "");
	assert.deepEqual(result, { action: "redirect", target: redirect });
});

QUnit.test("first non-true global guard short-circuits", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const calls: number[] = [];
	pipeline.addGlobalGuard(() => {
		calls.push(1);
		return true;
	});
	pipeline.addGlobalGuard(() => {
		calls.push(2);
		return false;
	});
	pipeline.addGlobalGuard(() => {
		calls.push(3);
		return true;
	});

	pipeline.evaluate(createContext(), "");
	assert.deepEqual(calls, [1, 2], "Third guard never called");
});

// ============================================================
// Module: route enter guards
// ============================================================
QUnit.module("GuardPipeline - route enter guards");

QUnit.test("route enter guard blocks", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addEnterGuard("target", () => false);
	const result = pipeline.evaluate(createContext(), "");
	assert.deepEqual(result, { action: "block" });
});

QUnit.test("route enter guard redirects", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addEnterGuard("target", () => "other");
	const result = pipeline.evaluate(createContext(), "");
	assert.deepEqual(result, { action: "redirect", target: "other" });
});

QUnit.test("global guards run before route guards", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const order: string[] = [];
	pipeline.addGlobalGuard(() => {
		order.push("global");
		return true;
	});
	pipeline.addEnterGuard("target", () => {
		order.push("route");
		return true;
	});

	pipeline.evaluate(createContext(), "");
	assert.deepEqual(order, ["global", "route"]);
});

QUnit.test("route guard skipped when global guard blocks", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const called: string[] = [];
	pipeline.addGlobalGuard(() => {
		called.push("global");
		return false;
	});
	pipeline.addEnterGuard("target", () => {
		called.push("route");
		return true;
	});

	pipeline.evaluate(createContext(), "");
	assert.deepEqual(called, ["global"], "Route guard never called");
});

// ============================================================
// Module: leave guards
// ============================================================
QUnit.module("GuardPipeline - leave guards");

QUnit.test("leave guard blocks navigation", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addLeaveGuard("current", () => false);
	const result = pipeline.evaluate(createContext(), "current");
	assert.deepEqual(result, { action: "block" });
});

QUnit.test("leave guard allows, then enter guards run", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const order: string[] = [];
	pipeline.addLeaveGuard("current", () => {
		order.push("leave");
		return true;
	});
	pipeline.addGlobalGuard(() => {
		order.push("global");
		return true;
	});
	pipeline.addEnterGuard("target", () => {
		order.push("route");
		return true;
	});

	pipeline.evaluate(createContext(), "current");
	assert.deepEqual(order, ["leave", "global", "route"]);
});

QUnit.test("leave guards skipped when currentRoute is empty string", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addLeaveGuard("", () => false);
	const result = pipeline.evaluate(createContext({ fromRoute: "" }), "");
	assert.deepEqual(result, { action: "allow" }, "No leave guards checked for empty currentRoute");
});

QUnit.test("leave guard blocking skips enter guards", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const called: string[] = [];
	pipeline.addLeaveGuard("current", () => {
		called.push("leave");
		return false;
	});
	pipeline.addGlobalGuard(() => {
		called.push("global");
		return true;
	});

	pipeline.evaluate(createContext(), "current");
	assert.deepEqual(called, ["leave"], "Enter guards never called");
});

// ============================================================
// Module: validation
// ============================================================
QUnit.module("GuardPipeline - validation", {
	afterEach: function () {
		sinon.restore();
	},
});

QUnit.test("invalid guard return value treated as block", function (assert: Assert) {
	const warnStub = sinon.stub(Log, "warning");
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard((() => 42) as unknown as GuardFn);

	const result = pipeline.evaluate(createContext(), "");
	assert.deepEqual(result, { action: "block" });
	assert.ok(warnStub.calledOnce, "Warning logged");
});

QUnit.test("leave guard returning non-boolean treated as block", function (assert: Assert) {
	const warnStub = sinon.stub(Log, "warning");
	const pipeline = new GuardPipeline();
	pipeline.addLeaveGuard("current", (() => "nope") as unknown as LeaveGuardFn);

	const result = pipeline.evaluate(createContext(), "current");
	assert.deepEqual(result, { action: "block" });
	assert.ok(warnStub.calledOnce, "Warning logged for non-boolean leave guard");
});

QUnit.test("empty string guard return treated as block", function (assert: Assert) {
	sinon.stub(Log, "warning");
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard((() => "") as unknown as GuardFn);

	const result = pipeline.evaluate(createContext(), "");
	assert.deepEqual(result, { action: "block" });
});

// ============================================================
// Module: error handling
// ============================================================
QUnit.module("GuardPipeline - error handling", {
	afterEach: function () {
		sinon.restore();
	},
});

QUnit.test("sync guard that throws blocks navigation", function (assert: Assert) {
	const errorStub = sinon.stub(Log, "error");
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => {
		throw new Error("boom");
	});

	const result = pipeline.evaluate(createContext(), "");
	assert.deepEqual(result, { action: "block" });
	assert.ok(errorStub.calledOnce, "Error was logged");
});

QUnit.test("sync leave guard that throws blocks navigation", function (assert: Assert) {
	const errorStub = sinon.stub(Log, "error");
	const pipeline = new GuardPipeline();
	pipeline.addLeaveGuard("current", () => {
		throw new Error("leave boom");
	});

	const result = pipeline.evaluate(createContext(), "current");
	assert.deepEqual(result, { action: "block" });
	assert.ok(errorStub.calledOnce, "Error was logged");
});

QUnit.test("async guard that rejects blocks navigation", async function (assert: Assert) {
	const errorStub = sinon.stub(Log, "error");
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => Promise.reject(new Error("async boom")));

	const result = await pipeline.evaluate(createContext(), "");
	assert.deepEqual(result, { action: "block" });
	assert.ok(errorStub.calledOnce, "Error was logged");
});

QUnit.test("guard error after signal aborted does not log", async function (assert: Assert) {
	const errorStub = sinon.stub(Log, "error");
	const pipeline = new GuardPipeline();
	const controller = new AbortController();
	pipeline.addGlobalGuard(() => {
		controller.abort();
		return Promise.reject(new Error("aborted boom"));
	});

	const result = await pipeline.evaluate(createContext({ signal: controller.signal }), "");
	assert.deepEqual(result, { action: "block" });
	assert.ok(errorStub.notCalled, "Error suppressed when signal aborted");
});

// ============================================================
// Module: async
// ============================================================
QUnit.module("GuardPipeline - async");

QUnit.test("async global guard that allows", async function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => Promise.resolve(true));
	const result = await pipeline.evaluate(createContext(), "");
	assert.deepEqual(result, { action: "allow" });
});

QUnit.test("async global guard that blocks", async function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => Promise.resolve(false));
	const result = await pipeline.evaluate(createContext(), "");
	assert.deepEqual(result, { action: "block" });
});

QUnit.test("async global guard that redirects", async function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => Promise.resolve("login"));
	const result = await pipeline.evaluate(createContext(), "");
	assert.deepEqual(result, { action: "redirect", target: "login" });
});

QUnit.test("mixed sync-async pipeline", async function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const order: number[] = [];
	pipeline.addGlobalGuard(() => {
		order.push(1);
		return true;
	});
	pipeline.addGlobalGuard(() => {
		order.push(2);
		return Promise.resolve(true);
	});
	pipeline.addGlobalGuard(() => {
		order.push(3);
		return true;
	});

	const result = await pipeline.evaluate(createContext(), "");
	assert.deepEqual(result, { action: "allow" });
	assert.deepEqual(order, [1, 2, 3], "All guards ran in order");
});

QUnit.test("async leave guard blocks before enter guards", async function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const called: string[] = [];
	pipeline.addLeaveGuard("current", () => {
		called.push("leave");
		return Promise.resolve(false);
	});
	pipeline.addGlobalGuard(() => {
		called.push("global");
		return true;
	});

	const result = await pipeline.evaluate(createContext(), "current");
	assert.deepEqual(result, { action: "block" });
	assert.deepEqual(called, ["leave"], "Enter guards never called");
});

QUnit.test("abort signal checked between async guards", async function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const controller = new AbortController();
	const called: number[] = [];
	pipeline.addGlobalGuard(() => {
		called.push(1);
		controller.abort();
		return Promise.resolve(true);
	});
	pipeline.addGlobalGuard(() => {
		called.push(2);
		return true;
	});

	const result = await pipeline.evaluate(createContext({ signal: controller.signal }), "");
	assert.deepEqual(result, { action: "block" }, "Blocked due to abort");
	assert.deepEqual(called, [1], "Second guard never called");
});

// ============================================================
// Module: snapshot copy
// ============================================================
QUnit.module("GuardPipeline - snapshot copy");

QUnit.test("guard can remove itself during iteration", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const oneShotGuard: GuardFn = () => {
		pipeline.removeGlobalGuard(oneShotGuard);
		return true;
	};
	pipeline.addGlobalGuard(oneShotGuard);
	pipeline.addGlobalGuard(() => true);

	const result1 = pipeline.evaluate(createContext(), "");
	assert.deepEqual(result1, { action: "allow" }, "First call: both guards run, allow");

	const result2 = pipeline.evaluate(createContext(), "");
	assert.deepEqual(result2, { action: "allow" }, "Second call: one-shot removed, still allow");
});
