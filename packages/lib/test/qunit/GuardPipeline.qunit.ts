import Log from "sap/base/Log";
import GuardPipeline from "ui5/guard/router/GuardPipeline";
import type { GuardContext, GuardFn, LeaveGuardFn } from "ui5/guard/router/types";

/**
 * Sinon-qunit-bridge injects `stub`, `spy`, `mock` onto the QUnit test
 * context (`this`) via a per-test sandbox that is auto-restored in afterEach.
 * Using `this.stub` (sandbox) rather than `sinon.stub` (global) ensures
 * stubs are cleaned up between tests without manual restore.
 */
interface SinonTestContext {
	stub: sinon.SinonStubStatic;
}

function createContext(overrides: Partial<GuardContext> = {}): GuardContext {
	return {
		toRoute: "target",
		toHash: "target",
		toArguments: {},
		fromRoute: "",
		fromHash: "",
		signal: new AbortController().signal,
		bag: new Map(),
		toMeta: Object.freeze({}),
		fromMeta: Object.freeze({}),
		...overrides,
	};
}

// ============================================================
// Module: evaluate
// ============================================================
QUnit.module("GuardPipeline - evaluate");

QUnit.test("empty pipeline allows navigation", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	assert.deepEqual(
		pipeline.evaluate(createContext({ fromRoute: "current" })),
		{ action: "allow" },
		"With active route",
	);
	assert.deepEqual(pipeline.evaluate(createContext()), { action: "allow" }, "Initial navigation (empty fromRoute)");
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

	const result = pipeline.evaluate(createContext({ fromRoute: "current" }));
	assert.deepEqual(result, { action: "allow" }, "All guards cleared");
});

QUnit.test("removeGlobalGuard removes by reference", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const guard: GuardFn = () => false;
	pipeline.addGlobalGuard(guard);
	pipeline.removeGlobalGuard(guard);

	const result = pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "allow" }, "Guard removed, navigation allowed");
});

QUnit.test("removeEnterGuard removes by reference", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const guard: GuardFn = () => false;
	pipeline.addEnterGuard("target", guard);
	pipeline.removeEnterGuard("target", guard);

	const result = pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "allow" }, "Enter guard removed");
});

QUnit.test("removeLeaveGuard removes by reference", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const guard: LeaveGuardFn = () => false;
	pipeline.addLeaveGuard("current", guard);
	pipeline.removeLeaveGuard("current", guard);

	const result = pipeline.evaluate(createContext({ fromRoute: "current" }));
	assert.deepEqual(result, { action: "allow" }, "Leave guard removed");
});

QUnit.test("removing a never-added guard is a no-op", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const guard: GuardFn = () => false;
	pipeline.addGlobalGuard(() => true);

	pipeline.removeGlobalGuard(guard);
	pipeline.removeEnterGuard("target", guard);
	pipeline.removeLeaveGuard("current", guard);

	const result = pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "allow" }, "Pipeline unaffected by removing non-existent guards");
});

// ============================================================
// Module: guard decisions
// ============================================================
QUnit.module("GuardPipeline - guard decisions");

QUnit.test("global guard returning false blocks", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => false);
	const result = pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "block" });
});

QUnit.test("global guard returning string redirects", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => "login");
	const result = pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "redirect", target: "login" });
});

QUnit.test("global guard returning GuardRedirect object redirects", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const redirect = { route: "login", parameters: { reason: "auth" } };
	pipeline.addGlobalGuard(() => redirect);
	const result = pipeline.evaluate(createContext());
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

	pipeline.evaluate(createContext());
	assert.deepEqual(calls, [1, 2], "Third guard never called");
});

QUnit.test("route enter guard blocks", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addEnterGuard("target", () => false);
	const result = pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "block" });
});

QUnit.test("route enter guard redirects", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addEnterGuard("target", () => "other");
	const result = pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "redirect", target: "other" });
});

QUnit.test("route enter guard returning GuardRedirect object redirects", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const redirect = { route: "login", parameters: { reason: "expired" } };
	pipeline.addEnterGuard("target", () => redirect);
	const result = pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "redirect", target: redirect });
});

// ============================================================
// Module: execution order
// ============================================================
QUnit.module("GuardPipeline - execution order");

QUnit.test("global guards run before route guards and can short-circuit", function (assert: Assert) {
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

	pipeline.evaluate(createContext());
	assert.deepEqual(order, ["global", "route"], "Global runs first");

	// Reset and test short-circuit
	const pipeline2 = new GuardPipeline();
	const called: string[] = [];
	pipeline2.addGlobalGuard(() => {
		called.push("global");
		return false;
	});
	pipeline2.addEnterGuard("target", () => {
		called.push("route");
		return true;
	});

	pipeline2.evaluate(createContext());
	assert.deepEqual(called, ["global"], "Route guard skipped when global blocks");
});

