import type { GuardContext, GuardResult } from "ui5/guard/router/types";
import {
	addressBar,
	type App,
	browserBack,
	browserForward,
	CHILD_DETAIL,
	CHILD_LIST,
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

const replaceWithDetailSeven: Step = {
	label: "child navTo detail/7, replacing the entry",
	act: (app) => {
		app.childRouter().navTo("detail", { id: "7" }, true);
	},
	expect: [CHILD_DETAIL],
};

const redirectListToDetailSeven = (context: GuardContext): GuardResult =>
	context.toRoute === "list" ? { route: "detail", parameters: { id: "7" } } : true;

/** A history step to the child's list that a guard of the child redirects to detail/7. */
const redirectedStep = (label: string, step: () => void): Step => ({
	label,
	act: (app: App) => {
		const child = guardChild(app);
		child.addGuard(redirectListToDetailSeven);
		child.attachEventOnce("navigationSettled", () => child.removeGuard(redirectListToDetailSeven));
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
