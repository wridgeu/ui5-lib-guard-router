import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardContext, GuardRouter, Router$NavigationSettledEvent } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import {
	captureErrorsAsync,
	captureWarningsAsync,
	createRouterUnsafe,
	getHash,
	flushPromises,
	recordHashChanges,
	recordSettlements,
	type SinonTestContext,
	waitForRoute,
	routerHooks,
} from "../../testHelpers";

let router: GuardRouter;

const standardHooks = routerHooks(
	(created) => {
		router = created;
	},
	() => router,
);

// ============================================================
// Module: Guards on redirect targets
// ============================================================
QUnit.module("Router - Guards on redirect targets", standardHooks);

QUnit.test("Guard on redirect target is evaluated", async function (assert: Assert) {
	const called: string[] = [];
	router.addRouteGuard("protected", () => {
		called.push("protected");
		return "forbidden";
	});
	router.addRouteGuard("forbidden", () => {
		called.push("forbidden");
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "forbidden");
	assert.deepEqual(called, ["protected", "forbidden"], "Both guards ran");
	assert.deepEqual(
		await router.navigationSettled(),
		{ status: NavigationOutcome.Redirected, route: "forbidden", hash: "forbidden" },
		"Settled as Redirected on the redirect target",
	);
	assert.strictEqual(getHash(), "forbidden", "Landed on redirect target");
});

QUnit.test("Guard on redirect target blocks entire chain", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => false);
	router.initialize();
	await waitForRoute(router, "home");

	const recorder = recordHashChanges();
	router.navTo("protected");
	const result = await router.navigationSettled();
	recorder.stop();
	assert.strictEqual(result.status, NavigationOutcome.Blocked, "Chain blocked");
	assert.deepEqual(recorder.hashes, [], "Hash unchanged (preflight)");
});

QUnit.test("Redirect chain follows multiple hops (A -> B -> C)", async function (assert: Assert) {
	// Chain: protected -> forbidden -> detail (avoids redirecting back to current route)
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => ({ route: "detail", parameters: { id: "chain" } }));
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "detail");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Redirected, "Settled as Redirected");
	assert.strictEqual(getHash(), "detail/chain", "Landed on final hop");
});

QUnit.test("Redirect loop (A -> B -> A) is detected and blocked", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => "protected");
	router.initialize();
	await waitForRoute(router, "home");

	const errors = await captureErrorsAsync(async () => {
		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Blocked, "Loop blocked");
	});
	assert.deepEqual(
		errors.map((e) => e.message),
		["Guard redirect loop detected: protected -> forbidden -> protected"],
		"the error names every hash of the loop",
	);
});

QUnit.test("Guard on redirect target receives correct context", async function (assert: Assert) {
	let capturedContext: GuardContext | undefined;
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", (ctx: GuardContext) => {
		capturedContext = ctx;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "forbidden");
	assert.ok(capturedContext, "Guard on redirect target was called");
	assert.strictEqual(capturedContext!.toRoute, "forbidden", "toRoute is redirect target");
	assert.strictEqual(capturedContext!.toHash, "forbidden", "toHash is redirect target hash");
	assert.strictEqual(capturedContext!.fromRoute, "home", "fromRoute is original source");
	assert.strictEqual(capturedContext!.fromHash, "", "fromHash is original source hash");
});

QUnit.test("Leave guards run only on first hop, not on redirect hops", async function (assert: Assert) {
	let leaveCallCount = 0;
	router.addLeaveGuard("home", () => {
		leaveCallCount++;
		return true;
	});
	router.addRouteGuard("protected", () => "forbidden");
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "forbidden");
	assert.strictEqual(leaveCallCount, 1, "Leave guard ran exactly once (first hop only)");
});

QUnit.test("Async guards in redirect chain work correctly", async function (assert: Assert) {
	router.addRouteGuard("protected", async () => "forbidden");
	router.addRouteGuard("forbidden", async () => true);
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "forbidden");
	assert.strictEqual(getHash(), "forbidden", "Async chain resolved to redirect target");
});

QUnit.test("Superseding navigation during async redirect chain cancels the chain", async function (assert: Assert) {
	router.addRouteGuard("protected", async () => "forbidden");
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	// Supersede before the async guard resolves
	router.navTo("detail", { id: "1" });
	await waitForRoute(router, "detail");
	await flushPromises();
	assert.strictEqual(getHash(), "detail/1", "Superseding navigation won");
});

QUnit.test("Self-redirect (A -> A) detected as loop", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "protected");
	router.initialize();
	await waitForRoute(router, "home");

	const errors = await captureErrorsAsync(async () => {
		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Blocked, "Self-redirect blocked");
	});
	assert.ok(
		errors.some((e) => e.message.includes("redirect loop detected")),
		"Loop detection error logged",
	);
});

QUnit.test("Redirect to unknown route is treated as blocked", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "nonexistent");
	router.initialize();
	await waitForRoute(router, "home");

	const warnings = await captureWarningsAsync(async () => {
		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Blocked, "Unknown redirect target blocked");
	});
	assert.deepEqual(
		warnings.map((w) => w.message),
		['Guard redirect target "nonexistent" is not a known route, treating as blocked'],
		"one warning that names the target",
	);
});

