import Log from "sap/base/Log";
import jQuery from "sap/ui/thirdparty/jquery";
import GuardPipeline, { isPromiseLike, isPromiseResolver, nameGuard } from "ui5/guard/router/GuardPipeline";
import type { GuardFn, LeaveGuardFn } from "ui5/guard/router/types";
import { callUnsafe, createGuardContext as createContext, logMessages, type SinonTestContext } from "./testHelpers";

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
	const calls: string[] = [];
	pipeline.addGlobalGuard(() => {
		calls.push("global");
		return true;
	});
	pipeline.addEnterGuard("target", () => {
		calls.push("enter");
		return true;
	});
	pipeline.addLeaveGuard("current", () => {
		calls.push("leave");
		return true;
	});
	const guard: GuardFn = () => false;

	pipeline.removeGlobalGuard(guard);
	pipeline.removeEnterGuard("target", guard);
	pipeline.removeLeaveGuard("current", guard);

	const result = pipeline.evaluate(createContext({ fromRoute: "current" }));
	assert.deepEqual(result, { action: "allow" }, "Pipeline unaffected by removing non-existent guards");
	assert.deepEqual(calls, ["leave", "global", "enter"], "Every registered guard is still registered");
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

QUnit.test("isPromiseLike accepts function thenables and rejects non-thenables", function (assert: Assert) {
	// deferred.promise(target) attaches then() to the target, here a function.
	const functionThenable = jQuery.Deferred().promise(() => undefined);
	assert.strictEqual(isPromiseLike(functionThenable), true, "function with then() is a thenable");
	assert.strictEqual(
		isPromiseLike(() => undefined),
		false,
		"plain function is not",
	);
	assert.strictEqual(isPromiseLike(null), false, "null is not");
});

QUnit.test("invalid return values treated as block", function (this: SinonTestContext, assert: Assert) {
	const warnStub = this.stub(Log, "warning");

	const p1 = new GuardPipeline();
	callUnsafe(p1, "addGlobalGuard", () => 42);
	assert.deepEqual(p1.evaluate(createContext()), { action: "block" }, "Number treated as block");

	const p2 = new GuardPipeline();
	callUnsafe(p2, "addGlobalGuard", () => "");
	assert.deepEqual(p2.evaluate(createContext()), { action: "block" }, "Empty string treated as block");

	const p3 = new GuardPipeline();
	callUnsafe(p3, "addLeaveGuard", "current", () => "nope");
	assert.deepEqual(
		p3.evaluate(createContext({ fromRoute: "current" })),
		{ action: "block" },
		"Leave guard non-boolean treated as block",
	);

	const p4 = new GuardPipeline();
	callUnsafe(p4, "addGlobalGuard", () => ({ route: "" }));
	assert.deepEqual(p4.evaluate(createContext()), { action: "block" }, "Redirect object with empty route is a block");

	const p5 = new GuardPipeline();
	callUnsafe(p5, "addGlobalGuard", () => ({ route: ["home"] }));
	assert.deepEqual(
		p5.evaluate(createContext()),
		{ action: "block" },
		"Redirect object with non-string route is a block",
	);

	assert.deepEqual(
		warnStub.getCalls().map((call) => call.args[0]),
		[
			"Guard returned invalid value, treating as block",
			"Guard returned invalid value, treating as block",
			"Leave guard returned non-boolean value, treating as block",
			"Guard returned invalid value, treating as block",
			"Guard returned invalid value, treating as block",
		],
		"Warning logged for each invalid value",
	);
	assert.ok(
		warnStub.alwaysCalledWith(sinon.match.string, sinon.match.any, "ui5.guard.router.Router"),
		"Warnings are logged under the router's log component",
	);
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

	assert.deepEqual(
		errorStub.getCalls().map((call) => [call.args[0], call.args[2]]),
		[
			['Enter guard [0] on route "target" threw, navigation failed', "ui5.guard.router.Router"],
			['Leave guard [0] on route "current" threw, navigation failed', "ui5.guard.router.Router"],
		],
		"Each throw is logged with the guard's route under the router's log component",
	);
});

