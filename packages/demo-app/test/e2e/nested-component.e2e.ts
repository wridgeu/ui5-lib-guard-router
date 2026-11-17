import { CONTROLS, selectorFor } from "../shared/controls";
import { setConfidentialUnlocked, settleReportsNavigation, waitForReportsComponent } from "../shared/reports";
import { expectHashToBe, fireEvent, getHistoryLength, waitForPage } from "./helpers";

const OVERVIEW_HASH = "#/reports";
const SALES_HASH = "#/reports&/reports/sales";
const CONFIDENTIAL_HASH = "#/reports&/reports/confidential";

async function pressOnOverview(button: "navSalesBtn" | "navConfidentialBtn"): Promise<void> {
	const control = await browser.asControl(selectorFor(CONTROLS.reportsOverview[button]));
	await control.press();
}

async function setBrowserHash(hash: string): Promise<void> {
	await browser.execute((value: string) => {
		window.location.hash = value;
	}, hash);
}

describe("Nested component with its own guard router", () => {
	beforeEach(async () => {
		await browser.url("#");
		await waitForPage(CONTROLS.home.homePage, "Home");

		const navBtn = await browser.asControl(selectorFor(CONTROLS.home.navReportsBtn));
		await navBtn.press();
		await waitForReportsComponent();
		await waitForPage(CONTROLS.reportsOverview.overviewPage, "Reports");
		await setConfidentialUnlocked(false);
	});

	it("should display the nested component's initial route under the parent route", async () => {
		await expectHashToBe(OVERVIEW_HASH);

		const settlement = await settleReportsNavigation();
		expect(settlement.status).toBe("committed");
		expect(settlement.route).toBe("overview");
	});

	it("should write the nested router's route under its hash prefix", async () => {
		await pressOnOverview("navSalesBtn");

		await waitForPage(CONTROLS.reportsSales.salesPage, "Sales Report");
		await expectHashToBe(SALES_HASH);

		const settlement = await settleReportsNavigation();
		expect(settlement.status).toBe("committed");
		expect(settlement.route).toBe("sales");
	});

	it("should redirect to the overview when the nested guard finds the report locked", async () => {
		const historyBefore = await getHistoryLength();

		await pressOnOverview("navConfidentialBtn");

		const settlement = await settleReportsNavigation();
		expect(settlement.status).toBe("redirected");
		expect(settlement.route).toBe("overview");
		await waitForPage(CONTROLS.reportsOverview.overviewPage, "Reports");
		await expectHashToBe(OVERVIEW_HASH);
		expect(await getHistoryLength()).toBe(historyBefore);
	});

	it("should open the guarded report once it is unlocked, and navigate back within the nested router", async () => {
		const unlock = await browser.asControl(selectorFor(CONTROLS.reportsOverview.unlockCheckbox));
		await unlock.press();
		const status = await browser.asControl(selectorFor(CONTROLS.reportsOverview.accessStatus));
		expect(await status.getProperty("text")).toBe("Confidential reports unlocked");

		await pressOnOverview("navConfidentialBtn");

		await waitForPage(CONTROLS.reportsConfidential.confidentialPage, "Confidential Report");
		await expectHashToBe(CONFIDENTIAL_HASH);
		const settlement = await settleReportsNavigation();
		expect(settlement.status).toBe("committed");
		expect(settlement.route).toBe("confidential");

		await fireEvent(CONTROLS.reportsConfidential.confidentialPage, "navButtonPress");
		await waitForPage(CONTROLS.reportsOverview.overviewPage, "Reports");
		await expectHashToBe(OVERVIEW_HASH);
	});

	it("should handle browser back within the nested router and out of it", async () => {
		await pressOnOverview("navSalesBtn");
		await waitForPage(CONTROLS.reportsSales.salesPage, "Sales Report");

		await browser.back();
		await waitForPage(CONTROLS.reportsOverview.overviewPage, "Reports");
		await expectHashToBe(OVERVIEW_HASH);

		await browser.back();
		await waitForPage(CONTROLS.home.homePage, "Home");
		await expectHashToBe("");
	});

	it("should return to the parent app from the overview and display the nested component again", async () => {
		await fireEvent(CONTROLS.reportsOverview.overviewPage, "navButtonPress");
		await waitForPage(CONTROLS.home.homePage, "Home");
		await expectHashToBe("");

		const navBtn = await browser.asControl(selectorFor(CONTROLS.home.navReportsBtn));
		await navBtn.press();
		await waitForPage(CONTROLS.reportsOverview.overviewPage, "Reports");
		await expectHashToBe(OVERVIEW_HASH);
	});

	it("should open an unguarded nested route from a deep link", async () => {
		await browser.url("#");
		await waitForPage(CONTROLS.home.homePage, "Home");

		await setBrowserHash(SALES_HASH);

		await waitForPage(CONTROLS.reportsSales.salesPage, "Sales Report");
		await expectHashToBe(SALES_HASH);
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
		await browser.url("#");
		await waitForPage(CONTROLS.home.homePage, "Home");

		await setBrowserHash(CONFIDENTIAL_HASH);

		// The hash only moves from the deep link to the overview once the nested guard redirected.
		await expectHashToBe(OVERVIEW_HASH, { timeout: 10000 });
		await waitForPage(CONTROLS.reportsOverview.overviewPage, "Reports");
		const settlement = await settleReportsNavigation();
		expect(settlement.status).toBe("redirected");
		expect(settlement.route).toBe("overview");
	});

	// Last test of the file: the reload drops the wdi5 bridge, so it only uses browser.execute helpers.
	it("should guard the first display of the nested component on a fresh page load", async () => {
		await setConfidentialUnlocked(true);
		await pressOnOverview("navConfidentialBtn");
		await waitForPage(CONTROLS.reportsConfidential.confidentialPage, "Confidential Report");
		await expectHashToBe(CONFIDENTIAL_HASH);

		// The reload creates both components anew: the report is locked again.
		await browser.refresh();

		await waitForReportsComponent();
		await expectHashToBe(OVERVIEW_HASH, { timeout: 10000 });
		await waitForPage(CONTROLS.reportsOverview.overviewPage, "Reports");
		const settlement = await settleReportsNavigation();
		expect(settlement.status).toBe("redirected");
		expect(settlement.route).toBe("overview");
	});
});
