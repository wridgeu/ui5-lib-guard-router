import type { GuardContext, GuardRouter } from "ui5/guard/router/types";
import { captureUnhandledRejections, waitForRoute, routerHooks } from "../../testHelpers";

let router: GuardRouter;

const standardHooks = routerHooks(
	(created) => {
		router = created;
	},
	() => router,
);

// ============================================================
// Module: AbortSignal on GuardContext
// ============================================================
QUnit.module("Router - AbortSignal on GuardContext", standardHooks);

QUnit.test("Guard context includes an AbortSignal", async function (assert: Assert) {
	const signals: AbortSignal[] = [];
	router.addGuard((context: GuardContext) => {
		signals.push(context.signal);
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	assert.strictEqual(signals.length, 1, "Signal was provided");
	assert.ok(signals[0] instanceof AbortSignal, "Signal is an AbortSignal");
	assert.notOk(signals[0].aborted, "Signal is not aborted after successful navigation");
});

QUnit.test("Signal is aborted when a newer navigation supersedes", async function (assert: Assert) {
	let firstSignal: AbortSignal | null = null;
	let secondSignal: AbortSignal | null = null;
	let callCount = 0;

	const slowGuard = Promise.withResolvers<boolean>();
	router.initialize();
	await waitForRoute(router, "home");
	router.addGuard(async (context: GuardContext) => {
		callCount++;
		if (callCount === 1) {
			firstSignal = context.signal;
			return slowGuard.promise;
		}
		secondSignal = context.signal;
		return true;
	});

	// First navigation (slow)
	router.navTo("protected");
	// Second navigation supersedes first
	router.navTo("detail", { id: "1" });

	await router.navigationSettled();
	assert.ok(firstSignal, "First signal was captured");
	assert.ok(firstSignal!.aborted, "First signal was aborted by second navigation");
	assert.ok(secondSignal, "Second signal was captured");
	assert.notOk(secondSignal!.aborted, "Second signal remains active");
});

QUnit.test("Signal is aborted on router destroy", async function (assert: Assert) {
	let capturedSignal: AbortSignal | null = null;
	const pendingGuard = Promise.withResolvers<boolean>();
	router.initialize();
	await waitForRoute(router, "home");
	router.addGuard((context: GuardContext) => {
		capturedSignal = context.signal;
		return pendingGuard.promise;
	});

	router.navTo("protected");
	assert.ok(capturedSignal, "Signal was captured");
	assert.notOk(capturedSignal!.aborted, "Signal is not yet aborted");

	router.destroy();
	assert.ok(capturedSignal!.aborted, "Signal was aborted on destroy");
});

QUnit.test("Signal is aborted when navigating back to current route", async function (assert: Assert) {
	let capturedSignal: AbortSignal | null = null;
	const pendingGuard = Promise.withResolvers<boolean>();
	router.addRouteGuard("protected", (context: GuardContext) => {
		capturedSignal = context.signal;
		return pendingGuard.promise;
	});
	router.initialize();
	await waitForRoute(router, "home");

	// Navigate to protected (triggers slow route guard)
	router.navTo("protected");
	assert.ok(capturedSignal, "Signal was captured");

	// Navigate back to current route while guard is pending.
	// With navTo preflight, the hash never changed to "protected", so
	// HashChanger.setHash("") would be a no-op. Use navTo("home") to
	// exercise the same-hash dedup.
	router.navTo("home");
	assert.ok(capturedSignal!.aborted, "Signal was aborted when returning to current route");
});

// ============================================================
// Module: Abort controller cleanup (leak prevention)
// ============================================================
QUnit.module("Router - Abort controller cleanup", standardHooks);

QUnit.test(
	"Signal from a committed navigation is not retroactively aborted by the next navigation",
	async function (assert: Assert) {
		let firstSignal: AbortSignal | null = null;
		let callCount = 0;
		router.addGuard((context: GuardContext) => {
			callCount++;
			if (callCount === 1) {
				firstSignal = context.signal;
			}
			return true;
		});
		router.initialize();
		await waitForRoute(router, "home");
		callCount = 0;

		// First navigation commits successfully
		router.navTo("protected");
		await waitForRoute(router, "protected");
		assert.ok(firstSignal, "Signal was captured from first navigation");
		assert.notOk(firstSignal!.aborted, "Signal was not aborted after successful commit");

		// Second navigation should NOT retroactively abort the first signal
		router.navTo("forbidden");
		await waitForRoute(router, "forbidden");
		assert.notOk(firstSignal!.aborted, "First signal stays clean after second navigation commits");
	},
);

QUnit.test(
	"Signal from a blocked navigation is not retroactively aborted by the next navigation",
	async function (assert: Assert) {
		let blockedSignal: AbortSignal | null = null;
		let callCount = 0;
		router.addRouteGuard("protected", (context: GuardContext) => {
			callCount++;
			if (callCount === 1) {
				blockedSignal = context.signal;
			}
			return false;
		});
		router.initialize();
		await waitForRoute(router, "home");
		callCount = 0;

		// First navigation is blocked
		router.navTo("protected");
		await router.navigationSettled();
		assert.ok(blockedSignal, "Signal was captured from blocked navigation");
		assert.notOk(blockedSignal!.aborted, "Blocked signal is not aborted (guard ran to completion)");

		// Navigate to an unguarded route; the stale controller must not leak
		router.navTo("forbidden");
		await waitForRoute(router, "forbidden");
		assert.notOk(blockedSignal!.aborted, "Blocked signal stays clean after unguarded navigation");
	},
);

QUnit.test(
	"Signal from a redirected navigation is not retroactively aborted by the next navigation",
	async function (assert: Assert) {
		let redirectedSignal: AbortSignal | null = null;
		router.addRouteGuard("forbidden", (context: GuardContext) => {
			redirectedSignal = context.signal;
			return "protected";
		});
		router.initialize();
		await waitForRoute(router, "home");

		// Navigation triggers redirect
		router.navTo("forbidden");
		await waitForRoute(router, "protected");
		assert.ok(redirectedSignal, "Signal was captured from redirected navigation");
		assert.notOk(redirectedSignal!.aborted, "Signal was not aborted after redirect");

		// Subsequent navigation must not retroactively abort the old signal
		router.navTo("detail", { id: "1" });
		await waitForRoute(router, "detail");
		assert.notOk(redirectedSignal!.aborted, "Redirected signal stays clean after subsequent navigation");
	},
);

// ============================================================
// Module: Guard error after signal abort
// ============================================================
QUnit.module("Router - Guard error after signal abort", standardHooks);

QUnit.test(
	"Enter guard rejecting after signal abort does not produce unhandled rejection",
	async function (assert: Assert) {
		router.addRouteGuard("protected", async (context: GuardContext) => {
			await new Promise<void>((_resolve, reject) => {
				context.signal.addEventListener("abort", () => {
					reject(new Error("Resource cleanup failed"));
				});
			});
			return true;
		});
		router.initialize();
		await waitForRoute(router, "home");

		const unhandled = await captureUnhandledRejections(async () => {
			// Start navigation (guard stays pending)
			router.navTo("protected");
			// Supersede: aborts the signal, guard rejects
			router.navTo("forbidden");
			await waitForRoute(router, "forbidden");
		});

		assert.deepEqual(unhandled, [], "No unhandled rejections from guard error after abort");
	},
);

QUnit.test(
	"Leave guard rejecting after signal abort does not produce unhandled rejection",
	async function (assert: Assert) {
		let leaveGuardCalls = 0;
		router.addLeaveGuard("home", (context: GuardContext) => {
			leaveGuardCalls++;
			if (leaveGuardCalls > 1) {
				return true;
			}
			return new Promise<boolean>((_resolve, reject) => {
				context.signal.addEventListener("abort", () => {
					reject(new Error("Leave guard cleanup error"));
				});
			});
		});
		router.initialize();
		await waitForRoute(router, "home");

		const unhandled = await captureUnhandledRejections(async () => {
			// Navigate to protected (leave guard on home stays pending)
			router.navTo("protected");
			// Supersede: aborts the signal, leave guard rejects
			router.navTo("forbidden");
			await router.navigationSettled();
		});

		assert.strictEqual(leaveGuardCalls, 2, "the leave guard ran for both navigations");
		assert.deepEqual(unhandled, [], "No unhandled rejections from leave guard error after abort");
	},
);