QUnit.test("a named guard's throw is logged with its name", async function (this: SinonTestContext, assert: Assert) {
	const errorStub = this.stub(Log, "error");
	const enter: GuardFn = () => {
		throw new Error("enter");
	};
	const leave: LeaveGuardFn = () => {
		throw new Error("leave");
	};
	const rejecting: GuardFn = () => Promise.reject(new Error("async"));
	nameGuard(enter, "checks#0");
	nameGuard(leave, "unsaved");
	nameGuard(rejecting, "remote");

	const sync = new GuardPipeline();
	sync.addGlobalGuard(() => true);
	sync.addGlobalGuard(enter);
	sync.evaluate(createContext());

	const leaving = new GuardPipeline();
	leaving.addLeaveGuard("current", leave);
	leaving.evaluate(createContext({ fromRoute: "current" }));

	const async = new GuardPipeline();
	async.addGlobalGuard(() => Promise.resolve(true));
	async.addGlobalGuard(rejecting);
	await async.evaluate(createContext());

	assert.deepEqual(
		errorStub.getCalls().map((call) => call.args[0]),
		[
			'Enter guard [1] "checks#0" on route "target" threw, navigation failed',
			'Leave guard [0] "unsaved" on route "current" threw, navigation failed',
			'Enter guard [1] "remote" on route "target" threw, navigation failed',
		],
	);
});

