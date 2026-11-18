import NavContainer from "sap/m/NavContainer";
import MobileRouter from "sap/m/routing/Router";
import Component from "sap/ui/core/Component";
import ComponentContainer from "sap/ui/core/ComponentContainer";
import View from "sap/ui/core/mvc/View";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type Router from "sap/ui/core/routing/Router";
import type UIComponent from "sap/ui/core/UIComponent";
import { drain, firstDifference, recordHashes, recordLogs, recordRouter, settle, until } from "./parityRecorder";
import { initHashChanger, loadModule } from "./testHelpers";

/**
 * Differential tests for a component displayed as a routing target: the same parent and child
 * app runs once per flavor, and everything observable is recorded into a trace (browser hash,
 * routing events of both routers with their parameters, displayed targets, the pages of both
 * NavContainers, title history, logged warnings and errors). The guard router must leave the
 * same trace as the native sap.m.routing.Router.
 *
 * Differences that guards cause on purpose (blocks, redirects, a parent route that waits for a
 * pending guard) are not compared here, see docs/reference/upstream-parity.md.
 */

const FIXTURE = "ui5.guard.router.qunit.fixtures.parity";
const FIXTURE_PATH = "ui5/guard/router/qunit/fixtures/parity";
const ALLOW_GUARD = "module:ui5.guard.router.qunit.fixtures.guards.allowGuard";

// The first router of a page subscribes the routers' hash changer to the HashChanger. Without this
// one the recorder would subscribe first in the first run, and record a hash change before the
// routers handle it, and after them in every later run.
void new MobileRouter([], { async: true });

const FLAVORS = {
	/** The reference: parent and child use the native router. */
	native: { routerClass: "sap.m.routing.Router", child: "childNative", guards: false },
	/** Parent and child use the guard router, no guard is registered. */
	guard: { routerClass: "ui5.guard.router.Router", child: "childNoGuards", guards: false },
	/** Parent and child use the guard router, each with a lazily loaded guard that always allows. */
	allow: { routerClass: "ui5.guard.router.Router", child: "childAllow", guards: true },
};
type Flavor = keyof typeof FLAVORS;

interface ParentManifest {
	"sap.ui5": {
		componentUsages: { child: { name: string } };
		routing: { config: Record<string, unknown> };
	};
}

interface Probe {
	created: ((component: UIComponent) => void) | undefined;
	guardOwners: (string | undefined)[];
}

interface App {
	parentRouter: Router;
	/** The router of the child component; throws while the parent has not displayed the child. */
	childRouter: () => Router;
}

interface Step {
	label: string;
	act: (app: App) => void;
	/** Prefixes of the trace lines that end the step, see `describeEvent` in parityRecorder. */
	expect: string[];
}

interface Scenario {
	/** The browser hash the app starts with, as on a page load. */
	startHash: string;
	/** Prefixes of the trace lines that end the start of the app. */
	started: string[];
	steps: Step[];
	/**
	 * Compare what was recorded, not in which order: for a scenario in which the native router
	 * itself does two things in an order that depends on how fast a view loads.
	 */
	anyOrder?: true;
}

/** The parent manifest of the fixture with the router class and the child of `flavor`. */
async function loadParentManifest(flavor: Flavor): Promise<ParentManifest> {
	const { routerClass, child, guards } = FLAVORS[flavor];
	const response = await fetch(sap.ui.require.toUrl(`${FIXTURE_PATH}/manifest.json`));
	const manifest: ParentManifest = await response.json();
	manifest["sap.ui5"].componentUsages.child.name = `${FIXTURE}.${child}`;
	const config = manifest["sap.ui5"].routing.config;
	config.routerClass = routerClass;
	if (guards) {
		config.guardRouter = { guards: { "*": [ALLOW_GUARD] } };
	}
	return manifest;
}

/** The pages of the NavContainer that the routing targets of `component` are placed in. */
function navState(component: UIComponent | undefined): unknown {
	const root = component?.getRootControl();
	const nav = root instanceof View ? root.byId("app") : undefined;
	if (!(nav instanceof NavContainer)) {
		return null;
	}
	return {
		pages: nav.getPages().map((page) => page.getId()),
		current: nav.getCurrentPage()?.getId(),
		previous: nav.getPreviousPage()?.getId(),
		top: nav.currentPageIsTopPage(),
	};
}

