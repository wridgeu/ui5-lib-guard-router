import NavContainer from "sap/m/NavContainer";
import MobileRouter from "sap/m/routing/Router";
import Component from "sap/ui/core/Component";
import ComponentContainer from "sap/ui/core/ComponentContainer";
import View from "sap/ui/core/mvc/View";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type Router from "sap/ui/core/routing/Router";
import type UIComponent from "sap/ui/core/UIComponent";
import { drain, recordHashes, recordLogs, recordRouter, settle, until } from "./parityRecorder";
import { initHashChanger, loadModule } from "../testHelpers";

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

export const FIXTURE = "ui5.guard.router.qunit.fixtures.parity";
export const FIXTURE_PATH = "ui5/guard/router/qunit/fixtures/parity";
export const ALLOW_GUARD = "module:ui5.guard.router.qunit.fixtures.guards.allowGuard";

// The first router of a page subscribes the routers' hash changer to the HashChanger. Without this
// one the recorder would subscribe first in the first run, and record a hash change before the
// routers handle it, and after them in every later run.
void new MobileRouter([], { async: true });

export const FLAVORS = {
	/** The reference: parent and child use the native router. */
	native: { routerClass: "sap.m.routing.Router", child: "childNative", guards: false },
	/** Parent and child use the guard router, no guard is registered. */
	guard: { routerClass: "ui5.guard.router.Router", child: "childNoGuards", guards: false },
	/** Parent and child use the guard router, each with a lazily loaded guard that always allows. */
	allow: { routerClass: "ui5.guard.router.Router", child: "childAllow", guards: true },
};
export type Flavor = keyof typeof FLAVORS;

export interface ParentManifest {
	"sap.ui5": {
		componentUsages: { child: { name: string } };
		routing: { config: Record<string, unknown> };
	};
}

export interface Probe {
	created: ((component: UIComponent) => void) | undefined;
	guardOwners: (string | undefined)[];
}

export interface App {
	parentRouter: Router;
	/** The router of the child component; throws while the parent has not displayed the child. */
	childRouter: () => Router;
}

export interface Step {
	label: string;
	act: (app: App) => void;
	/** Prefixes of the trace lines that end the step, see `describeEvent` in parityRecorder. */
	expect: string[];
}

export interface Scenario {
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
export async function loadParentManifest(flavor: Flavor): Promise<ParentManifest> {
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
export function navState(component: UIComponent | undefined): unknown {
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

export function routerState(component: UIComponent | undefined): unknown {
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
export async function run(
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

export const PARENT_HOME = "parent routeMatched home ";
export const PARENT_SHELL = "parent routeMatched shell ";
export const CHILD_LIST = "child routeMatched list ";
export const CHILD_DETAIL = "child routeMatched detail ";

/** The parent navigates to the route that displays the child component. */
export const showChild = (expect: string[] = [CHILD_LIST, PARENT_SHELL]): Step => ({
	label: "parent navTo shell",
	act: (app) => {
		app.parentRouter.navTo("shell");
	},
	expect,
});

export const goHome = (expect: string[] = [PARENT_HOME]): Step => ({
	label: "parent navTo home",
	act: (app) => {
		app.parentRouter.navTo("home");
	},
	expect,
});

export const childDetail = (id: string, expect: string[] = [CHILD_DETAIL]): Step => ({
	label: `child navTo detail/${id}`,
	act: (app) => {
		app.childRouter().navTo("detail", { id });
	},
	expect,
});

/** The parent navigates to its "shell" route and names the route of the child. */
export const showChildRoute = (route: string, parameters: Record<string, string>, expect: string[]): Step => ({
	label: `parent navTo shell with child route ${route} ${JSON.stringify(parameters)}`,
	act: (app) => {
		app.parentRouter.navTo("shell", {}, { child: { route, parameters } });
	},
	expect,
});

/** The user types a hash into the address bar: the browser reports it, no router wrote it. */
export const addressBar = (hash: string, expect: string[]): Step => ({
	label: `address bar "${hash}"`,
	act: () => {
		window.location.hash = `/${hash}`;
	},
	expect,
});

/** The hash changes without a router: UI5 reports it at once, whether the URL follows or not. */
export const hashChange = (hash: string, expect: string[]): Step => ({
	label: `hash change "${hash}"`,
	act: () => {
		HashChanger.getInstance().setHash(hash);
	},
	expect,
});

export const childList = (expect: string[] = [CHILD_LIST]): Step => ({
	label: "child navTo list",
	act: (app) => {
		app.childRouter().navTo("list");
	},
	expect,
});

export const browserBack = (expect: string[]): Step => ({
	label: "browser back",
	act: () => {
		window.history.back();
	},
	expect,
});

export const browserForward = (expect: string[]): Step => ({
	label: "browser forward",
	act: () => {
		window.history.forward();
	},
	expect,
});
