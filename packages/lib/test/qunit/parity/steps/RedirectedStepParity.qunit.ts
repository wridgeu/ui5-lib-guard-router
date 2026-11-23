import NavContainer from "sap/m/NavContainer";
import MobileRouter from "sap/m/routing/Router";
import XMLView from "sap/ui/core/mvc/XMLView";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type { Router$RouteMatchedEvent } from "sap/ui/core/routing/Router";
import type { GuardContext, GuardResult, GuardRouter } from "ui5/guard/router/types";
import { flushPromises, GuardRouterClass, initHashChanger } from "../../testHelpers";
import {
	addressBar,
	type App,
	browserBack,
	browserForward,
	CHILD_DETAIL,
	CHILD_LIST,
	childDetail,
	childList,
	equivalenceTest,
	guardChild,
	PARENT_HOME,
	showChild,
	type Step,
} from "../nestedParityHarness";

/**
 * Differential tests for a step through the browser history that a guard redirects, on the app of
 * the nested parity tests (see ../guarded). The native equivalent is the same step, followed by a
 * navTo() to the target that replaces the entry the step arrived at. The traces are compared from
 * the first step after the redirect on: steps back and forward over the replaced entry and its
 * neighbors, with the hash, the pages and the title history after each.
 *
 * What is not compared, because the native router has displayed the page of the step and the
 * guard router has not: the state right after the redirect, where that page is the previous page
 * of the NavContainer, and after a redirected step forward the step back beyond the page before
 * the target, where the NavContainer still has that page on its stack.
 *
 * The page that is left, the route of the step and the target each have a title of their own
 * (not found, list, detail): UI5 reports a title only when it differs from the one before, and
 * the guard router keeps the route of the step from matching.
 *
 * A page of their own: Chrome ignores history steps and hash changes once a page has changed the
 * hash about 200 times within ten seconds.
 */

QUnit.module("GuardedParity - redirected steps through the browser history");

const CHILD_NOT_FOUND = "child bypassed ";
/** The label of the first step after the redirect. */
const AFTER_REDIRECT = "first step after the redirect";

/** The child shows its "not found" page: no route matches, so no guard runs for this entry. */
const notFound = addressBar("shell&/child/nowhere", [CHILD_NOT_FOUND]);

const replaceWithDetail = (id: string): Step => ({
	label: `child navTo detail/${id}, replacing the entry`,
	act: (app) => {
		app.childRouter().navTo("detail", { id }, true);
	},
	expect: [CHILD_DETAIL],
});
const replaceWithDetailSeven = replaceWithDetail("7");

const redirectListToDetailSeven = (context: GuardContext): GuardResult =>
	context.toRoute === "list" ? { route: "detail", parameters: { id: "7" } } : true;

const redirectDetailOneToSeven = (context: GuardContext): GuardResult =>
	context.toHash === "detail/1" ? { route: "detail", parameters: { id: "7" } } : true;

/** A history step that `guard` of the child redirects, by default from the list to detail/7. */
const redirectedStep = (label: string, step: () => void, guard = redirectListToDetailSeven): Step => ({
	label,
	act: (app: App) => {
		const child = guardChild(app);
		child.addGuard(guard);
		child.attachEventOnce("navigationSettled", () => child.removeGuard(guard));
		step();
	},
	expect: [CHILD_DETAIL],
});

const AFTER_BACK: Step[] = [
	{ ...browserForward([CHILD_NOT_FOUND]), label: AFTER_REDIRECT },
	browserBack([CHILD_DETAIL]),
	browserBack([PARENT_HOME]),
];

equivalenceTest(
	"a redirected browser back leaves the history, the titles and the pages of a native browser back followed by a native navTo() to the target that replaces the entry",
	{
		startHash: "",
		started: [PARENT_HOME],
		steps: [showChild(), notFound, browserBack([CHILD_LIST]), replaceWithDetailSeven, ...AFTER_BACK],
	},
	{
		startHash: "",
		started: [PARENT_HOME],
		steps: [
			showChild(),
			notFound,
			redirectedStep("browser back to the list, redirected to detail/7", () => window.history.back()),
			...AFTER_BACK,
		],
	},
	AFTER_REDIRECT,
);