function routerState(component: UIComponent | undefined): unknown {
	const router = component?.getRouter();
	if (!router) {
		return null;
	}
	return {
		initialized: router.isInitialized(),
		stopped: router.isStopped(),
		titles: router.getTitleHistory(),
	};
}

/**
 * Run `scenario` on the fixture app of `flavor` and return the trace of what it did. `guardOwners`
 * receives the IDs of the components whose router ran the allowing guard.
 */
async function run(
	flavor: Flavor,
	scenario: Scenario,
	currentPageWarnings: string[] = [],
	guardOwners: (string | undefined)[] = [],
): Promise<string[]> {
	const probe = await loadModule<Probe>(`${FIXTURE_PATH}/probe`);
	probe.guardOwners = guardOwners;
	const manifest = await loadParentManifest(flavor);
	const trace: string[] = [];
	// The parent first, then the child once the parent displays it.
	const components: UIComponent[] = [];
	const snapshot = (label: string): void => {
		const [parent, child] = components;
		const state = {
			hash: HashChanger.getInstance().getHash(),
			parent: { pages: navState(parent), router: routerState(parent) },
			child: { pages: navState(child), router: routerState(child) },
		};
		trace.push(`state after ${label} ${JSON.stringify(state)}`);
	};

	// The first router to initialize would otherwise initialize the HashChanger and report its hash.
	HashChanger.getInstance().init();
	initHashChanger();
	HashChanger.getInstance().setHash(scenario.startHash);
	const stopHashes = recordHashes(trace);
	const stopLogs = recordLogs(trace, currentPageWarnings);
	probe.created = (component) => {
		recordRouter(components.length === 0 ? "parent" : "child", component.getRouter(), trace);
		components.push(component);
	};
	let container: ComponentContainer | undefined;

	try {
		// A fixed ID makes every control ID the same in each run.
		const parent = await Component.create({ id: "parity", name: FIXTURE, manifest });
		container = new ComponentContainer({ component: parent.getId() }).placeAt("qunit-fixture");
		const created = components.at(0);
		if (!created) {
			throw new Error("The parent component did not report its creation");
		}
		const app: App = {
			parentRouter: created.getRouter(),
			childRouter: () => {
				const child = components.at(1);
				if (!child) {
					throw new Error("The parent has not displayed the child component");
				}
				return child.getRouter();
			},
		};

		await until(trace, 0, scenario.started, `${flavor}: start with hash "${scenario.startHash}"`);
		await settle(trace);
		snapshot("start");

		for (const step of scenario.steps) {
			const from = trace.length;
			trace.push(`step ${step.label}`);
			step.act(app);
			await until(trace, from, step.expect, `${flavor}: ${step.label}`);
			await settle(trace);
			snapshot(step.label);
		}
		return trace;
	} finally {
		probe.created = undefined;
		stopLogs();
		stopHashes();
		container?.destroy();
		for (const component of components.toReversed()) {
			if (!component.isDestroyed()) {
				component.destroy();
			}
		}
		HashChanger.getInstance().setHash("");
		// Nothing of this run may reach the trace of the next one.
		await drain();
	}
}

const PARENT_HOME = "parent routeMatched home ";
const PARENT_SHELL = "parent routeMatched shell ";
const CHILD_LIST = "child routeMatched list ";
const CHILD_DETAIL = "child routeMatched detail ";

/** The parent navigates to the route that displays the child component. */
const showChild = (expect: string[] = [CHILD_LIST, PARENT_SHELL]): Step => ({
	label: "parent navTo shell",
	act: (app) => {
		app.parentRouter.navTo("shell");
	},
	expect,
});

const goHome = (expect: string[] = [PARENT_HOME]): Step => ({
	label: "parent navTo home",
	act: (app) => {
		app.parentRouter.navTo("home");
	},
	expect,
});

const childDetail = (id: string, expect: string[] = [CHILD_DETAIL]): Step => ({
	label: `child navTo detail/${id}`,
	act: (app) => {
		app.childRouter().navTo("detail", { id });
	},
	expect,
});

/** The parent navigates to its "shell" route and names the route of the child. */
const showChildRoute = (route: string, parameters: Record<string, string>, expect: string[]): Step => ({
	label: `parent navTo shell with child route ${route} ${JSON.stringify(parameters)}`,
	act: (app) => {
		app.parentRouter.navTo("shell", {}, { child: { route, parameters } });
	},
	expect,
});

