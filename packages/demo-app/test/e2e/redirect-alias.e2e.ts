import { CONTROLS, expectControlText, getAppComponentId, press } from "../shared/controls";
import { getRuntimeSettlementRevision } from "../shared/models";
import {
	expectHashToBe,
	setBrowserHash,
	startAtHome,
	toggleLogin,
	waitForPage,
	waitForRuntimeSettlement,
} from "./helpers";

/**
 * The guard of the retired "team" route redirects to "staff", the legacy name of "employees".
 * Both routes have the pattern "employees" and UI5 matches the first one, "employees": the
 * navigation has to settle on the route that UI5 displays, not on the name the guard returned.
 */
async function expectRedirectedToEmployees(afterRevision: number): Promise<void> {
	await waitForRuntimeSettlement({ status: "Redirected", route: "employees", hash: "employees" }, { afterRevision });
	await expectHashToBe("#/employees");
	await waitForPage(CONTROLS.employees.employeesPage, "Employees");
	await expectControlText(CONTROLS.employees.settlementStatus, "Redirected");
	await expectControlText(CONTROLS.employees.settlementRouteText, "employees");
}

describe("Redirect to a route name whose hash another route matches: team -> staff (alias of employees)", () => {
	beforeEach(async () => {
		await startAtHome();
	});

	it("should settle on employees when navTo('team') is redirected to the alias", async () => {
		const settlementRevision = await getRuntimeSettlementRevision();

		await press(CONTROLS.home.navTeamBtn);

		await expectRedirectedToEmployees(settlementRevision);
	});

	// "requiresAuth" of employees is metadata only, no guard enforces it: the outcome is the
	// same logged in. This test enters through the hash instead of navTo().
	it("should settle on employees when #/team is entered directly while logged in", async () => {
		await toggleLogin("Logged In");
		const settlementRevision = await getRuntimeSettlementRevision();

		await setBrowserHash("#/team");

		await expectRedirectedToEmployees(settlementRevision);
	});

	// No button calls navTo("staff"): the alias only exists for old callers, so the test is one.
	it("should commit on employees when navTo('staff') is called directly", async () => {
		const settlementRevision = await getRuntimeSettlementRevision();

		await browser.execute(
			(componentId: string) => {
				const Component = sap.ui.require("sap/ui/core/Component");
				Component.getComponentById(componentId).getRouter().navTo("staff");
			},
			await getAppComponentId(),
		);

		await waitForRuntimeSettlement(
			{ status: "Committed", route: "employees", hash: "employees" },
			{ afterRevision: settlementRevision },
		);
		await expectHashToBe("#/employees");
		await waitForPage(CONTROLS.employees.employeesPage, "Employees");
		await expectControlText(CONTROLS.employees.settlementStatus, "Committed");
		await expectControlText(CONTROLS.employees.settlementRouteText, "employees");
		await expectControlText(CONTROLS.employees.settlementHashText, "employees");
	});
});