/** On the "not found" page, with the list one entry ahead. */
const LIST_AHEAD: Step[] = [showChild(), notFound, childList(), browserBack([CHILD_NOT_FOUND])];

const AFTER_FORWARD: Step[] = [
	{ ...browserBack([CHILD_NOT_FOUND]), label: AFTER_REDIRECT },
	browserForward([CHILD_DETAIL]),
	browserBack([CHILD_NOT_FOUND]),
];

equivalenceTest(
	"a redirected browser forward leaves the history, the titles and the pages of a native browser forward followed by a native navTo() to the target that replaces the entry",
	{
		startHash: "",
		started: [PARENT_HOME],
		steps: [...LIST_AHEAD, browserForward([CHILD_LIST]), replaceWithDetailSeven, ...AFTER_FORWARD],
	},
	{
		startHash: "",
		started: [PARENT_HOME],
		steps: [
			...LIST_AHEAD,
			redirectedStep("browser forward to the list, redirected to detail/7", () => window.history.forward()),
			...AFTER_FORWARD,
		],
	},
	AFTER_REDIRECT,
);

/**
 * On detail/3, with detail/1 one entry back and the title history [list, not found, detail/1,
 * detail/3]: the step back arrives at a page with the title of the page it leaves, so it removes
 * no title.
 */
const DETAIL_ONE_BEHIND: Step[] = [
	showChild(),
	notFound,
	childDetail("1"),
	addressBar("shell&/child/elsewhere", [CHILD_NOT_FOUND]),
	replaceWithDetail("3"),
];

const AFTER_BACK_TO_DETAIL: Step[] = [
	{ ...browserForward([CHILD_DETAIL]), label: AFTER_REDIRECT },
	browserBack([CHILD_DETAIL]),
];

equivalenceTest(
	"a redirected browser back to a page with the title of the page it leaves keeps the titles of a native browser back followed by a native navTo() to the target that replaces the entry",
	{
		startHash: "",
		started: [PARENT_HOME],
		steps: [...DETAIL_ONE_BEHIND, browserBack([CHILD_DETAIL]), replaceWithDetailSeven, ...AFTER_BACK_TO_DETAIL],
	},
	{
		startHash: "",
		started: [PARENT_HOME],
		steps: [
			...DETAIL_ONE_BEHIND,
			redirectedStep(
				"browser back to detail/1, redirected to detail/7",
				() => window.history.back(),
				redirectDetailOneToSeven,
			),
			...AFTER_BACK_TO_DETAIL,
		],
	},
	AFTER_REDIRECT,
);

function waitForMatched(router: MobileRouter, routeName: string): Promise<void> {
	return new Promise((resolve) => {
		const onMatched = (event: Router$RouteMatchedEvent): void => {
			if (event.getParameter("name") !== routeName) return;
			router.detachRouteMatched(onMatched, router);
			resolve();
		};
		router.attachRouteMatched(onMatched, router);
	});
}

function cloneTitles(router: MobileRouter): unknown {
	return JSON.parse(JSON.stringify(router.getTitleHistory()));
}

const VIEW_XML = '<mvc:View xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m"><Page/></mvc:View>';
const TITLE_VIEW_NAMES = ["A", "B", "C", "D", "Untitled"] as const;

async function runUntitledTitleScenario<R extends MobileRouter>(
	create: (controlId: string) => R,
	act: (router: R) => Promise<unknown[]>,
): Promise<unknown[]> {
	initHashChanger();
	const navContainer = new NavContainer();
	const router = create(navContainer.getId());
	const views = await Promise.all(TITLE_VIEW_NAMES.map(() => XMLView.create({ definition: VIEW_XML })));
	const routerViews = router.getViews();
	TITLE_VIEW_NAMES.forEach((name, index) => {
		routerViews.setView(name, views[index]);
	});
	try {
		return await act(router);
	} finally {
		router.destroy();
		navContainer.destroy();
		for (const view of views) view.destroy();
		HashChanger.getInstance().setHash("");
		await flushPromises();
	}
}