/** The user types a hash into the address bar: the browser reports it, no router wrote it. */
const addressBar = (hash: string, expect: string[]): Step => ({
	label: `address bar "${hash}"`,
	act: () => {
		window.location.hash = `/${hash}`;
	},
	expect,
});

/** The hash changes without a router: UI5 reports it at once, whether the URL follows or not. */
const hashChange = (hash: string, expect: string[]): Step => ({
	label: `hash change "${hash}"`,
	act: () => {
		HashChanger.getInstance().setHash(hash);
	},
	expect,
});

const childList = (expect: string[] = [CHILD_LIST]): Step => ({
	label: "child navTo list",
	act: (app) => {
		app.childRouter().navTo("list");
	},
	expect,
});

const browserBack = (expect: string[]): Step => ({
	label: "browser back",
	act: () => {
		window.history.back();
	},
	expect,
});

const browserForward = (expect: string[]): Step => ({
	label: "browser forward",
	act: () => {
		window.history.forward();
	},
	expect,
});

/**
 * Run `scenario` with each flavor and compare the traces with the native one. The second native
 * run is the control: if it differs from the first, the scenario depends on what ran before it
 * (the browser history, sap.ui.core.routing.History), and a difference of the guard router
 * proves nothing.
 */
function parityTest(title: string, scenario: Scenario): void {
	QUnit.test(title, async function (assert: Assert) {
		const guardOwners: Record<Flavor, (string | undefined)[]> = { native: [], guard: [], allow: [] };
		const record = async (flavor: Flavor): Promise<string[]> => {
			const trace = await run(flavor, scenario, [], guardOwners[flavor]);
			return scenario.anyOrder ? trace.toSorted() : trace;
		};
		const native = await record("native");
		const guard = await record("guard");
		const allow = await record("allow");
		const control = await record("native");

		assert.deepEqual(
			[...new Set(guardOwners.allow)].toSorted(),
			["parity", "parity---child"],
			"the allowing guard ran in the parent's and in the child's router",
		);
		assert.deepEqual([...guardOwners.native, ...guardOwners.guard], [], "and only where it is declared");

		assert.strictEqual(
			firstDifference(control, native),
			undefined,
			"control: a second run with the native router leaves the same trace",
		);
		assert.strictEqual(
			firstDifference(guard, native),
			undefined,
			"the guard router without guards behaves like the native router",
		);
		assert.strictEqual(
			firstDifference(allow, native),
			undefined,
			"the guard router with a guard that allows behaves like the native router",
		);
	});
}

QUnit.module("NestedParity - component displayed as a routing target");

// The two tests that change the URL as the browser does come first. Chrome ignores hash changes
// once a page made about 200 of them within ten seconds, and the tests of this page make more.
// UI5 does not notice (it reports its own hash changes itself), a real address bar or back does.
parityTest("the address bar navigates into the child and inside of it", {
	startHash: "",
	started: [PARENT_HOME],
	steps: [
		addressBar("shell&/child/detail/9", [CHILD_DETAIL, PARENT_SHELL]),
		addressBar("shell&/child/detail/10", [CHILD_DETAIL]),
		addressBar("shell&/child/unknown", ["child bypassed unknown ", "child display notFound "]),
		addressBar("shell", [CHILD_LIST]),
	],
});

parityTest("browser back and forward across the child's and the parent's routes", {
	startHash: "",
	started: [PARENT_HOME],
	steps: [
		showChild(),
		childDetail("1"),
		browserBack([CHILD_LIST]),
		browserBack([PARENT_HOME]),
		browserForward([PARENT_SHELL]),
		browserForward([CHILD_DETAIL]),
	],
});

parityTest("the parent displays the child component for the first time", {
	startHash: "",
	started: [PARENT_HOME],
	steps: [showChild()],
});

parityTest("the child navigates with navTo, with and without a history entry", {
	startHash: "",
	started: [PARENT_HOME],
	steps: [
		showChild(),
		childDetail("7"),
		{
			label: "child navTo list",
			act: (app) => {
				app.childRouter().navTo("list");
			},
			expect: [CHILD_LIST],
		},
		{
			label: "child navTo detail/8 with replace",
			act: (app) => {
				app.childRouter().navTo("detail", { id: "8" }, {}, true);
			},
			expect: [CHILD_DETAIL],
		},
	],
});

