import MobileRouter from "sap/m/routing/Router";
import Component from "sap/ui/core/Component";
import ComponentContainer from "sap/ui/core/ComponentContainer";
import HashChanger from "sap/ui/core/routing/HashChanger";
import UIComponent from "sap/ui/core/UIComponent";
import coreLibrary from "sap/ui/core/library";
import type { GuardRouter } from "ui5/guard/router/types";
import { firstDifference, recordHashes, recordLogs, recordRouter, settle } from "../parityRecorder";
import { flushPromises, getComponentRouter, getHash, GuardRouterClass, initHashChanger } from "../../testHelpers";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import { isPlainObject } from "ui5/guard/router/GuardConfig";

const HistoryDirection = coreLibrary.routing.HistoryDirection;

/** Routes with every kind of pattern segment: mandatory, optional, query and rest. */
const TRACE_ROUTES = [
	{ name: "home", pattern: "" },
	{ name: "page1", pattern: "page1" },
	{ name: "detail", pattern: "detail/{id}" },
	{ name: "search", pattern: "search/{term}:?query:" },
	{ name: "files", pattern: "files/:path*:" },
];

type TraceStep = (router: MobileRouter, trace: string[]) => void;

/**
 * Run `steps` on a router of its own and return everything it did: router and route events with
 * their parameters, hash writes, logged warnings and errors. One router runs at a time, so that
 * no event or hash write of the other router gets into the trace.
 */
function traceRouter(create: () => MobileRouter, steps: TraceStep[]): Promise<string[]> {
	return traceRouterWith(TRACE_ROUTES, create, steps);
}

/** {@link traceRouter} for a router that `create` constructs with `routes`. */
async function traceRouterWith(
	routes: { name: string }[],
	create: () => MobileRouter,
	steps: TraceStep[],
): Promise<string[]> {
	initHashChanger();
	const trace: string[] = [];
	const router = create();
	const stopHashes = recordHashes(trace);
	const stopLogs = recordLogs(trace);
	recordRouter(
		"router",
		router,
		trace,
		routes.map((route) => route.name),
	);
	try {
		for (const [index, step] of steps.entries()) {
			trace.push(`step ${index}`);
			step(router, trace);
			await settle(trace);
			trace.push(`hash "${getHash()}"`);
		}
		return trace;
	} finally {
		stopLogs();
		stopHashes();
		router.destroy();
		HashChanger.getInstance().setHash("");
		await flushPromises();
	}
}

/** Assert that the guard router without guards leaves the same trace as the native router. */
async function assertSameTrace(assert: Assert, steps: TraceStep[], expected: string[]): Promise<void> {
	const config = { async: true };
	const native = await traceRouter(() => new MobileRouter(TRACE_ROUTES, config), steps);
	const guard = await traceRouter(() => new GuardRouterClass(TRACE_ROUTES, config), steps);

	for (const prefix of expected) {
		assert.ok(
			native.some((line) => line.startsWith(prefix)),
			`the native router recorded "${prefix}"`,
		);
	}
	assert.strictEqual(
		firstDifference(guard, native),
		undefined,
		"the guard router leaves the same trace as the native router",
	);
}

/**
 * Assert that the guard router, with the guards that `guarded` registers, leaves the same trace
 * for `guardedSteps` as the native router for `nativeSteps`: what a guard decided has the same
 * effect on events, hash and history as the native navigation it stands for.
 */
async function assertEquivalentTrace(
	assert: Assert,
	nativeSteps: TraceStep[],
	guarded: (router: GuardRouter) => void,
	guardedSteps: TraceStep[],
	expected: string[],
): Promise<void> {
	const config = { async: true };
	const native = await traceRouter(() => new MobileRouter(TRACE_ROUTES, config), nativeSteps);
	const guard = await traceRouter(() => {
		const router = new GuardRouterClass(TRACE_ROUTES, config);
		guarded(router);
		return router;
	}, guardedSteps);

	for (const prefix of expected) {
		assert.ok(
			native.some((line) => line.startsWith(prefix)),
			`the native router recorded "${prefix}"`,
		);
	}
	assert.strictEqual(
		firstDifference(guard, native),
		undefined,
		"the guarded navigation leaves the same trace as its native equivalent",
	);
}

