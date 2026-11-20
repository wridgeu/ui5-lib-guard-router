import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardContext, GuardRedirect, GuardRouter, Router$NavigationSettledEvent } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { Route$PatternMatchedEvent } from "sap/ui/core/routing/Route";
import {
	addGuardUnsafe,
	addRouteGuardUnsafe,
	assertBlocked,
	createdRouterHooks,
	createPromiseLike,
	flushPromises,
	GuardRouterClass,
	recordSettlements,
	waitForRoute,
	routerHooks,
	getHash,
} from "../../testHelpers";

let router: GuardRouter;

const standardHooks = routerHooks(
	(created) => {
		router = created;
	},
	() => router,
);

QUnit.module("Router - Guard allows navigation", standardHooks);

QUnit.test("Guard returning true allows navigation", async function (assert: Assert) {
	router.addGuard(() => true);
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(getHash(), "protected", "Guard allowed navigation to protected");
});

QUnit.test("Async guard returning true allows navigation", async function (assert: Assert) {
	router.addGuard(async () => true);
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(getHash(), "protected", "Async guard allowed navigation");
});

QUnit.test("Promise-like guard returning true allows navigation", async function (assert: Assert) {
	const promiseLike = createPromiseLike(true);
	router.addGuard(() => promiseLike);
	router.initialize();
	await waitForRoute(router, "home");
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(getHash(), "protected", "Promise-like guard allowed navigation");
});

QUnit.test("Promise-like guard returning false blocks navigation", async function (assert: Assert) {
	const promiseLike = createPromiseLike(false);
	router.initialize();
	await waitForRoute(router, "home");
	router.addGuard(() => promiseLike);
	await assertBlocked(assert, router, () => router.navTo("protected"), "Promise-like guard blocked navigation");
});

QUnit.test("Route-specific guard returning true allows navigation", async function (assert: Assert) {
	router.addRouteGuard("protected", () => true);
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(getHash(), "protected", "Route guard allowed navigation");
});

QUnit.module("Router - Guard blocks navigation", standardHooks);

QUnit.test("Guard returning false blocks navigation", async function (assert: Assert) {
	router.addGuard(() => false);
	router.initialize();
	await assertBlocked(assert, router, () => router.navTo("protected"), "Navigation was blocked");
});

QUnit.test("Async guard returning false blocks navigation", async function (assert: Assert) {
	router.addGuard(async () => false);
	router.initialize();
	await assertBlocked(assert, router, () => router.navTo("protected"), "Async guard blocked navigation");
});

QUnit.test("Route-specific guard returning false blocks navigation", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	router.initialize();
	await assertBlocked(assert, router, () => router.navTo("protected"), "Route guard blocked navigation");
});

QUnit.test("Guard throwing an error produces Error settlement", async function (assert: Assert) {
	const thrownError = new Error("Guard error");
	router.addGuard(() => {
		throw thrownError;
	});
	router.initialize();
	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Error, "Status is Error");
	assert.strictEqual(result.error, thrownError, "Error is the thrown value");
});

QUnit.test("Guard returning rejected Promise produces Error settlement", async function (assert: Assert) {
	const rejectedError = new Error("Rejected");
	router.addGuard(() => Promise.reject(rejectedError));
	router.initialize();
	router.navTo("protected");
	const result = await router.navigationSettled();
	assert.strictEqual(result.status, NavigationOutcome.Error, "Status is Error");
	assert.strictEqual(result.error, rejectedError, "Error is the rejected value");
});

QUnit.module("Router - Guard redirects", standardHooks);

QUnit.test("Guard returning string redirects to named route", async function (assert: Assert) {
	router.addRouteGuard("forbidden", () => "protected");
	router.initialize();
	await waitForRoute(router, "home"); // init settles on home

	router.navTo("forbidden");
	await waitForRoute(router, "protected");
	assert.strictEqual(getHash(), "protected", "Redirected to the named route");
});

QUnit.test("Async guard returning string redirects", async function (assert: Assert) {
	router.addRouteGuard("forbidden", async () => "protected");
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("forbidden");
	await waitForRoute(router, "protected");
	assert.strictEqual(getHash(), "protected", "Async guard redirected");
});

QUnit.module("Router - Guard context", standardHooks);

QUnit.test("Guard receives correct context", async function (assert: Assert) {
	let capturedContext: GuardContext | null = null;
	router.addGuard((context: GuardContext) => {
		capturedContext = context;
		return true;
	});
	router.initialize();
	router.navTo("detail", { id: "99" });
	await waitForRoute(router, "detail");

	assert.ok(capturedContext, "Context was captured");
	assert.strictEqual(capturedContext!.toRoute, "detail", "toRoute is correct");
	assert.strictEqual(capturedContext!.toHash, "detail/99", "toHash is correct");
	assert.deepEqual(capturedContext!.toArguments, { id: "99" }, "toArguments is correct");
});