// The parent does not wait for the child's bypassed target, as it waits for a route of the child:
// which of the two is displayed first depends on how fast the view of that target loads.
parityTest("the app starts on a hash that the child does not know", {
	anyOrder: true,
	startHash: "shell&/child/unknown",
	started: ["child bypassed unknown ", "child display notFound ", PARENT_SHELL],
	steps: [
		{
			label: "child navTo list",
			act: (app) => {
				app.childRouter().navTo("list");
			},
			expect: [CHILD_LIST],
		},
	],
});

parityTest("the app starts on a hash that the parent does not know", {
	startHash: "nowhere",
	started: ["parent bypassed nowhere ", "parent display notFound "],
	steps: [showChild()],
});

parityTest("the app starts on a deep link to a route of the child", {
	startHash: "shell&/child/detail/3",
	started: [CHILD_DETAIL, PARENT_SHELL],
	steps: [goHome()],
});

parityTest("the parent leaves the child's route and displays the child again", {
	startHash: "",
	started: [PARENT_HOME],
	steps: [
		showChild(),
		childDetail("1"),
		goHome(),
		showChild([PARENT_SHELL]),
		hashChange("", [PARENT_HOME]),
		hashChange("shell&/child/detail/2", [CHILD_DETAIL, PARENT_SHELL]),
	],
});

parityTest("the parent navigates to a route of the child with componentTargetInfo", {
	startHash: "",
	started: [PARENT_HOME],
	steps: [
		showChildRoute("detail", { id: "5" }, [CHILD_DETAIL, PARENT_SHELL]),
		goHome(),
		showChildRoute("detail", { id: "6" }, [CHILD_DETAIL, PARENT_SHELL]),
		showChildRoute("list", {}, [CHILD_LIST]),
	],
});

// These steps name no trace line to wait for: a navTo to the hash that is shown changes nothing.
parityTest("navTo to the route that is already shown", {
	startHash: "",
	started: [PARENT_HOME],
	steps: [goHome([]), showChild(), childList([]), childDetail("1"), childDetail("1", []), showChild([]), goHome()],
});

parityTest("a target displayed without a route", {
	startHash: "",
	started: [PARENT_HOME],
	steps: [
		showChild(),
		{
			label: "child displays its detail target",
			act: (app) => {
				void app.childRouter().getTargets()?.display("detail");
			},
			expect: ["child display detail "],
		},
		// UI5 resets the hash of the child's router, so that its route can match again.
		childList(),
		childDetail("4"),
		{
			label: "parent displays its notFound target",
			act: (app) => {
				void app.parentRouter.getTargets()?.display("notFound");
			},
			expect: ["parent display notFound "],
		},
		goHome(),
	],
});

// UI5 resets the hash of the parent's router when it displays the target. The next hash change
// reports the parent's hash again, although only the child's has changed.
parityTest("a route matches again when its hash is reported after a target was displayed without it", {
	startHash: "",
	started: [PARENT_HOME],
	steps: [
		showChild(),
		childDetail("4"),
		{
			label: "parent displays its notFound target",
			act: (app) => {
				void app.parentRouter.getTargets()?.display("notFound");
			},
			expect: ["parent display notFound "],
		},
		childDetail("5", [CHILD_DETAIL, PARENT_SHELL]),
	],
});

// sap.m.NavContainer#to() logs this warning when asked for the page that is already current. For
// the child's first page that happens in every run; for the parent's it depends on timing.
QUnit.test(
	"the first page of a nested NavContainer logs the same 'current page' warning with both routers",
	async function (assert: Assert) {
		const parentWarning =
			"Element sap.m.App#parity---appView--app: Cannot navigate to page parity---home because this is the current page.";
		const childWarning =
			"Element sap.m.App#parity---child---appView--app: Cannot navigate to page parity---child---list because this is the current page.";
		const scenario: Scenario = { startHash: "", started: [PARENT_HOME], steps: [showChild()] };

		for (const flavor of ["native", "guard"] as const) {
			const logged: string[] = [];
			await run(flavor, scenario, logged);
			assert.deepEqual(
				logged.filter((warning) => warning !== parentWarning),
				[childWarning],
				`${flavor}: the child's first page logs the warning, and nothing else is logged`,
			);
		}
	},
);