/** navTo as a step; UI5 throws out of navTo when a mandatory parameter is missing. */
const navTo =
	(name: string, parameters?: object, replace?: boolean): TraceStep =>
	(router, trace) => {
		try {
			trace.push(`navTo returns the router: ${router.navTo(name, parameters, replace) === router}`);
		} catch (error) {
			trace.push(`navTo throws: ${String(error)}`);
		}
	};

const browserHash =
	(hash: string): TraceStep =>
	() => {
		HashChanger.getInstance().setHash(hash);
	};

QUnit.module("NativeCompat - Recorded behavior");

QUnit.test("a sequence of navigations fires the same events in the same order", async function (assert: Assert) {
	await assertSameTrace(
		assert,
		[
			(router) => router.initialize(),
			navTo("page1"),
			navTo("detail", { id: "4 2" }),
			navTo("search", { term: "ui5", "?query": { sort: "asc", page: "2" } }),
			navTo("files", { "path*": "a/b/c" }),
			navTo("files"),
			browserHash("unknown/route"),
			() => HashChanger.getInstance().replaceHash("page1", HistoryDirection.NewEntry),
			navTo("page1"),
			navTo("home", {}, true),
		],
		[
			"router beforeRouteMatched page1 ",
			"router route:page1 switched ",
			"router routePatternMatched detail ",
			"router routeMatched search ",
			"router routeMatched files ",
			"router bypassed unknown/route ",
			"hash hashReplaced ",
		],
	);
});

QUnit.test("navTo with a route or parameters that do not resolve behaves the same", async function (assert: Assert) {
	await assertSameTrace(
		assert,
		[
			(router) => router.initialize(),
			navTo("nonexistent"),
			// The mandatory parameter is missing.
			navTo("detail"),
			navTo("page1"),
		],
		["router routeMatched page1 "],
	);
});

QUnit.test("stop and initialize cycles fire the same events", async function (assert: Assert) {
	await assertSameTrace(
		assert,
		[
			(router) => router.initialize(),
			navTo("page1"),
			(router) => router.stop(),
			// A hash change while stopped fires nothing; initialize() then matches the current hash.
			browserHash("detail/1"),
			(router) => router.initialize(),
			(router) => router.initialize(),
			(router) => router.stop(),
			browserHash("page1"),
			// initialize(true) ignores the current hash, and a navTo() to it changes nothing.
			(router) => router.initialize(true),
			navTo("page1"),
			browserHash("detail/2"),
			(router, trace) => {
				trace.push(`initialized: ${router.isInitialized()}, stopped: ${router.isStopped()}`);
			},
		],
		["router routeMatched detail "],
	);
});

QUnit.test("a router that starts with initialize(true) fires the same events", async function (assert: Assert) {
	await assertSameTrace(
		assert,
		[
			(router) => router.initialize(true),
			// The hash that the router ignored is the one it shows.
			navTo("home"),
			navTo("page1"),
			navTo("home"),
		],
		["router routeMatched page1 ", "router routeMatched home "],
	);
});

QUnit.test("a hash that is parsed again matches its route again", async function (assert: Assert) {
	const matches = (trace: string[]): number =>
		trace.filter((line) => line.startsWith("router routeMatched page1 ")).length;
	await assertSameTrace(
		assert,
		[
			(router) => router.initialize(),
			navTo("page1"),
			(router) => router.parse("page1"),
			(_router, trace) => {
				trace.push(`page1 matched ${matches(trace)} times`);
			},
		],
		["page1 matched 2 times"],
	);
});

QUnit.test("a redirected navTo() behaves like a native navTo() to the target", async function (assert: Assert) {
	await assertEquivalentTrace(
		assert,
		[
			(router) => router.initialize(),
			navTo("page1"),
			navTo("detail", { id: "7" }),
			navTo("home"),
			navTo("detail", { id: "7" }, true),
		],
		(router) => {
			router.addRouteGuard("files", () => ({ route: "detail", parameters: { id: "7" } }));
			router.addRouteGuard("search", () => "files");
		},
		[
			(router) => router.initialize(),
			navTo("page1"),
			// Redirected in one hop, and in a chain.
			navTo("files"),
			navTo("home"),
			navTo("search", { term: "ui5" }, true),
		],
		["hash hashSet detail/7 ", "hash hashReplaced detail/7 ", "router routeMatched detail "],
	);
});