QUnit.test("Guard on redirect target that throws settles as Error", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => {
		throw new Error("guard explosion");
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Error, "Chain settles as Error when guard throws");
});

QUnit.test("Async guard rejecting during redirect chain settles as Error", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", async () => {
		throw new Error("async guard explosion in redirect chain");
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(
		result.status,
		NavigationOutcome.Error,
		"Async rejection in redirect chain settles as Error, not Blocked",
	);
	assert.ok(result.error instanceof Error, "error is captured on result");
});

QUnit.test("Max redirect depth exceeded blocks with error", async function (assert: Assert) {
	// Create a chain that exceeds MAX_REDIRECT_DEPTH (10) using parameterized redirects
	// to the same route with different params (different hashes, avoids visited-set detection).
	let callCount = 0;
	router.addRouteGuard("detail", (ctx: GuardContext) => {
		callCount++;
		const currentId = Number(ctx.toArguments.id ?? "0");
		return { route: "detail", parameters: { id: String(currentId + 1) } };
	});
	router.initialize();
	await waitForRoute(router, "home");

	const errors = await captureErrorsAsync(async () => {
		router.navTo("detail", { id: "0" });
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Blocked, "Depth exceeded blocked");
	});
	// 1 initial guard call + MAX_REDIRECT_DEPTH (10) redirect hops = 11 total
	assert.strictEqual(callCount, 11, "Guard ran for the initial hop plus MAX_REDIRECT_DEPTH (10) redirect hops");
	const chain = Array.from({ length: 11 }, (_, i) => `detail/${i}`).join(" -> ");
	assert.deepEqual(
		errors.map((e) => e.message),
		[`Guard redirect chain exceeded maximum depth (10): ${chain}`],
		"the error names every hash of the chain",
	);
});

QUnit.test("Redirect chain works via parse (browser back/forward)", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	router.addRouteGuard("forbidden", () => true);
	router.initialize();
	await waitForRoute(router, "home");

	// Simulate browser navigation (hash change without navTo)
	HashChanger.getInstance().setHash("protected");
	await waitForRoute(router, "forbidden");
	assert.strictEqual(getHash(), "forbidden", "Parse-path redirect chain resolved");
});

QUnit.test("Redirect to current hash evaluates guards and commits", async function (assert: Assert) {
	let homeGuardCalled = false;
	router.addRouteGuard("protected", () => "home");
	router.addRouteGuard("home", () => {
		homeGuardCalled = true;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Redirected, "Redirected settlement");
	assert.ok(homeGuardCalled, "Guard on redirect target (current hash) was evaluated");
});

QUnit.test("A redirect hop that fails after an async guard settles as Error", async function (assert: Assert) {
	router.addRouteGuard("protected", () => "forbidden");
	// "detail" needs {id}: resolving this redirect throws inside the hop's async continuation.
	router.addRouteGuard("forbidden", async () => "detail");
	router.initialize();
	await waitForRoute(router, "home");

	const recorder = recordHashChanges();
	const errors = await captureErrorsAsync(async () => {
		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Error, "the chain settles as Error");
		assert.ok(result.error instanceof Error, "the error is on the result");
		assert.strictEqual(result.route, "home", "the router stays on the current route");
	});
	recorder.stop();

	assert.deepEqual(
		errors.map((e) => e.message),
		['Guard redirect target "detail" has no valid hash, navigation failed'],
	);
	assert.deepEqual(recorder.hashes, [], "hash unchanged (preflight)");
});

QUnit.test(
	"A redirect chain cancelled from inside a guard does not settle again when a later hop fails",
	async function (assert: Assert) {
		router.addRouteGuard("protected", () => "forbidden");
		router.addRouteGuard("forbidden", async () => ({ route: "detail", parameters: { id: "1" } }));
		router.addRouteGuard("detail", () => {
			router.navTo("home"); // back to the current route: cancels the chain
			return "detail"; // needs {id}: resolving this redirect throws
		});
		router.initialize();
		await waitForRoute(router, "home");

		const statuses = recordSettlements(router);

		const errors = await captureErrorsAsync(async () => {
			router.navTo("protected");
			await flushPromises();
		});

		assert.deepEqual(statuses, [NavigationOutcome.Cancelled], "the cancelled chain settled once");
		assert.deepEqual(errors, [], "the failure of the cancelled chain is not reported");
	},
);

QUnit.test(
	"navTo from a navigationSettled handler during a redirect keeps its pending guards",
	async function (assert: Assert) {
		router.addRouteGuard("protected", () => "forbidden");
		router.addRouteGuard("detail", async () => true);
		router.initialize();
		await waitForRoute(router, "home");

		let navigated = false;
		router.attachNavigationSettled((event: Router$NavigationSettledEvent) => {
			if (event.getParameter("status") === NavigationOutcome.Redirected && !navigated) {
				navigated = true;
				router.navTo("detail", { id: "1" });
			}
		});

		router.navTo("protected");
		const result = await router.navigationSettled();

		assert.deepEqual(
			{ status: result.status, route: result.route, hash: result.hash },
			{ status: NavigationOutcome.Committed, route: "detail", hash: "detail/1" },
			"the handler's navigation finished its async guard and committed",
		);
	},
);

