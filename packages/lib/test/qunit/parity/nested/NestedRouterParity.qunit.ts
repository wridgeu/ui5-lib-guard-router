import { firstDifference } from "../parityRecorder";
import {
	addressBar,
	browserBack,
	browserForward,
	CHILD_DETAIL,
	CHILD_LIST,
	childDetail,
	childList,
	type Flavor,
	goHome,
	hashChange,
	PARENT_HOME,
	PARENT_SHELL,
	run,
	type Scenario,
	showChild,
	showChildRoute,
} from "../nestedParityHarness";

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
			new Set(guardOwners.allow),
			new Set(["parity", "parity---child"]),
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