QUnit.test("async guard that rejects produces error decision", async function (this: SinonTestContext, assert: Assert) {
	const errorStub = this.stub(Log, "error");
	const pipeline = new GuardPipeline();
	const rejectedError = new Error("async boom");
	pipeline.addGlobalGuard(() => Promise.reject(rejectedError));

	const result = await pipeline.evaluate(createContext({ fromRoute: "current" }));
	assert.deepEqual(result, { action: "error", error: rejectedError });
	assert.deepEqual(
		errorStub.getCalls().map((call) => call.args[0]),
		['Enter guard [0] on route "target" threw, navigation failed'],
		"Logged once, naming the target route (not the route being left)",
	);
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

		const c5 = new AbortController();
		const p5 = new GuardPipeline();
		p5.addEnterGuard("target", () => {
			c5.abort();
			return Promise.reject(new Error("route aborted"));
		});
		const r5 = await p5.evaluate(createContext({ signal: c5.signal }));
		assert.deepEqual(r5, { action: "block" }, "Aborted route guard rejection → block (not allow)");

		const c3 = new AbortController();
		const p3 = new GuardPipeline();
		p3.addGlobalGuard(() => {
			c3.abort();
			throw new Error("sync aborted");
		});
		const r3 = p3.evaluate(createContext({ signal: c3.signal }));
		assert.deepEqual(r3, { action: "block" }, "Sync enter guard throwing after abort → block (not error)");

		const c4 = new AbortController();
		const p4 = new GuardPipeline();
		p4.addLeaveGuard("current", () => {
			c4.abort();
			throw new Error("sync leave aborted");
		});
		const r4 = p4.evaluate(createContext({ signal: c4.signal, fromRoute: "current" }));
		assert.deepEqual(r4, { action: "block" }, "Sync leave guard throwing after abort → block (not error)");
		assert.ok(errorStub.notCalled, "Sync guard errors suppressed when signal aborted");
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

QUnit.test("an all-sync pipeline returns its decision directly", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addLeaveGuard("current", () => true);
	pipeline.addGlobalGuard(() => true);
	pipeline.addEnterGuard("target", () => false);
	assert.deepEqual(pipeline.evaluate(createContext({ fromRoute: "current" })), { action: "block" });
});

QUnit.test("after a guard returns a Promise, the rest of the evaluation waits for it", async function (assert: Assert) {
	const order: string[] = [];
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => {
		order.push("async global");
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

	const decision = pipeline.evaluate(createContext());
	assert.ok(isPromiseLike(decision), "the decision is a Promise");
	assert.deepEqual(order, ["async global"], "later guards of the phase and later phases have not run");
	assert.deepEqual(await decision, { action: "allow" });
	assert.deepEqual(order, ["async global", "global", "route"]);
});

QUnit.test("an async leave guard defers the enter phases", async function (assert: Assert) {
	const order: string[] = [];
	const pipeline = new GuardPipeline();
	pipeline.addLeaveGuard("current", () => {
		order.push("leave");
		return Promise.resolve(true);
	});
	pipeline.addGlobalGuard(() => {
		order.push("global");
		return true;
	});

	const decision = pipeline.evaluate(createContext({ fromRoute: "current" }));
	assert.ok(isPromiseLike(decision), "the decision is a Promise");
	assert.deepEqual(order, ["leave"]);
	assert.deepEqual(await decision, { action: "allow" });
	assert.deepEqual(order, ["leave", "global"]);
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

QUnit.test("async pipeline keeps running guards after each allow", async function (assert: Assert) {
	const pipeline = new GuardPipeline();
	pipeline.addGlobalGuard(() => Promise.resolve(true));
	pipeline.addGlobalGuard(() => true);
	pipeline.addGlobalGuard(() => false);

	const result = await pipeline.evaluate(createContext());
	assert.deepEqual(result, { action: "block" }, "The third guard's block is reached after two allows");
});

QUnit.test("abort between route guards blocks", async function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const controller = new AbortController();
	let secondCalled = false;
	pipeline.addEnterGuard("target", () => {
		controller.abort();
		return Promise.resolve(true);
	});
	pipeline.addEnterGuard("target", () => {
		secondCalled = true;
		return true;
	});

	const result = await pipeline.evaluate(createContext({ signal: controller.signal }));
	assert.deepEqual(result, { action: "block" }, "Blocked due to abort");
	assert.notOk(secondCalled, "Second route guard never called");
});

QUnit.test("abort after async global guards blocks before route guards", async function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const controller = new AbortController();
	let routeGuardCalled = false;
	pipeline.addGlobalGuard(() => {
		controller.abort();
		return Promise.resolve(true);
	});
	pipeline.addEnterGuard("target", () => {
		routeGuardCalled = true;
		return true;
	});

	const result = await pipeline.evaluate(createContext({ signal: controller.signal }));
	assert.deepEqual(result, { action: "block" }, "Blocked due to abort");
	assert.notOk(routeGuardCalled, "Route guard never called");
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
		callUnsafe(pipeline, "addGlobalGuard", () => Promise.resolve(42));

		const result = await pipeline.evaluate(createContext());
		assert.deepEqual(result, { action: "block" });
		assert.deepEqual(
			logMessages(warnStub),
			["Guard returned invalid value, treating as block"],
			"One warning for the invalid async return",
		);
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
	let secondGuardCalls = 0;
	pipeline.addGlobalGuard(oneShotGuard);
	pipeline.addGlobalGuard(() => {
		secondGuardCalls++;
		return true;
	});

	const result1 = pipeline.evaluate(createContext());
	assert.deepEqual(result1, { action: "allow" }, "First call: allow");
	assert.strictEqual(secondGuardCalls, 1, "First call: the guard after the self-removing one still ran");

	const result2 = pipeline.evaluate(createContext());
	assert.deepEqual(result2, { action: "allow" }, "Second call: one-shot removed, still allow");
	assert.strictEqual(secondGuardCalls, 2, "Second call: remaining guard ran");
});

QUnit.test("leave guard can remove itself during iteration", function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const oneShotGuard: LeaveGuardFn = () => {
		pipeline.removeLeaveGuard("current", oneShotGuard);
		return true;
	};
	let secondGuardCalls = 0;
	pipeline.addLeaveGuard("current", oneShotGuard);
	pipeline.addLeaveGuard("current", () => {
		secondGuardCalls++;
		return true;
	});

	const result = pipeline.evaluate(createContext({ fromRoute: "current" }));
	assert.deepEqual(result, { action: "allow" }, "Allow");
	assert.strictEqual(secondGuardCalls, 1, "The leave guard after the self-removing one still ran");
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

// ============================================================
// Module: Promise resolve functions
// ============================================================
QUnit.module("GuardPipeline - Promise resolve functions");

/** The resolve and reject functions of a native Promise. A UI5 component target subscribes the first one. */
function createPromiseFunctions(): [resolve: (value: unknown) => void, reject: (reason: unknown) => void] {
	const { resolve, reject } = Promise.withResolvers<unknown>();
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
