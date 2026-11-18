import type { GuardContext, GuardResult, GuardRouter } from "ui5/guard/router/types";
import { GuardRouterClass } from "./testHelpers";
import { firstDifference } from "./parityRecorder";
import {
	type App,
	browserBack,
	browserForward,
	CHILD_DETAIL,
	CHILD_LIST,
	childDetail,
	PARENT_HOME,
	PARENT_SHELL,
	run,
	type Scenario,
	showChild,
	type Step,
} from "./nestedParityHarness";

/**
 * Differential tests for what guards decide, on the app of the nested parity tests: after a
 * redirect or a block, the guard router must be in the state, and behave, as the native router
 * after the navigation that the decision stands for. A page of their own: Chrome ignores history
 * steps once a page has changed the hash about 200 times within ten seconds.
 */

QUnit.module("GuardedParity - guard decisions and their native equivalents");

/** The trace from the step `label` on. */
function fromStep(trace: string[], label: string): string[] {
	return trace.slice(trace.indexOf(`step ${label}`));
}

/**
 * Run `guarded` with the guard router and `native` with the native router, and compare the traces
 * from the step `from` on (default: all of it): after what its guards decided, the guard router
 * must be in the state, and behave, as the native router after the navigation that the decision
 * stands for. That includes the browser history (the steps go back and forward in it), the
 * title history and the pages of both NavContainers. The second native run is the control.
 */
function equivalenceTest(title: string, native: Scenario, guarded: Scenario, from?: string): void {
	QUnit.test(title, async function (assert: Assert) {
		const cut = (trace: string[]): string[] => (from === undefined ? trace : fromStep(trace, from));
		const nativeTrace = cut(await run("native", native));
		const guardTrace = cut(await run("guard", guarded));
		const control = cut(await run("native", native));

		assert.ok(nativeTrace.length > 1, "the native router recorded the compared steps");
		assert.strictEqual(
			firstDifference(control, nativeTrace),
			undefined,
			"control: a second run with the native router leaves the same trace",
		);
		assert.strictEqual(
			firstDifference(guardTrace, nativeTrace),
			undefined,
			"the guard router behaves like the native router after the equivalent navigation",
		);
	});
}

/** The child router of the guard flavor. */
function guardChild(app: App): GuardRouter {
	const router = app.childRouter();
	if (!(router instanceof GuardRouterClass)) {
		throw new Error("The child router is not a guard router");
	}
	return router;
}

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

/** The parent router of the guard flavor. */
function guardParent(app: App): GuardRouter {
	if (!(app.parentRouter instanceof GuardRouterClass)) {
		throw new Error("The parent router is not a guard router");
	}
	return app.parentRouter;
}

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
