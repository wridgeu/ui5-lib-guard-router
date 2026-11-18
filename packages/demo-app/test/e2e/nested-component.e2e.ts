import type StandardListItem from "sap/m/StandardListItem";
import {
	CONTROLS,
	REPORTS_APP_ID,
	expectControlText,
	getAppComponentId,
	press,
	waitForComponent,
} from "../shared/controls";
import { setConfidentialUnlocked, settleReportsNavigation } from "../shared/reports";
import { expectHashToBe, fireEvent, getHistoryLength, setBrowserHash, startAtHome, waitForPage } from "./helpers";

const OVERVIEW_HASH = "#/reports";
const SALES_HASH = "#/reports&/reports/sales";
const CONFIDENTIAL_HASH = "#/reports&/reports/confidential";

describe("Nested component with its own guard router", () => {
	// Every test starts on the nested overview with the confidential report locked.
	beforeEach(async () => {
		await startAtHome();

		await press(CONTROLS.home.navReportsBtn);
		await waitForComponent(REPORTS_APP_ID);
		await waitForPage(CONTROLS.reportsOverview.overviewPage, "Reports");
		await setConfidentialUnlocked(false);
		await expectControlText(CONTROLS.reportsOverview.accessStatus, "Confidential reports locked");
	});

	it("should display the nested component's initial route under the parent route", async () => {
		await expectHashToBe(OVERVIEW_HASH);

		const settlement = await settleReportsNavigation();
		expect(settlement.status).toBe("committed");
		expect(settlement.route).toBe("overview");
	});

	it("should write the nested router's route under its hash prefix", async () => {
		await press(CONTROLS.reportsOverview.navSalesBtn);

		await waitForPage(CONTROLS.reportsSales.salesPage, "Sales Report");
		await expectHashToBe(SALES_HASH);

		const settlement = await settleReportsNavigation();
		expect(settlement.status).toBe("committed");
		expect(settlement.route).toBe("sales");
	});

	it("should list the sales of the reports model with formatted amounts", async () => {
		await press(CONTROLS.reportsOverview.navSalesBtn);
		await waitForPage(CONTROLS.reportsSales.salesPage, "Sales Report");

		const { viewId, id } = CONTROLS.reportsSales.salesList;
		const readItems = async (): Promise<string[]> =>
			browser.execute(
				(componentId: string, view: string, list: string) => {
					const Component = sap.ui.require("sap/ui/core/Component");
					const items: StandardListItem[] = Component.getComponentById(componentId)
						.byId(view)
						.byId(list)
						.getItems();
					// The number format separates amount and currency with a no-break space.
					return items.map((item) => `${item.getTitle()}: ${item.getInfo()}`.replace(/\s/g, " "));
				},
				await getAppComponentId(REPORTS_APP_ID),
				viewId,
				id,
			);

		// The model loads its data asynchronously.
		await browser.waitUntil(async () => (await readItems()).length > 0, {
			timeoutMsg: "The sales list has no items",
		});
		expect(await readItems()).toEqual(["Q1: 1.2M EUR", "Q2: 1.4M EUR", "Q3: 1.1M EUR"]);
	});

	it("should redirect to the overview when the nested guard finds the report locked", async () => {
		// The overview is also the starting state, so the outcome is read from the nested
		// router's settlement: "committed" before the press, "redirected" after it.
		expect((await settleReportsNavigation()).status).toBe("committed");
		const historyBefore = await getHistoryLength();

		await press(CONTROLS.reportsOverview.navConfidentialBtn);

		const settlement = await settleReportsNavigation();
		expect(settlement.status).toBe("redirected");
		expect(settlement.route).toBe("overview");
		await waitForPage(CONTROLS.reportsOverview.overviewPage, "Reports");
		await expectHashToBe(OVERVIEW_HASH);
		expect(await getHistoryLength()).toBe(historyBefore);
	});

	it("should open the guarded report once it is unlocked, and navigate back within the nested router", async () => {
		await press(CONTROLS.reportsOverview.unlockCheckbox);
		await expectControlText(CONTROLS.reportsOverview.accessStatus, "Confidential reports unlocked");

		await press(CONTROLS.reportsOverview.navConfidentialBtn);

		await waitForPage(CONTROLS.reportsConfidential.confidentialPage, "Confidential Report");
		await expectHashToBe(CONFIDENTIAL_HASH);
		const settlement = await settleReportsNavigation();
		expect(settlement.status).toBe("committed");
		expect(settlement.route).toBe("confidential");

		// The nav button goes one step back in the browser history.
		const historyLength = await getHistoryLength();
		await fireEvent(CONTROLS.reportsConfidential.confidentialPage, "navButtonPress");
		await waitForPage(CONTROLS.reportsOverview.overviewPage, "Reports");
		await expectHashToBe(OVERVIEW_HASH);
		expect(await getHistoryLength()).toBe(historyLength);
	});

	it("should handle browser back within the nested router and out of it", async () => {
		await press(CONTROLS.reportsOverview.navSalesBtn);
		await waitForPage(CONTROLS.reportsSales.salesPage, "Sales Report");
		await expectHashToBe(SALES_HASH);

		await browser.back();
		await waitForPage(CONTROLS.reportsOverview.overviewPage, "Reports");
		await expectHashToBe(OVERVIEW_HASH);

		await browser.back();
		await waitForPage(CONTROLS.home.homePage, "Home");
		await expectHashToBe("");
	});

	it("should return to the parent app from the overview and display the nested component again", async () => {
		const historyLength = await getHistoryLength();
		await fireEvent(CONTROLS.reportsOverview.overviewPage, "navButtonPress");
		await waitForPage(CONTROLS.home.homePage, "Home");
		await expectHashToBe("");
		expect(await getHistoryLength()).toBe(historyLength);

		await press(CONTROLS.home.navReportsBtn);
		await waitForPage(CONTROLS.reportsOverview.overviewPage, "Reports");
		await expectHashToBe(OVERVIEW_HASH);

		// The overview page was still the nested container's current page. Navigating
		// on proves that the nested router runs again.
		await press(CONTROLS.reportsOverview.navSalesBtn);
		await waitForPage(CONTROLS.reportsSales.salesPage, "Sales Report");
		await expectHashToBe(SALES_HASH);
	});

	it("should open an unguarded nested route from a deep link", async () => {
		await startAtHome();

		await setBrowserHash(SALES_HASH);

		await waitForPage(CONTROLS.reportsSales.salesPage, "Sales Report");
		await expectHashToBe(SALES_HASH);
		const settlement = await settleReportsNavigation();
		expect(settlement.status).toBe("committed");
		expect(settlement.route).toBe("sales");
	});

	it("should show the nested router's bypassed target for an unknown nested route", async () => {
		await setBrowserHash("#/reports&/reports/unknown");

		await waitForPage(CONTROLS.reportsNotFound.notFoundPage, "Report Not Found");
		const settlement = await settleReportsNavigation();
		expect(settlement.status).toBe("bypassed");

		await fireEvent(CONTROLS.reportsNotFound.notFoundPage, "navButtonPress");
		await waitForPage(CONTROLS.reportsOverview.overviewPage, "Reports");
		await expectHashToBe(OVERVIEW_HASH);
	});

	it("should redirect a deep link to the locked report to the overview", async () => {
		await startAtHome();

		await setBrowserHash(CONFIDENTIAL_HASH);

		// The hash only moves from the deep link to the overview once the nested guard redirected.
		await expectHashToBe(OVERVIEW_HASH, { timeout: 10000 });
		await waitForPage(CONTROLS.reportsOverview.overviewPage, "Reports");
		const settlement = await settleReportsNavigation();
		expect(settlement.status).toBe("redirected");
		expect(settlement.route).toBe("overview");
	});

	// Last test of the block: the reload drops the wdi5 bridge, so it only uses browser.execute helpers.
	it("should guard the first display of the nested component on a fresh page load", async () => {
		await setConfidentialUnlocked(true);
		await press(CONTROLS.reportsOverview.navConfidentialBtn);
		await waitForPage(CONTROLS.reportsConfidential.confidentialPage, "Confidential Report");
		await expectHashToBe(CONFIDENTIAL_HASH);

		// The reload creates both components anew: the report is locked again.
		await browser.refresh();

		await waitForComponent(REPORTS_APP_ID);
		await expectHashToBe(OVERVIEW_HASH, { timeout: 10000 });
		await waitForPage(CONTROLS.reportsOverview.overviewPage, "Reports");
		const settlement = await settleReportsNavigation();
		expect(settlement.status).toBe("redirected");
		expect(settlement.route).toBe("overview");
	});
});