QUnit.test("leave guard allows, full pipeline runs in order", function (assert: Assert) {
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

	pipeline.evaluate(createContext({ fromRoute: "current" }));
	assert.deepEqual(order, ["leave", "global", "route"]);
});

// ============================================================
// Module: leave guards
// ============================================================
QUnit.module("GuardPipeline - leave guards");

QUnit.test("leave guard blocks and skips enter guards", function (assert: Assert) {
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

	const result = pipeline.evaluate(createContext({ fromRoute: "current" }));
	assert.deepEqual(result, { action: "block" });
	assert.deepEqual(called, ["leave"], "Enter guards never called");
});

QUnit.test("leave guards skipped when fromRoute is empty string", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addLeaveGuard("", () => false);
	const result = pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "allow" }, "No leave guards checked for empty fromRoute");
});

QUnit.test("multiple leave guards run in order and short-circuit on first false", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const order: number[] = [];
	pipeline.addLeaveGuard("current", () => {
		order.push(1);
		return true;
	});
	pipeline.addLeaveGuard("current", () => {
		order.push(2);
		return true;
	});

	const result = pipeline.evaluate(createContext({ fromRoute: "current" }));
	assert.deepEqual(result, { action: "allow" }, "All leave guards pass");
	assert.deepEqual(order, [1, 2], "Ran in registration order");

	// Short-circuit: second guard blocks
	const pipeline2 = new GuardPipeline();
	const called: number[] = [];
	pipeline2.addLeaveGuard("current", () => {
		called.push(1);
		return true;
	});
	pipeline2.addLeaveGuard("current", () => {
		called.push(2);
		return false;
	});
	pipeline2.addLeaveGuard("current", () => {
		called.push(3);
		return true;
	});

	const result2 = pipeline2.evaluate(createContext({ fromRoute: "current" }));
	assert.deepEqual(result2, { action: "block" });
	assert.deepEqual(called, [1, 2], "Third leave guard never called");
});

// ============================================================
// Module: validation
// ============================================================
QUnit.module("GuardPipeline - validation");

QUnit.test("invalid return values treated as block", function (this: SinonTestContext, assert: Assert) {
	const warnStub = this.stub(Log, "warning");

	const p1 = new GuardPipeline();
	p1.addGlobalGuard((() => 42) as unknown as GuardFn);
	assert.deepEqual(p1.evaluate(createContext()), { action: "block" }, "Number treated as block");

	const p2 = new GuardPipeline();
	p2.addGlobalGuard((() => "") as unknown as GuardFn);
	assert.deepEqual(p2.evaluate(createContext()), { action: "block" }, "Empty string treated as block");

	const p3 = new GuardPipeline();
	p3.addLeaveGuard("current", (() => "nope") as unknown as LeaveGuardFn);
	assert.deepEqual(
		p3.evaluate(createContext({ fromRoute: "current" })),
		{ action: "block" },
		"Leave guard non-boolean treated as block",
	);

	assert.strictEqual(warnStub.callCount, 3, "Warning logged for each invalid value");
});

// ============================================================
// Module: error handling
// ============================================================
QUnit.module("GuardPipeline - error handling");

QUnit.test("throwing guards produce error decisions and log errors", function (this: SinonTestContext, assert: Assert) {
	const errorStub = this.stub(Log, "error");

	const enterError = new Error("boom");
	const p1 = new GuardPipeline();
	p1.addGlobalGuard(() => {
		throw enterError;
	});
	assert.deepEqual(
		p1.evaluate(createContext()),
		{ action: "error", error: enterError },
		"Enter guard throw → error decision",
	);

	const leaveError = new Error("leave boom");
	const p2 = new GuardPipeline();
	p2.addLeaveGuard("current", () => {
		throw leaveError;
	});
	assert.deepEqual(
		p2.evaluate(createContext({ fromRoute: "current" })),
		{ action: "error", error: leaveError },
		"Leave guard throw → error decision",
	);

	assert.strictEqual(errorStub.callCount, 2, "Error logged for each throw");
});

QUnit.test("async guard that rejects produces error decision", async function (this: SinonTestContext, assert: Assert) {
	const errorStub = this.stub(Log, "error");
	const pipeline = new GuardPipeline();
	const rejectedError = new Error("async boom");
	pipeline.addGlobalGuard(() => Promise.reject(rejectedError));

	const result = await pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "error", error: rejectedError });
	assert.ok(errorStub.calledOnce, "Error was logged");
});

QUnit.test(
	"aborted signal suppresses error logging and produces block",
	async function (this: SinonTestContext, assert: Assert) {
		const errorStub = this.stub(Log, "error");

		const c1 = new AbortController();
		const p1 = new GuardPipeline();
		p1.addGlobalGuard(() => {
			c1.abort();
			return Promise.reject(new Error("aborted"));
		});
		const r1 = await p1.evaluate(createContext({ signal: c1.signal }));
		assert.deepEqual(r1, { action: "block" }, "Aborted enter guard → block (not error)");
		assert.ok(errorStub.notCalled, "Enter guard error suppressed when signal aborted");

		const c2 = new AbortController();
		const p2 = new GuardPipeline();
		p2.addLeaveGuard("current", () => {
			c2.abort();
			return Promise.reject(new Error("leave aborted"));
		});
		const r2 = await p2.evaluate(createContext({ signal: c2.signal, fromRoute: "current" }));
		assert.deepEqual(r2, { action: "block" }, "Aborted leave guard → block (not error)");
		assert.ok(errorStub.notCalled, "Leave guard error suppressed when signal aborted");
	},
);

