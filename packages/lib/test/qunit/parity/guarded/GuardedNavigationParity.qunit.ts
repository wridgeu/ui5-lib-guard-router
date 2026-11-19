import type { GuardContext, GuardResult } from "ui5/guard/router/types";
import {
	browserBack,
	browserForward,
	CHILD_DETAIL,
	CHILD_LIST,
	childDetail,
	equivalenceTest,
	guardChild,
	guardParent,
	PARENT_HOME,
	PARENT_SHELL,
	showChild,
	type Step,
} from "../nestedParityHarness";

/**
 * Differential tests for what guards decide, on the app of the nested parity tests: after a
 * redirect or a block, the guard router must be in the state, and behave, as the native router
 * after the navigation that the decision stands for. A page of their own, and no more tests
 * than these: Chrome ignores history steps and hash changes once a page has changed the hash about
 * 200 times within ten seconds. More such tests are in ../entries.
 */

QUnit.module("GuardedParity - guard decisions and their native equivalents");

const redirectDetailOneToSeven = (context: GuardContext): GuardResult =>
	context.toArguments.id === "1" ? { route: "detail", parameters: { id: "7" } } : true;

equivalenceTest(
	"a redirected navTo() leaves the history and the titles of a native navTo() to the target",
	{
		startHash: "",
		started: [PARENT_HOME],
		steps: [
			showChild(),
			childDetail("7"),
			browserBack([CHILD_LIST]),
			browserForward([CHILD_DETAIL]),
			browserBack([CHILD_LIST]),
			browserBack([PARENT_HOME]),
		],
	},
	{
		startHash: "",
		started: [PARENT_HOME],
		steps: [
			showChild(),
			{
				label: "child navTo detail/7",
				act: (app) => {
					guardChild(app).addRouteGuard("detail", redirectDetailOneToSeven);
					app.childRouter().navTo("detail", { id: "1" });
				},
				expect: [CHILD_DETAIL],
			},
			browserBack([CHILD_LIST]),
			browserForward([CHILD_DETAIL]),
			browserBack([CHILD_LIST]),
			browserBack([PARENT_HOME]),
		],
	},
);

const blockLeave = (): boolean => false;

equivalenceTest(
	"a blocked browser back leaves the history, the titles and the pages as they were",
	{
		startHash: "",
		started: [PARENT_HOME],
		steps: [
			showChild(),
			childDetail("1"),
			childDetail("2"),
			browserBack([CHILD_DETAIL]),
			browserBack([CHILD_LIST]),
			browserForward([CHILD_DETAIL]),
			browserBack([CHILD_LIST]),
			browserBack([PARENT_HOME]),
		],
	},
	{
		startHash: "",
		started: [PARENT_HOME],
		steps: [
			showChild(),
			childDetail("1"),
			childDetail("2"),
			{
				label: "blocked browser back",
				act: (app) => {
					const child = guardChild(app);
					child.addLeaveGuard("detail", blockLeave);
					child.attachEventOnce("navigationSettled", () => child.removeLeaveGuard("detail", blockLeave));
					window.history.back();
				},
				// The browser arrives at detail/1 and steps forward again.
				expect: [
					'hash hashChanged  {"newHash":"shell&/child/detail/1"',
					'hash hashChanged  {"newHash":"shell&/child/detail/2"',
				],
			},
			browserBack([CHILD_DETAIL]),
			browserBack([CHILD_LIST]),
			browserForward([CHILD_DETAIL]),
			browserBack([CHILD_LIST]),
			browserBack([PARENT_HOME]),
		],
	},
	"browser back",
);

/** Prefixes of the hash changes of a history step to the parent's home route that is taken back to detail/1. */
const HOME_AND_BACK = ['hash hashChanged  {"newHash":""', 'hash hashChanged  {"newHash":"shell&/child/detail/1"'];

const AFTER_REFUSED_STEP: Step[] = [
	browserBack([CHILD_LIST]),
	browserBack([PARENT_HOME]),
	browserForward([PARENT_SHELL]),
	browserForward([CHILD_DETAIL]),
];

/** On detail/1, with two entries ahead: a step that is taken back twice would end on detail/3. */
const ENTRIES_AHEAD: Step[] = [
	showChild(),
	childDetail("1"),
	childDetail("2"),
	childDetail("3"),
	{ label: "two entries back", act: () => window.history.go(-2), expect: [CHILD_DETAIL] },
];

equivalenceTest(
	"a history step that the parent and the nested component block leaves both as they were",
	{ startHash: "", started: [PARENT_HOME], steps: [...ENTRIES_AHEAD, ...AFTER_REFUSED_STEP] },
	{
		startHash: "",
		started: [PARENT_HOME],
		steps: [
			...ENTRIES_AHEAD,
			{
				label: "browser back to home, blocked by parent and child",
				act: (app) => {
					const parent = guardParent(app);
					const child = guardChild(app);
					// The parent is taking the step back when the guard of the child runs. UI5's History
					// saves its state like this when it is informed of a hash change after the routers.
					const blockAfterStateSaved = (): boolean => {
						window.history.replaceState(window.history.state, "");
						return false;
					};
					parent.addLeaveGuard("shell", blockLeave);
					child.addLeaveGuard("detail", blockAfterStateSaved);
					child.attachEventOnce("navigationSettled", () => {
						parent.removeLeaveGuard("shell", blockLeave);
						child.removeLeaveGuard("detail", blockAfterStateSaved);
					});
					window.history.go(-2);
				},
				expect: HOME_AND_BACK,
			},
			...AFTER_REFUSED_STEP,
		],
	},
	"browser back",
);

equivalenceTest(
	"a history step that only the parent blocks brings the nested component back to its route",
	{ startHash: "", started: [PARENT_HOME], steps: [showChild(), childDetail("1"), ...AFTER_REFUSED_STEP] },
	{
		startHash: "",
		started: [PARENT_HOME],
		steps: [
			showChild(),
			childDetail("1"),
			{
				label: "browser back to home, blocked by the parent",
				act: (app) => {
					const parent = guardParent(app);
					parent.addLeaveGuard("shell", blockLeave);
					parent.attachEventOnce("navigationSettled", () => parent.removeLeaveGuard("shell", blockLeave));
					window.history.go(-2);
				},
				// UI5 reports the refused hash to the nested router, which goes to its list and back.
				expect: [...HOME_AND_BACK, CHILD_LIST, CHILD_DETAIL],
			},
			...AFTER_REFUSED_STEP,
		],
	},
	"browser back",
);