// The reload above dropped the wdi5 bridge: these tests only use browser.execute helpers.
describe("Nested component: nav button without a previous history entry", () => {
	it("should replace the entry with the overview when the app was entered on a report", async () => {
		// The entry before the deep link is Home: a step back in the history would not end on the overview.
		await setBrowserHash("");
		await waitForPage(CONTROLS.home.homePage, "Home");
		await setBrowserHash(SALES_HASH);
		await waitForPage(CONTROLS.reportsSales.salesPage, "Sales Report");

		await browser.refresh();
		await waitForComponent(REPORTS_APP_ID);
		await waitForPage(CONTROLS.reportsSales.salesPage, "Sales Report");
		const historyLength = await getHistoryLength();

		await fireEvent(CONTROLS.reportsSales.salesPage, "navButtonPress");

		await waitForPage(CONTROLS.reportsOverview.overviewPage, "Reports");
		await expectHashToBe(OVERVIEW_HASH);
		expect(await getHistoryLength()).toBe(historyLength);
	});

	it("should replace the entry with Home of the parent app when the app was entered on the overview", async () => {
		// The entry before the deep link is Employees: a step back in the history would not end on Home.
		await setBrowserHash("#/employees");
		await waitForPage(CONTROLS.employees.employeesPage, "Employees");
		await setBrowserHash(OVERVIEW_HASH);
		await waitForPage(CONTROLS.reportsOverview.overviewPage, "Reports");

		await browser.refresh();
		await waitForComponent(REPORTS_APP_ID);
		await waitForPage(CONTROLS.reportsOverview.overviewPage, "Reports");
		const historyLength = await getHistoryLength();

		await fireEvent(CONTROLS.reportsOverview.overviewPage, "navButtonPress");

		await waitForPage(CONTROLS.home.homePage, "Home");
		await expectHashToBe("");
		expect(await getHistoryLength()).toBe(historyLength);
	});
});
