import Log from "sap/base/Log";
import jQuery from "sap/ui/thirdparty/jquery";
import GuardPipeline, { isPromiseLike } from "ui5/guard/router/GuardPipeline";
import type { GuardFn, LeaveGuardFn } from "ui5/guard/router/types";
import { callUnsafe, createGuardContext as createContext, logMessages, type SinonTestContext } from "../testHelpers";

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

	void pipeline.evaluate(createContext());
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

	void pipeline.evaluate(createContext());
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

	void pipeline2.evaluate(createContext());
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

	void pipeline.evaluate(createContext({ fromRoute: "current" }));
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
// Module: greedy routes
// ============================================================
QUnit.module("GuardPipeline - greedy routes");

QUnit.test(
	"the guards of routes that are entered as well run after those of toRoute, with the same context",
	function (assert: Assert) {
		const pipeline = new GuardPipeline();
		const calls: string[] = [];
		const record =
			(name: string): GuardFn =>
			(context) => {
				calls.push(`${name}:${context.toRoute}`);
				return true;
			};
		pipeline.addEnterGuard("audit", record("audit"));
		pipeline.addEnterGuard("target", record("target"));
		pipeline.addEnterGuard("other", record("other"));
		pipeline.addGlobalGuard(record("global"));

		const result = pipeline.evaluate(createContext(), { alsoEntering: ["audit", "unguarded"] });

		assert.deepEqual(result, { action: "allow" }, "all guards allow");
		assert.deepEqual(
			calls,
			["global:target", "target:target", "audit:target"],
			"global, first match, greedy match",
		);
	},
);

QUnit.test(
	"a guard of a route that is entered as well blocks or redirects the navigation",
	async function (assert: Assert) {
		const pipeline = new GuardPipeline();
		pipeline.addEnterGuard("audit", () => false);
		assert.deepEqual(
			pipeline.evaluate(createContext(), { alsoEntering: ["audit"] }),
			{ action: "block" },
			"a sync guard blocks",
		);
		assert.deepEqual(pipeline.evaluate(createContext()), { action: "allow" }, "not when its route does not match");

		const redirecting = new GuardPipeline();
		redirecting.addEnterGuard("target", async () => true);
		redirecting.addEnterGuard("audit", async () => "login");
		redirecting.addEnterGuard("last", () => {
			throw new Error("must not run");
		});
		assert.deepEqual(
			await redirecting.evaluate(createContext(), { alsoEntering: ["audit", "last"] }),
			{ action: "redirect", target: "login" },
			"an async guard redirects after the async guard of the first match, and ends the evaluation",
		);
	},
);

QUnit.test(
	"no enter guard starts on a navigation that was aborted after its async leave guard allowed",
	async function (assert: Assert) {
		// The abort comes a number of microtasks after the leave guard has settled.
		for (let microtasks = 0; microtasks < 6; microtasks++) {
			const pipeline = new GuardPipeline();
			const controller = new AbortController();
			const allowed = Promise.withResolvers<boolean>();
			let startedAborted = false;
			pipeline.addLeaveGuard("current", () => allowed.promise);
			pipeline.addEnterGuard("target", (context) => {
				startedAborted = context.signal.aborted;
				return true;
			});

			const decision = pipeline.evaluate(createContext({ fromRoute: "current", signal: controller.signal }));
			let abort: Promise<unknown> = allowed.promise;
			for (let i = 0; i < microtasks; i++) abort = abort.then(() => {});
			abort = abort.then(() => controller.abort());
			allowed.resolve(true);
			await Promise.all([decision, abort]);

			assert.notOk(startedAborted, `abort ${microtasks} microtasks after the leave guard`);
		}
	},
);

QUnit.test("an aborted navigation runs no guard of a further route", async function (assert: Assert) {
	const pipeline = new GuardPipeline();
	const controller = new AbortController();
	let auditCalled = false;
	pipeline.addEnterGuard("target", async () => {
		controller.abort();
		return true;
	});
	pipeline.addEnterGuard("audit", () => {
		auditCalled = true;
		return true;
	});
	const leaving = new GuardPipeline();
	leaving.addLeaveGuard("current", async () => {
		controller.abort();
		return true;
	});
	leaving.addLeaveGuard("audit", () => {
		auditCalled = true;
		return true;
	});

	assert.deepEqual(
		await pipeline.evaluate(createContext({ signal: controller.signal }), { alsoEntering: ["audit"] }),
		{ action: "block" },
		"enter guards",
	);
	assert.deepEqual(
		await leaving.evaluate(createContext({ fromRoute: "current", signal: controller.signal }), {
			alsoLeaving: ["audit"],
		}),
		{ action: "block" },
		"leave guards",
	);
	assert.notOk(auditCalled, "the guards of the greedy route did not run");
});

QUnit.test(
	"the leave guards of routes that are left as well run after those of fromRoute",
	async function (assert: Assert) {
		const pipeline = new GuardPipeline();
		const calls: string[] = [];
		pipeline.addLeaveGuard("audit", (context) => {
			calls.push(`audit:${context.fromRoute}`);
			return false;
		});
		pipeline.addLeaveGuard("current", async (context) => {
			calls.push(`current:${context.fromRoute}`);
			return true;
		});
		pipeline.addGlobalGuard(() => {
			calls.push("global");
			return true;
		});

		assert.deepEqual(
			await pipeline.evaluate(createContext({ fromRoute: "current" }), { alsoLeaving: ["audit"] }),
			{ action: "block" },
			"the leave guard of the greedy route blocks",
		);
		assert.deepEqual(calls, ["current:current", "audit:current"], "in order, before any enter guard");
		assert.deepEqual(
			pipeline.evaluate(createContext({ fromRoute: "current" }), {
				alsoLeaving: ["audit"],
				skipLeaveGuards: true,
			}),
			{ action: "allow" },
			"a redirect hop runs none of them",
		);
		assert.deepEqual(
			pipeline.evaluate(createContext(), { alsoLeaving: ["audit"] }),
			{ action: "allow" },
			"nor does a navigation that leaves no route",
		);
	},
);

QUnit.test(
	"a failing guard of a greedy route is logged with the name of that route",
	function (this: SinonTestContext, assert: Assert) {
		const error = this.stub(Log, "error");
		const pipeline = new GuardPipeline();
		pipeline.addEnterGuard("audit", () => {
			throw new Error("enter failed");
		});
		pipeline.addLeaveGuard("auditLeft", () => {
			throw new Error("leave failed");
		});

		void pipeline.evaluate(createContext(), { alsoEntering: ["audit"] });
		void pipeline.evaluate(createContext({ fromRoute: "current" }), { alsoLeaving: ["auditLeft"] });

		assert.deepEqual(logMessages(error), [
			'Enter guard [0] on route "audit" threw, navigation failed',
			'Leave guard [0] on route "auditLeft" threw, navigation failed',
		]);
	},
);