function titleTestArgs(controlId: string): ConstructorParameters<typeof GuardRouterClass> {
	return [
		[
			{ name: "a", pattern: "", target: "a" },
			{ name: "b", pattern: "b", target: "b" },
			{ name: "c", pattern: "c", target: "c" },
			{ name: "d", pattern: "d", target: "d" },
			{ name: "untitled", pattern: "untitled", target: "untitled" },
		],
		{ async: true, type: "View", controlId, controlAggregation: "pages", viewType: "XML" },
		undefined,
		{
			a: { name: "A", title: "A" },
			b: { name: "B", title: "B" },
			c: { name: "C", title: "C" },
			d: { name: "D", title: "D" },
			untitled: { name: "Untitled" },
		},
	];
}

QUnit.test(
	"a redirected browser back to an untitled target leaves the title history of its native equivalent",
	async function (assert: Assert) {
		const setup = async (router: MobileRouter): Promise<void> => {
			const matchedA = waitForMatched(router, "a");
			router.initialize();
			await matchedA;
			const matchedB = waitForMatched(router, "b");
			router.navTo("b");
			await matchedB;
			const matchedC = waitForMatched(router, "c");
			router.navTo("c");
			await matchedC;
		};

		const native = await runUntitledTitleScenario(
			(id) => new MobileRouter(...titleTestArgs(id)),
			async (router) => {
				await setup(router);
				const matchedB = waitForMatched(router, "b");
				window.history.back();
				await matchedB;
				const matchedUntitled = waitForMatched(router, "untitled");
				router.navTo("untitled", {}, true);
				await matchedUntitled;
				const afterRedirect = cloneTitles(router);
				const matchedD = waitForMatched(router, "d");
				router.navTo("d");
				await matchedD;
				return [afterRedirect, cloneTitles(router)];
			},
		);

		const guard = await runUntitledTitleScenario<GuardRouter>(
			(id) => new GuardRouterClass(...titleTestArgs(id)),
			async (router) => {
				await setup(router);
				router.addRouteGuard("b", () => "untitled");
				const matchedUntitled = waitForMatched(router, "untitled");
				window.history.back();
				await matchedUntitled;
				const afterRedirect = cloneTitles(router);
				const matchedD = waitForMatched(router, "d");
				router.navTo("d");
				await matchedD;
				return [afterRedirect, cloneTitles(router)];
			},
		);

		assert.deepEqual(
			guard[0],
			[
				{ hash: "", title: "A" },
				{ hash: "b", title: "B" },
			],
			"the departed route is popped while the arrived entry stays until a titled route replaces it",
		);
		assert.deepEqual(
			guard,
			native,
			"title history matches native both right after the redirect and on the next route",
		);
	},
);

QUnit.test(
	"a redirected browser back to an untitled route leaves the title history of its native equivalent",
	async function (assert: Assert) {
		const setup = async (router: MobileRouter): Promise<void> => {
			const matchedA = waitForMatched(router, "a");
			router.initialize();
			await matchedA;
			const matchedUntitled = waitForMatched(router, "untitled");
			router.navTo("untitled");
			await matchedUntitled;
			const matchedC = waitForMatched(router, "c");
			router.navTo("c");
			await matchedC;
		};

		const native = await runUntitledTitleScenario(
			(id) => new MobileRouter(...titleTestArgs(id)),
			async (router) => {
				await setup(router);
				const matchedUntitled = waitForMatched(router, "untitled");
				window.history.back();
				await matchedUntitled;
				const matchedD = waitForMatched(router, "d");
				router.navTo("d", {}, true);
				await matchedD;
				return [cloneTitles(router)];
			},
		);

		const guard = await runUntitledTitleScenario<GuardRouter>(
			(id) => new GuardRouterClass(...titleTestArgs(id)),
			async (router) => {
				await setup(router);
				router.addRouteGuard("untitled", () => "d");
				const matchedD = waitForMatched(router, "d");
				window.history.back();
				await matchedD;
				return [cloneTitles(router)];
			},
		);

		assert.deepEqual(
			guard[0],
			[
				{ hash: "", title: "A" },
				{ hash: "d", title: "D" },
			],
			"the earlier titled ancestor is preserved when the stepped-to route had no title",
		);
		assert.deepEqual(guard, native, "title history matches native");
	},
);
