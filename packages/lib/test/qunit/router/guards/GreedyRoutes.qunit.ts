import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardFn, GuardRouter } from "ui5/guard/router/types";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import { flushPromises, GuardRouterClass, initHashChanger, waitForRoute, getHash } from "../../testHelpers";

let router: GuardRouter;

const GREEDY_ROUTES = [
	{ name: "home", pattern: "" },
	{ name: "detail", pattern: "detail/{id}" },
	{ name: "audit", pattern: "detail/:rest*:", greedy: true },
	{ name: "other", pattern: "other" },
	{ name: "auditAll", pattern: ":all*:", greedy: true },
];

QUnit.module("Router - Greedy routes", {
	beforeEach: function () {
		initHashChanger();
		router = new GuardRouterClass(GREEDY_ROUTES, { async: true });
	},
	afterEach: function () {
		router.destroy();
		HashChanger.getInstance().setHash("");
	},
});

QUnit.test(
	"the enter guards of every route that matches run, with the context of the first match",
	async function (assert: Assert) {
		const calls: string[] = [];
		const record =
			(name: string): GuardFn =>
			(context) => {
				calls.push(`${name} to ${context.toRoute} ${JSON.stringify(context.toArguments)}`);
				return true;
			};
		router.addRouteGuard("auditAll", record("auditAll"));
		router.addRouteGuard("audit", record("audit"));
		router.addRouteGuard("detail", record("detail"));
		router.addRouteGuard("other", record("other"));
		router.initialize();
		await waitForRoute(router, "home");
		// The greedy route that matches the empty hash as well fires its events after "home".
		await flushPromises();
		calls.length = 0;
		const matched: string[] = [];
		router.attachRouteMatched((event) => matched.push(String(event.getParameter("name"))));

		router.navTo("detail", { id: "1" });
		const settled = await router.navigationSettled();
		await flushPromises();

		assert.deepEqual(settled, { status: NavigationOutcome.Committed, route: "detail", hash: "detail/1" });
		assert.deepEqual(
			calls,
			['detail to detail {"id":"1"}', 'audit to detail {"id":"1"}', 'auditAll to detail {"id":"1"}'],
			"first match, then the greedy routes in the order of their definition",
		);
		assert.deepEqual(matched, ["detail", "audit", "auditAll"], "UI5 matches the same routes");
	},
);

QUnit.test(
	"a guard of a greedy route that is not the first match blocks the navigation",
	async function (assert: Assert) {
		router.addRouteGuard("audit", () => false);
		router.initialize();
		await waitForRoute(router, "home");
		// The greedy route that matches the empty hash as well fires its events after "home".
		await flushPromises();
		const matched: string[] = [];
		router.attachRouteMatched((event) => matched.push(String(event.getParameter("name"))));

		router.navTo("detail", { id: "1" });
		assert.deepEqual(
			await router.navigationSettled(),
			{ status: NavigationOutcome.Blocked, route: "home", hash: "" },
			"navTo() is blocked",
		);
		HashChanger.getInstance().setHash("detail/2");
		assert.strictEqual(
			(await router.navigationSettled()).status,
			NavigationOutcome.Blocked,
			"a hash change as well",
		);
		await flushPromises();

		assert.strictEqual(getHash(), "", "the hash is unchanged");
		assert.deepEqual(matched, [], "no route matched");

		router.navTo("other");
		await waitForRoute(router, "other");
		await flushPromises();
		assert.deepEqual(matched, ["other", "auditAll"], "a hash that the guarded greedy route does not match is free");
	},
);

QUnit.test(
	"a guard of a greedy route redirects the navigation, also in a redirect chain",
	async function (assert: Assert) {
		router.addRouteGuard("other", () => ({ route: "detail", parameters: { id: "1" } }));
		router.addRouteGuard("audit", async () => "home");
		router.initialize();
		await waitForRoute(router, "home");

		router.navTo("other");
		assert.deepEqual(
			await router.navigationSettled(),
			{ status: NavigationOutcome.Redirected, route: "home", hash: "" },
			"the hop to detail/1 ran the guard of the greedy route",
		);
	},
);