QUnit.test("Guard context has no ownerComponent when the router has no owner", async function (assert: Assert) {
	let capturedContext: GuardContext | null = null;
	router.addGuard((context: GuardContext) => {
		capturedContext = context;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	assert.ok(capturedContext, "Context was captured");
	assert.ok("ownerComponent" in capturedContext!, "the context has the property");
	assert.strictEqual(capturedContext!.ownerComponent, undefined, "ownerComponent is undefined");
});

QUnit.module("Router - Guard execution order", standardHooks);

QUnit.test("Multiple global guards run sequentially, first rejection wins", async function (assert: Assert) {
	const order: number[] = [];
	router.initialize();
	await waitForRoute(router, "home");

	router.addGuard(() => {
		order.push(1);
		return true;
	});
	router.addGuard(() => {
		order.push(2);
		return false;
	});
	router.addGuard(() => {
		order.push(3);
		return true;
	});

	router.navTo("protected");
	await router.navigationSettled();
	assert.deepEqual(order, [1, 2], "Guards ran sequentially and stopped at first rejection");
});

QUnit.test("Global guards run before route-specific guards", async function (assert: Assert) {
	const order: string[] = [];
	router.addGuard(() => {
		order.push("global");
		return true;
	});
	router.addRouteGuard("protected", () => {
		order.push("route");
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	order.length = 0;
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.deepEqual(order, ["global", "route"], "Global guard ran before route guard");
});

QUnit.test(
	"Route guards on one route run in registration order, first rejection wins",
	async function (assert: Assert) {
		const order: number[] = [];
		router.addRouteGuard("protected", () => {
			order.push(1);
			return true;
		});
		router.addRouteGuard("protected", {
			beforeEnter: () => {
				order.push(2);
				return true;
			},
		});
		router.addRouteGuard("protected", () => {
			order.push(3);
			return false;
		});
		router.addRouteGuard("protected", () => {
			order.push(4);
			return true;
		});
		router.initialize();
		await waitForRoute(router, "home");

		router.navTo("protected");
		assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Blocked);
		assert.deepEqual(order, [1, 2, 3]);
	},
);

QUnit.test("Route guard only runs for its route", async function (assert: Assert) {
	let protectedGuardCalls = 0;
	router.addRouteGuard("protected", () => {
		protectedGuardCalls++;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");
	router.navTo("forbidden");
	await waitForRoute(router, "forbidden");
	assert.strictEqual(protectedGuardCalls, 0, "Protected route guard did not run for the other routes");

	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.strictEqual(protectedGuardCalls, 1, "It ran for its own route");
});

QUnit.test("Navigation commits without any guards", async function (assert: Assert) {
	router.initialize();
	router.navTo("protected");
	await waitForRoute(router, "protected");
	assert.deepEqual(await router.navigationSettled(), {
		status: NavigationOutcome.Committed,
		route: "protected",
		hash: "protected",
	});
	assert.strictEqual(getHash(), "protected");
});

QUnit.module("Router - Guard invalid values", standardHooks);

QUnit.test("Guard returning invalid value treats as block", async function (assert: Assert) {
	addGuardUnsafe(router, () => 42);
	router.initialize();
	await assertBlocked(assert, router, () => router.navTo("protected"), "Invalid guard return treated as block");
});

QUnit.test("Guard returning invalid redirect object treats as block", async function (assert: Assert) {
	addRouteGuardUnsafe(router, "protected", () => ({ route: "" }));
	router.initialize();
	await waitForRoute(router, "home");
	await assertBlocked(assert, router, () => router.navTo("protected"), "Invalid redirect object treated as block");
});

QUnit.module("Router - GuardRedirect object", standardHooks);

QUnit.test("Guard returning GuardRedirect object redirects to route", async function (assert: Assert) {
	router.addRouteGuard("forbidden", (): GuardRedirect => ({ route: "protected" }));
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("forbidden");
	await waitForRoute(router, "protected");
	assert.strictEqual(getHash(), "protected", "Redirected via GuardRedirect");
});

QUnit.test("Guard returning GuardRedirect with parameters redirects correctly", async function (assert: Assert) {
	let matchedArgs: object | undefined;
	router.getRoute("detail")!.attachPatternMatched((event: Route$PatternMatchedEvent) => {
		matchedArgs = event.getParameter("arguments");
	});
	router.addRouteGuard("forbidden", (): GuardRedirect => ({
		route: "detail",
		parameters: { id: "error-403" },
	}));
	router.initialize();
	router.navTo("forbidden");
	await waitForRoute(router, "detail");
	assert.strictEqual(getHash(), "detail/error-403", "Redirect landed with correct params");
	assert.deepEqual(matchedArgs, { id: "error-403" }, "Redirect parameters propagated to matched event");
});

QUnit.test("Async guard returning GuardRedirect works", async function (assert: Assert) {
	router.addRouteGuard("protected", async (): Promise<GuardRedirect> => ({ route: "forbidden" }));
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "forbidden");
	assert.strictEqual(getHash(), "forbidden", "Async GuardRedirect redirected");
});

QUnit.module("Router - Initial navigation recovery", standardHooks);

QUnit.test("Blocked initial navigation falls back to the default hash", async function (assert: Assert) {
	router.addRouteGuard("protected", () => false);
	HashChanger.getInstance().setHash("protected");
	router.initialize();
	await waitForRoute(router, "home");
	assert.strictEqual(getHash(), "", "Blocked initial navigation restored the default hash");
});

QUnit.test(
	"Blocked initial navigation does not fall back when a navigationSettled handler navigated",
	async function (assert: Assert) {
		router.addRouteGuard("protected", () => false);
		HashChanger.getInstance().setHash("protected");
		const statuses = recordSettlements(router);
		router.attachNavigationSettled((event: Router$NavigationSettledEvent) => {
			if (event.getParameter("status") === NavigationOutcome.Blocked) router.navTo("forbidden");
		});

		router.initialize();
		await waitForRoute(router, "forbidden");
		await flushPromises();

		assert.deepEqual(statuses, [NavigationOutcome.Blocked, NavigationOutcome.Committed]);
		assert.strictEqual(getHash(), "forbidden", "the handler's route is kept");
	},
);

QUnit.test("Blocked default route on initial navigation stays blocked", async function (assert: Assert) {
	router.addRouteGuard("home", () => false);
	await assertBlocked(assert, router, () => router.initialize(), "Blocked default route did not match");
	assert.strictEqual(getHash(), "", "Hash stays on the default target");
});

QUnit.test("Blocked default route can be entered once its guard allows", async function (assert: Assert) {
	let allow = false;
	router.addRouteGuard("home", () => allow);
	router.initialize();
	assert.strictEqual(
		(await router.navigationSettled()).status,
		NavigationOutcome.Blocked,
		"initial navigation blocked",
	);

	// The hash already is the default hash, so navTo() cannot cause a hash change.
	allow = true;
	const homeMatched = waitForRoute(router, "home");
	router.navTo("home");
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Committed, "navigation committed without a hash change");
	assert.strictEqual(result.route, "home");
	await homeMatched;
});

QUnit.test("Blocked default route can be entered with skipGuards", async function (assert: Assert) {
	router.addRouteGuard("home", () => false);
	router.initialize();
	assert.strictEqual(
		(await router.navigationSettled()).status,
		NavigationOutcome.Blocked,
		"initial navigation blocked",
	);

	const homeMatched = waitForRoute(router, "home");
	router.navTo("home", {}, false, { skipGuards: true });
	const result = await router.navigationSettled();

	assert.strictEqual(result.status, NavigationOutcome.Committed, "navigation committed without a hash change");
	assert.strictEqual(result.route, "home");
	await homeMatched;
});

QUnit.module(
	"Router - Query and optional parameters of a guarded route",
	createdRouterHooks(() => router),
);

function createProductsRouter(): GuardRouter {
	return new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "protected", pattern: "protected" },
			{ name: "products", pattern: "products/:id::?query:" },
		],
		{ async: true },
	);
}