QUnit.test(
	"a navTo() that is redirected to the route that is shown changes nothing, as if the router had not been asked",
	async function (assert: Assert) {
		await assertEquivalentTrace(
			assert,
			[
				(router) => router.initialize(),
				navTo("page1"),
				(_router, trace) => {
					trace.push("navTo returns the router: true");
				},
				navTo("home"),
			],
			(router) => {
				router.addRouteGuard("files", () => "page1");
			},
			[(router) => router.initialize(), navTo("page1"), navTo("files"), navTo("home")],
			["router routeMatched page1 ", "router routeMatched home "],
		);
	},
);

QUnit.test("greedy routes match and fire their events as with the native router", async function (assert: Assert) {
	const routes = [...TRACE_ROUTES, { name: "audit", pattern: "detail/:rest*:", greedy: true }];
	const steps: TraceStep[] = [
		(router) => router.initialize(),
		navTo("detail", { id: "1" }),
		browserHash("detail/2"),
		navTo("page1"),
		navTo("audit", { "rest*": "3" }),
	];
	const trace = (create: () => MobileRouter): Promise<string[]> => traceRouterWith(routes, create, steps);
	const native = await trace(() => new MobileRouter(routes, { async: true }));
	const guard = await trace(() => new GuardRouterClass(routes, { async: true }));
	const guarded = await trace(() => {
		const router = new GuardRouterClass(routes, { async: true });
		router.addGuard(() => true);
		router.addRouteGuard("audit", () => true);
		router.addLeaveGuard("audit", () => true);
		return router;
	});

	assert.ok(
		native.some((line) => line.startsWith("router routeMatched audit ")),
		"the native router matched the greedy route",
	);
	assert.strictEqual(
		firstDifference(guard, native),
		undefined,
		"the guard router without guards leaves the same trace",
	);
	assert.strictEqual(firstDifference(guarded, native), undefined, "and with guards that allow");
});

/** Per step of `trace`, what `pattern` captures in the lines of that step. */
function perStep(trace: string[], pattern: RegExp): string[][] {
	const steps: string[][] = [];
	for (const line of trace) {
		if (line.startsWith("step ")) steps.push([]);
		const captured = pattern.exec(line)?.[1];
		if (captured !== undefined) steps.at(-1)?.push(captured);
	}
	return steps;
}

/** As its first step, the guard router gets a leave and an enter guard per route that allow and record their run in the trace. */
function withRecordingGuards(routes: { name: string }[], steps: TraceStep[]): TraceStep[] {
	const [first, ...rest] = steps;
	return [
		(router, trace) => {
			if (!(router instanceof GuardRouterClass)) throw new Error("Not a guard router");
			for (const { name } of routes) {
				router.addLeaveGuard(name, () => trace.push(`guard leave ${name}`) > 0);
				router.addRouteGuard(name, () => trace.push(`guard enter ${name}`) > 0);
			}
			first?.(router, trace);
		},
		...rest,
	];
}

const withoutGuardLines = (trace: string[]): string[] => trace.filter((line) => !line.startsWith("guard "));

QUnit.test(
	"leave and enter guards run for the routes that the native router matched before and matches after a navigation, a greedy route that still matches included",
	async function (assert: Assert) {
		const routes = [...TRACE_ROUTES, { name: "audit", pattern: "detail/:rest*:", greedy: true }];
		const steps: TraceStep[] = [
			(router) => router.initialize(),
			navTo("detail", { id: "1" }),
			browserHash("detail/2"),
			navTo("page1"),
		];
		const native = await traceRouterWith(routes, () => new MobileRouter(routes, { async: true }), steps);
		const guard = await traceRouterWith(
			routes,
			() => new GuardRouterClass(routes, { async: true }),
			withRecordingGuards(routes, steps),
		);

		const matched = perStep(native, /^router route:(\S+) matched /);
		assert.deepEqual(
			matched,
			[["home"], ["detail", "audit"], ["detail", "audit"], ["page1"]],
			"the native router matches the greedy route again for the second detail hash",
		);
		assert.deepEqual(
			perStep(guard, /^guard enter (\S+)$/),
			matched,
			"enter guards run for the routes that the native router matches for the hash",
		);
		assert.deepEqual(
			perStep(guard, /^guard leave (\S+)$/),
			[[], ...matched.slice(0, -1)],
			"leave guards run for the routes that the native router matched for the hash before",
		);
		assert.strictEqual(
			firstDifference(withoutGuardLines(guard), native),
			undefined,
			"and the guard router leaves the trace of the native router",
		);
	},
);

