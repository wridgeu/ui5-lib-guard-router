import { CONTROLS, press, waitForComponent } from "../shared/controls";
import { getRuntimeSettlementRevision } from "../shared/models";
import { expectHashToBe, waitForPage, waitForRuntimeSettlement } from "./helpers/wait";
import { fireEvent, setBrowserHash } from "./helpers/browser";
import { getHistoryLength } from "../shared/history";
import { loginAndGoToProtected, navBackToHome, startAtHome } from "./helpers/scenarios";

describe("UI5 in-app nav back button", () => {
	it("should navigate back to Home via the Page nav button", async () => {
		await startAtHome();
		await loginAndGoToProtected();

		await navBackToHome();
	});

	it("should allow re-navigation after using nav back button", async () => {
		await startAtHome();
		await loginAndGoToProtected();
		await navBackToHome();

		// Navigate to Protected again
		const settlementRevision = await getRuntimeSettlementRevision();
		await press(CONTROLS.home.navProtectedBtn);

		await waitForPage(CONTROLS.protected.protectedPage, "Protected Page", { afterRevision: settlementRevision });
		await waitForRuntimeSettlement(
			{ status: "committed", route: "protected", hash: "protected" },
			{ afterRevision: settlementRevision },
		);
		await expectHashToBe("#/protected");
	});

	it("should go one step back in the browser history from a page without a leave guard", async () => {
		await startAtHome();
		await press(CONTROLS.home.navToEmployees);
		await waitForPage(CONTROLS.employees.employeesPage, "Employees");
		const historyLength = await getHistoryLength();

		await fireEvent(CONTROLS.employees.employeesPage, "navButtonPress");

		await waitForPage(CONTROLS.home.homePage, "Home");
		await expectHashToBe("");
		expect(await getHistoryLength()).toBe(historyLength);

		// The entry of Employees is still ahead: the nav button did not replace it.
		await browser.forward();
		await waitForPage(CONTROLS.employees.employeesPage, "Employees");
		await expectHashToBe("#/employees");
	});

	// Last test of the file: the reload drops the wdi5 bridge, so after it only browser.execute helpers are used.
	it("should replace the entry with the parent route when the app was entered on the page", async () => {
		// The entry before the deep link is Home: a step back in the history would not end on Employees.
		await startAtHome();
		await setBrowserHash("#/employees/42");
		await waitForPage(CONTROLS.employee.employeePage, "Employee Detail");

		await browser.refresh();
		await waitForComponent();
		await waitForPage(CONTROLS.employee.employeePage, "Employee Detail");
		const historyLength = await getHistoryLength();

		await fireEvent(CONTROLS.employee.employeePage, "navButtonPress");

		await waitForPage(CONTROLS.employees.employeesPage, "Employees");
		await expectHashToBe("#/employees");
		expect(await getHistoryLength()).toBe(historyLength);
	});
});