QUnit.test(
	"toArguments holds a query as an object under ?query, and undefined for an optional parameter that is left out",
	async function (assert: Assert) {
		router = createProductsRouter();
		let toArguments: GuardContext["toArguments"] | undefined;
		router.addRouteGuard("products", (context) => {
			toArguments = context.toArguments;
			return true;
		});
		router.initialize();
		await waitForRoute(router, "home");

		HashChanger.getInstance().setHash("products?tab=notes");
		await waitForRoute(router, "products");
		assert.deepEqual(toArguments?.["?query"], { tab: "notes" }, "the query after a hash change");
		assert.strictEqual(toArguments?.id, undefined, "the optional parameter that the hash leaves out");

		router.navTo("products", { id: "7", "?query": { tab: "price" } });
		await waitForRoute(router, "products");
		assert.deepEqual(toArguments, { id: "7", "?query": { tab: "price" } }, "after navTo()");
	},
);

QUnit.test("GuardRedirect.parameters takes a query as an object under ?query", async function (assert: Assert) {
	router = createProductsRouter();
	const parameters = { id: "7", "?query": { tab: "notes" } };
	router.addRouteGuard("protected", (): GuardRedirect => ({ route: "products", parameters }));
	let toArguments: GuardContext["toArguments"] | undefined;
	router.addRouteGuard("products", (context) => {
		toArguments = context.toArguments;
		return true;
	});
	router.initialize();
	await waitForRoute(router, "home");

	router.navTo("protected");
	await waitForRoute(router, "products");
	assert.deepEqual(toArguments, parameters, "the redirect target gets the parameters in the shape they were passed");
});