QUnit.test(
	"after stop() and initialize(true), the leave guard runs for the route that the native router switches from",
	async function (assert: Assert) {
		const steps: TraceStep[] = [
			(router) => router.initialize(),
			navTo("page1"),
			(router) => router.stop(),
			(router) => router.initialize(true),
			navTo("detail", { id: "1" }),
		];
		const config = { async: true };
		const native = await traceRouter(() => new MobileRouter(TRACE_ROUTES, config), steps);
		const guard = await traceRouter(
			() => new GuardRouterClass(TRACE_ROUTES, config),
			withRecordingGuards(TRACE_ROUTES, steps),
		);

		const switched = perStep(native, /^router route:(\S+) switched /);
		assert.deepEqual(
			switched,
			[[], ["home"], ["page1"], [], ["page1"]],
			"the native router switches from the route when it stops, and again on the navigation after initialize(true)",
		);
		assert.deepEqual(
			perStep(guard, /^guard leave (\S+)$/),
			switched.with(2, []),
			"leave guards run for the route that the native router switches from on each navigation",
		);
		assert.strictEqual(
			firstDifference(withoutGuardLines(guard), native),
			undefined,
			"and the guard router leaves the trace of the native router",
		);
	},
);

QUnit.test("a hash that several routes could match resolves to the same route", function (assert: Assert) {
	const routes = [
		{ name: "detail", pattern: "detail/{id}" },
		{ name: "optional", pattern: "optional/:id:" },
		{ name: "catchAll", pattern: ":all*:" },
	];
	const native = new MobileRouter(routes, { async: true });
	const guard = new GuardRouterClass(routes, { async: true });
	try {
		for (const hash of ["", "detail/1", "optional", "optional/1", "anything/else", "detail/a%20b?x=1"]) {
			assert.deepEqual(
				guard.getRouteInfoByHash(hash),
				native.getRouteInfoByHash(hash),
				`getRouteInfoByHash("${hash}") returns the same route and arguments`,
			);
			assert.strictEqual(guard.match(hash), native.match(hash), `match("${hash}") returns the same result`);
		}
	} finally {
		native.destroy();
		guard.destroy();
	}
});

QUnit.module("NativeCompat - Two routers on one hash changer");

const SHARED_FIXTURE = "ui5.guard.router.qunit.fixtures.manifest";

interface SharedRouters<T extends MobileRouter> {
	/** The router of the app component, which is informed of a hash change first. */
	app: T;
	/** The router of a component that the app embeds in a ComponentContainer. */
	embedded: T;
	trace: string[];
}

/**
 * Run `act` on two components with routing of which none is a routing target of the other: UI5
 * gives the routers of both the hash changer of the root, so each parses every hash.
 */
async function withSharedHashChanger<T extends MobileRouter>(
	routerClass: string,
	routerOf: (component: Component) => T,
	act: (routers: SharedRouters<T>) => Promise<void>,
): Promise<string[]> {
	const response = await fetch(sap.ui.require.toUrl("ui5/guard/router/qunit/fixtures/manifest/manifest.json"));
	const manifest: unknown = await response.json();
	if (!isPlainObject(manifest) || !isPlainObject(manifest["sap.ui5"])) {
		throw new TypeError("the fixture manifest has no sap.ui5 section");
	}
	const ui5 = manifest["sap.ui5"];
	ui5.routing = {
		config: { routerClass, async: true },
		routes: [
			{ name: "home", pattern: "" },
			{ name: "page1", pattern: "page1" },
			{ name: "detail", pattern: "detail/{id}" },
		],
		targets: {},
	};
	initHashChanger();
	const trace: string[] = [];
	const stopHashes = recordHashes(trace);
	const appComponent = await Component.create({ id: "sharedApp", name: SHARED_FIXTURE, manifest });
	const embeddedComponent = await Component.create({ id: "sharedEmbedded", name: SHARED_FIXTURE, manifest });
	const container = new ComponentContainer({ component: embeddedComponent.getId() }).placeAt("qunit-fixture");
	try {
		const app = routerOf(appComponent);
		const embedded = routerOf(embeddedComponent);
		recordRouter("app", app, trace);
		recordRouter("embedded", embedded, trace);
		app.initialize();
		embedded.initialize();
		await settle(trace);
		await act({ app, embedded, trace });
		await settle(trace);
		return trace;
	} finally {
		stopHashes();
		container.destroy();
		appComponent.destroy();
		HashChanger.getInstance().setHash("");
		await flushPromises();
	}
}

