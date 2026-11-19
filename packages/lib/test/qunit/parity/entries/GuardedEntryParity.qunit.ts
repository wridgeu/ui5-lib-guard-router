import type { GuardContext, GuardResult } from "ui5/guard/router/types";
import {
	addressBar,
	type App,
	browserBack,
	browserForward,
	CHILD_DETAIL,
	CHILD_LIST,
	childDetail,
	equivalenceTest,
	goHome,
	guardChild,
	guardParent,
	PARENT_HOME,
	showChild,
	showChildRoute,
	type Step,
} from "../nestedParityHarness";

/**
 * Differential tests for what guard decisions leave in the browser history, on the app of the
 * nested parity tests (see ../guarded): a navigation that is blocked or redirected, and a target
 * that is displayed without a route, compared with the native navigation that each stands for.
 * A page of their own: Chrome ignores history steps and hash changes once a page has changed the
 * hash about 200 times within ten seconds.
 */

QUnit.module("GuardedParity - history entries of guard decisions");

const redirectDetailOneToSeven = (context: GuardContext): GuardResult =>
	context.toArguments.id === "1" ? { route: "detail", parameters: { id: "7" } } : true;

const NOT_ASKED = "no navigation (guard router: a blocked child navTo detail/2)";
const blockDetailTwo = (context: GuardContext): boolean => context.toArguments.id !== "2";

equivalenceTest(
	"a blocked navTo() leaves the history, the titles and the pages of a native router that is not asked to navigate",
	{
		startHash: "",
		started: [PARENT_HOME],
		steps: [
			showChild(),
			childDetail("1"),
			{ label: NOT_ASKED, act: () => undefined, expect: [] },
			browserBack([CHILD_LIST]),
			browserForward([CHILD_DETAIL]),
		],
	},
	{
		startHash: "",
		started: [PARENT_HOME],
		steps: [
			showChild(),
			childDetail("1"),
			{
				label: NOT_ASKED,
				act: (app) => {
					guardChild(app).addRouteGuard("detail", blockDetailTwo);
					app.childRouter().navTo("detail", { id: "2" });
				},
				expect: [],
			},
			browserBack([CHILD_LIST]),
			browserForward([CHILD_DETAIL]),
		],
	},
);

const AFTER_ADDRESS_BAR: Step[] = [
	browserBack([CHILD_LIST]),
	browserForward([CHILD_DETAIL]),
	browserBack([CHILD_LIST]),
	browserBack([PARENT_HOME]),
];

equivalenceTest(
	"a redirected address bar entry leaves the history, the titles and the pages of a native address bar entry of the target",
	{
		startHash: "",
		started: [PARENT_HOME],
		steps: [showChild(), addressBar("shell&/child/detail/7", [CHILD_DETAIL]), ...AFTER_ADDRESS_BAR],
	},
	{
		startHash: "",
		started: [PARENT_HOME],
		steps: [
			showChild(),
			{
				label: 'address bar "shell&/child/detail/1", redirected to detail/7',
				act: (app) => {
					guardChild(app).addRouteGuard("detail", redirectDetailOneToSeven);
					window.location.hash = "/shell&/child/detail/1";
				},
				expect: [CHILD_DETAIL],
			},
			...AFTER_ADDRESS_BAR,
		],
	},
	"browser back",
);

const DETAIL_FIVE = showChildRoute("detail", { id: "5" }, [CHILD_DETAIL]);
const redirectHomeToDetailFive = (): GuardResult => ({
	route: "shell",
	componentTargetInfo: { child: { route: "detail", parameters: { id: "5" } } },
});

equivalenceTest(
	"a redirect to the route that is shown with componentTargetInfo behaves like a native navTo() to that route with componentTargetInfo",
	{
		startHash: "",
		started: [PARENT_HOME],
		steps: [showChild(), DETAIL_FIVE, browserBack([CHILD_LIST]), browserForward([CHILD_DETAIL])],
	},
	{
		startHash: "",
		started: [PARENT_HOME],
		steps: [
			showChild(),
			{
				...DETAIL_FIVE,
				act: (app) => {
					const parent = guardParent(app);
					parent.addRouteGuard("home", redirectHomeToDetailFive);
					parent.attachEventOnce("navigationSettled", () =>
						parent.removeRouteGuard("home", redirectHomeToDetailFive),
					);
					parent.navTo("home");
				},
			},
			browserBack([CHILD_LIST]),
			browserForward([CHILD_DETAIL]),
		],
	},
	DETAIL_FIVE.label,
);

let guardRuns = 0;
let guardRunsForDisplay = -1;
const countAndBlock = (): boolean => {
	guardRuns++;
	return false;
};
const CHILD_DISPLAYS_LIST = "child displays its list target";
const PARENT_DISPLAYS_NOT_FOUND = "parent displays its notFound target";
const displayList = (app: App): void => {
	void app.childRouter().getTargets()?.display("list");
};
const displayNotFound = (app: App): void => {
	void app.parentRouter.getTargets()?.display("notFound");
};

equivalenceTest(
	"Targets#display() displays the target as with the native router although every guard blocks, and runs no guard",
	{
		startHash: "",
		started: [PARENT_HOME],
		steps: [
			showChild(),
			childDetail("4"),
			{ label: CHILD_DISPLAYS_LIST, act: displayList, expect: ["child display list "] },
			{ label: PARENT_DISPLAYS_NOT_FOUND, act: displayNotFound, expect: ["parent display notFound "] },
			goHome(),
		],
	},
	{
		startHash: "",
		started: [PARENT_HOME],
		steps: [
			showChild(),
			childDetail("4"),
			{
				label: CHILD_DISPLAYS_LIST,
				act: (app) => {
					guardParent(app).addGuard(countAndBlock).addLeaveGuard("shell", countAndBlock);
					guardChild(app).addGuard(countAndBlock).addLeaveGuard("detail", countAndBlock);
					displayList(app);
				},
				expect: ["child display list "],
			},
			{ label: PARENT_DISPLAYS_NOT_FOUND, act: displayNotFound, expect: ["parent display notFound "] },
			{
				...goHome(),
				act: (app) => {
					guardRunsForDisplay = guardRuns;
					guardParent(app).removeGuard(countAndBlock).removeLeaveGuard("shell", countAndBlock);
					guardChild(app).removeGuard(countAndBlock).removeLeaveGuard("detail", countAndBlock);
					app.parentRouter.navTo("home");
				},
			},
		],
	},
	undefined,
	(assert) => {
		assert.strictEqual(guardRunsForDisplay, 0, "no guard ran for the two displays");
	},
);