QUnit.test("the leave guards of every route that is left run", async function (assert: Assert) {
	const calls: string[] = [];
	let allowed = false;
	router.addLeaveGuard("audit", (context) => {
		calls.push(`audit from ${context.fromRoute} ${context.fromHash}`);
		return allowed;
	});
	router.addLeaveGuard("detail", (context) => {
		calls.push(`detail from ${context.fromRoute} ${context.fromHash}`);
		return true;
	});
	router.initialize();
	router.navTo("detail", { id: "1" });
	await waitForRoute(router, "detail");

	router.navTo("other");
	assert.deepEqual(
		await router.navigationSettled(),
		{ status: NavigationOutcome.Blocked, route: "detail", hash: "detail/1" },
		"the leave guard of the greedy route blocks",
	);
	assert.deepEqual(calls, ["detail from detail detail/1", "audit from detail detail/1"]);

	allowed = true;
	router.navTo("other");
	await waitForRoute(router, "other");
	calls.length = 0;
	router.navTo("home");
	await waitForRoute(router, "home");
	assert.deepEqual(calls, [], "a greedy route that did not match the hash is not left");
});

QUnit.test(
	"a greedy route that still matches is left and entered again, like a first match whose parameters change",
	async function (assert: Assert) {
		const calls: string[] = [];
		for (const name of ["detail", "audit", "auditAll"]) {
			router.addLeaveGuard(name, (context) => {
				calls.push(`leave ${name} for ${context.toHash}`);
				return true;
			});
			router.addRouteGuard(name, (context) => {
				calls.push(`enter ${name} with ${context.toHash}`);
				return true;
			});
		}
		router.initialize();
		router.navTo("detail", { id: "1" });
		await waitForRoute(router, "detail");
		calls.length = 0;

		router.navTo("detail", { id: "2" });
		await waitForRoute(router, "detail");

		assert.deepEqual(
			calls,
			[
				"leave detail for detail/2",
				"leave audit for detail/2",
				"leave auditAll for detail/2",
				"enter detail with detail/2",
				"enter audit with detail/2",
				"enter auditAll with detail/2",
			],
			"every route that matched detail/1 is left, every route that matches detail/2 is entered",
		);
	},
);

QUnit.test(
	"a greedy route is one that is declared greedy, in any form of the route config",
	async function (assert: Assert) {
		router.destroy();
		router = new GuardRouterClass(
			{
				home: { pattern: "" },
				detail: { pattern: "detail/{id}" },
				second: { pattern: "detail/{id}" },
				audit: { name: "auditNamed", pattern: "detail/{id}", greedy: true },
			},
			{ async: true },
		);
		const calls: string[] = [];
		router.addRouteGuard("second", () => calls.push("second") > 0);
		router.addRouteGuard("auditNamed", () => calls.push("auditNamed") > 0);
		router.addRouteGuard("added", () => calls.push("added") > 0);
		router.addRoute({ name: "added", pattern: "detail/{id}", greedy: true });
		router.addRoute({ name: "addedPlain", pattern: "detail/{id}" });
		router.addRouteGuard("addedPlain", () => calls.push("addedPlain") > 0);
		router.initialize();
		await waitForRoute(router, "home");

		router.navTo("detail", { id: "1" });
		await waitForRoute(router, "detail");

		assert.deepEqual(
			calls,
			["auditNamed", "added"],
			"routes that are not greedy do not match after the first match",
		);
	},
);

QUnit.test("a hash that no route matches runs no guard of a greedy route", async function (assert: Assert) {
	router.destroy();
	router = new GuardRouterClass(
		[
			{ name: "home", pattern: "" },
			{ name: "audit", pattern: "detail/{id}", greedy: true },
		],
		{ async: true },
	);
	let calls = 0;
	router.addRouteGuard("audit", () => ++calls > 0);
	router.initialize();
	await waitForRoute(router, "home");

	HashChanger.getInstance().setHash("unknown");
	assert.strictEqual((await router.navigationSettled()).status, NavigationOutcome.Bypassed);
	assert.strictEqual(calls, 0, "no guard ran");

	router.navTo("audit", { id: "1" });
	await waitForRoute(router, "audit");
	assert.strictEqual(calls, 1, "as the first match, the greedy route runs its guards once");
});