QUnit.test(
	"Guards still run after a redirect failed to change the hash",
	async function (this: SinonTestContext, assert: Assert) {
		router.addRouteGuard("protected", () => "forbidden");
		router.initialize();
		await waitForRoute(router, "home");

		const setHash = this.stub(HashChanger.getInstance(), "setHash").throws(new Error("history unavailable"));
		assert.throws(() => router.navTo("protected"), /history unavailable/, "the failure reaches the caller");
		setHash.restore();

		router.addGuard(() => false);
		router.navTo("detail", { id: "1" });
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Blocked, "the next navigation is guarded");
		assert.strictEqual(getHash(), "", "hash unchanged");
	},
);

QUnit.test(
	"Guards still run after an allowed navTo failed to change the hash",
	async function (this: SinonTestContext, assert: Assert) {
		router.initialize();
		await waitForRoute(router, "home");

		const setHash = this.stub(HashChanger.getInstance(), "setHash").throws(new Error("history unavailable"));
		assert.throws(() => router.navTo("protected"), /history unavailable/, "the failure reaches the caller");
		assert.throws(
			() => router.navTo("protected", {}, false, { skipGuards: true }),
			/history unavailable/,
			"a navTo that skips guards fails the same way",
		);
		setHash.restore();

		router.addGuard(() => false);
		HashChanger.getInstance().setHash("detail/1");
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Blocked, "the next hash change is guarded");
		assert.strictEqual(getHash(), "", "hash restored");
	},
);

QUnit.test(
	"Redirect to the default hash commits when no navigation has committed yet",
	async function (assert: Assert) {
		let allowHome = false;
		let homeLeaveCalls = 0;
		router.addRouteGuard("home", () => allowHome);
		router.addLeaveGuard("home", () => {
			homeLeaveCalls++;
			return true;
		});
		router.addRouteGuard("protected", () => "home");
		router.initialize();
		assert.strictEqual(
			(await router.navigationSettled()).status,
			NavigationOutcome.Blocked,
			"default route blocked",
		);

		allowHome = true;
		const homeMatched = waitForRoute(router, "home");
		router.navTo("protected");
		const result = await router.navigationSettled();

		assert.deepEqual(
			{ status: result.status, route: result.route, hash: result.hash },
			{ status: NavigationOutcome.Redirected, route: "home", hash: "" },
			"settled on the redirect target, not treated as blocked",
		);
		await homeMatched;
		assert.strictEqual(getHash(), "");

		router.navTo("forbidden");
		await router.navigationSettled();
		assert.strictEqual(homeLeaveCalls, 1, "the router is on home: its leave guard runs on the next navigation");
	},
);

QUnit.test(
	"Guard on a redirect target of the initial navigation sees an empty source",
	async function (assert: Assert) {
		let hop: GuardContext | undefined;
		router.addRouteGuard("home", () => "protected");
		router.addRouteGuard("protected", (context: GuardContext) => {
			hop = context;
			return true;
		});
		router.initialize();

		assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Redirected);
		assert.strictEqual(hop!.fromRoute, "", "no source route before the first navigation");
		assert.strictEqual(hop!.fromHash, "", "no source hash before the first navigation");
	},
);

QUnit.test("a redirect commits the route that matches its hash, as navTo() does", async function (assert: Assert) {
	// "items/5" is the hash of "item", but UI5 displays "list": the first route that matches wins.
	router.destroy();
	router = createRouterUnsafe(
		[
			{ name: "home", pattern: "" },
			{ name: "list", pattern: "items/:id:" },
			{ name: "item", pattern: "items/{id}" },
			{ name: "protected", pattern: "protected" },
		],
		{ async: true },
	);
	router.addRouteGuard("protected", () => ({ route: "item", parameters: { id: "5" } }));
	router.initialize();
	await waitForRoute(router, "home");
	const settled: string[] = [];
	for (const navigate of [() => router.navTo("item", { id: "5" }), () => router.navTo("protected")]) {
		navigate();
		await waitForRoute(router, "list");
		settled.push((await router.navigationSettled()).route);
		router.navTo("home");
		await waitForRoute(router, "home");
	}

	assert.deepEqual(settled, ["list", "list"], "navTo() and the redirect are on the route that UI5 displays");
});

QUnit.test("GuardRedirect object without a mandatory parameter settles as Error", async function (assert: Assert) {
	router.addRouteGuard("protected", async () => ({ route: "detail" }));
	router.initialize();
	await waitForRoute(router, "home");

	await captureErrorsAsync(async () => {
		router.navTo("protected");
		const result = await router.navigationSettled();
		assert.strictEqual(result.status, NavigationOutcome.Error, "fails like a string redirect, not Blocked");
		assert.ok(result.error instanceof Error, "the UI5 error is on the result");
	});
});
