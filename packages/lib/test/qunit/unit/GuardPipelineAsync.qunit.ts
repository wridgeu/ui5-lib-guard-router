import Log from "sap/base/Log";
import GuardPipeline, { isPromiseLike, nameGuard } from "ui5/guard/router/GuardPipeline";
import type { GuardFn, LeaveGuardFn } from "ui5/guard/router/types";
import { callUnsafe, createGuardContext as createContext, logMessages, type SinonTestContext } from "../testHelpers";

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
	void sync.evaluate(createContext());

	const leaving = new GuardPipeline();
	leaving.addLeaveGuard("current", leave);
	void leaving.evaluate(createContext({ fromRoute: "current" }));

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