function nativeRouterOf(component: Component): MobileRouter {
	const router = component instanceof UIComponent ? component.getRouter() : undefined;
	if (!(router instanceof MobileRouter)) throw new Error("The component has no sap.m router");
	return router;
}

QUnit.test("two guard routers without guards behave like two native routers", async function (assert: Assert) {
	const act = async ({ app, embedded, trace }: SharedRouters<MobileRouter>): Promise<void> => {
		trace.push(`one hash changer: ${app.getHashChanger() === embedded.getHashChanger()}`);
		for (const step of [
			(): unknown => HashChanger.getInstance().setHash("page1"),
			(): unknown => app.navTo("detail", { id: "1" }),
			(): unknown => embedded.navTo("home"),
			(): unknown => embedded.navTo("page1", {}, true),
			(): unknown => app.stop(),
			(): unknown => HashChanger.getInstance().setHash("detail/2"),
			(): unknown => app.initialize(true),
			(): unknown => HashChanger.getInstance().setHash(""),
		]) {
			step();
			await settle(trace);
			trace.push("step done");
		}
	};
	const native = await withSharedHashChanger("sap.m.routing.Router", nativeRouterOf, act);
	const guard = await withSharedHashChanger("ui5.guard.router.Router", nativeRouterOf, act);

	assert.ok(native.includes("one hash changer: true"), "UI5 gives both routers the hash changer of the root");
	assert.strictEqual(
		firstDifference(guard, native),
		undefined,
		"the guard routers leave the trace of the native ones",
	);
	const matches = (who: string): number => native.filter((line) => line.startsWith(`${who} routeMatched `)).length;
	assert.strictEqual(matches("app"), 6, "the native app router matched each hash that it was not stopped for");
	assert.strictEqual(matches("embedded"), 7, "the native embedded router matched every hash");
});

QUnit.test(
	"a hash change that the first router redirects is not parsed by the second router after the target",
	async function (assert: Assert) {
		const trace = await withSharedHashChanger("ui5.guard.router.Router", getComponentRouter, async (routers) => {
			routers.app.addRouteGuard("page1", () => ({ route: "detail", parameters: { id: "1" } }));

			HashChanger.getInstance().setHash("page1");
			await settle(routers.trace);

			assert.strictEqual(getHash(), "detail/1", "the URL shows the redirect target");
			assert.deepEqual(
				await routers.embedded.navigationSettled(),
				{ status: NavigationOutcome.Committed, route: "detail", hash: "detail/1" },
				"the second router is on the route that the URL shows",
			);
		});

		assert.deepEqual(
			trace.filter((line) => line.startsWith("embedded routeMatched ")).map((line) => line.split(" ")[2]),
			["home", "detail"],
			"UI5 reports the redirected hash to it after the target: it is out of date and matches no route",
		);
	},
);

QUnit.test(
	"a hash change that the first router blocks is parsed by the second router, which follows the URL back",
	async function (assert: Assert) {
		const trace = await withSharedHashChanger("ui5.guard.router.Router", getComponentRouter, async (routers) => {
			routers.app.addRouteGuard("page1", () => false);

			HashChanger.getInstance().setHash("page1");
			await settle(routers.trace);

			assert.strictEqual(getHash(), "", "the URL is back");
			assert.deepEqual(
				await routers.embedded.navigationSettled(),
				{ status: NavigationOutcome.Committed, route: "home", hash: "" },
				"the second router is on the route that the URL shows",
			);
			assert.deepEqual(
				await routers.app.navigationSettled(),
				{ status: NavigationOutcome.Blocked, route: "home", hash: "" },
				"the first router has blocked",
			);
		});

		assert.deepEqual(
			trace.filter((line) => line.startsWith("embedded routeMatched ")).map((line) => line.split(" ")[2]),
			["home", "page1", "home"],
			"the second router shows each hash while the URL shows it, as a native router next to a guard router does",
		);
	},
);