QUnit.test("guard returning false produces block, not error", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => false);
	assert.deepEqual(pipeline.evaluate(createContext()), { action: "block" }, "false → block, not error");
});

// ============================================================
// Module: async
// ============================================================
QUnit.module("GuardPipeline - async");

QUnit.test("async guard decisions", async function (assert: Assert) {
	const p1 = new GuardPipeline();
	p1.addGlobalGuard(() => Promise.resolve(true));
	assert.deepEqual(await p1.evaluate(createContext()), { action: "allow" }, "Async allow");

	const p2 = new GuardPipeline();
	p2.addGlobalGuard(() => Promise.resolve(false));
	assert.deepEqual(await p2.evaluate(createContext()), { action: "block" }, "Async block");

	const p3 = new GuardPipeline();
	p3.addGlobalGuard(() => Promise.resolve("login"));
	assert.deepEqual(await p3.evaluate(createContext()), { action: "redirect", target: "login" }, "Async redirect");
});

QUnit.test("mixed sync-async pipeline preserves order", async function (assert: Assert) {
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

	const result = await pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "allow" });
	assert.deepEqual(order, [1, 2, 3], "All guards ran in order");
});

QUnit.test("async leave guard blocks before enter guards run", async function (assert: Assert) {
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

	const result = await pipeline.evaluate(createContext({ fromRoute: "current" }));
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

	const result = await pipeline.evaluate(createContext({ signal: controller.signal }));
	assert.deepEqual(result, { action: "block" }, "Blocked due to abort");
	assert.deepEqual(called, [1], "Second guard never called");
});

QUnit.test("async leave guard allows then enter guards run", async function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const order: string[] = [];
	pipeline.addLeaveGuard("current", () => {
		order.push("leave");
		return Promise.resolve(true);
	});
	pipeline.addGlobalGuard(() => {
		order.push("global");
		return true;
	});
	pipeline.addEnterGuard("target", () => {
		order.push("route");
		return true;
	});

	const result = await pipeline.evaluate(createContext({ fromRoute: "current" }));
	assert.deepEqual(result, { action: "allow" });
	assert.deepEqual(order, ["leave", "global", "route"], "Full pipeline ran after async leave guard allowed");
});

QUnit.test(
	"async guard returning invalid value treated as block",
	async function (this: SinonTestContext, assert: Assert) {
		const warnStub = this.stub(Log, "warning");
		const pipeline = new GuardPipeline();
		pipeline.addGlobalGuard(() => Promise.resolve(42 as unknown as boolean));

		const result = await pipeline.evaluate(createContext());
		assert.deepEqual(result, { action: "block" });
		assert.ok(warnStub.calledOnce, "Warning logged for invalid async return");
	},
);

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

	const result1 = pipeline.evaluate(createContext());
	assert.deepEqual(result1, { action: "allow" }, "First call: both guards run, allow");

	const result2 = pipeline.evaluate(createContext());
	assert.deepEqual(result2, { action: "allow" }, "Second call: one-shot removed, still allow");
});

// ============================================================
// Module: skipLeaveGuards option
// ============================================================
QUnit.module("GuardPipeline - skipLeaveGuards option");

QUnit.test("skipLeaveGuards skips leave guards even when fromRoute is set", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const called: string[] = [];
	pipeline.addLeaveGuard("current", () => {
		called.push("leave");
		return false; // would block
	});
	pipeline.addGlobalGuard(() => {
		called.push("global");
		return true;
	});

	const result = pipeline.evaluate(createContext({ fromRoute: "current" }), { skipLeaveGuards: true });
	assert.deepEqual(result, { action: "allow" }, "Navigation allowed despite blocking leave guard");
	assert.deepEqual(called, ["global"], "Leave guard was skipped, global guard ran");
});

QUnit.test("skipLeaveGuards defaults to running leave guards", function (assert: Assert) {
	const p1 = new GuardPipeline();
	p1.addLeaveGuard("current", () => false);
	const r1 = p1.evaluate(createContext({ fromRoute: "current" }), { skipLeaveGuards: false });
	assert.deepEqual(r1, { action: "block" }, "Leave guard blocks when skipLeaveGuards is false");

	const p2 = new GuardPipeline();
	p2.addLeaveGuard("current", () => false);
	const r2 = p2.evaluate(createContext({ fromRoute: "current" }));
	assert.deepEqual(r2, { action: "block" }, "Leave guard blocks when options omitted");
});
