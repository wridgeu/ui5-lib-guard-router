import { CONTROLS, type ControlRef, selectorFor } from "../shared/controls";
import { setConfidentialUnlocked, settleReportsNavigation } from "../shared/reports";
import {
	expectAppHashToBe,
	expectControlText,
	navigateToRouteInFlp,
	resetFlpDemo,
	waitForHomePageInFlp,
	waitForPageInFlp,
} from "./helpers";

// App hashes: the part of the browser hash after the shell intent ("#app-preview&/").
const OVERVIEW_APP_HASH = "reports";
const SALES_APP_HASH = "reports&/reports/sales";
const CONFIDENTIAL_APP_HASH = "reports&/reports/confidential";

async function press(ref: ControlRef): Promise<void> {
	const control = await browser.asControl(selectorFor(ref));
	await control.press();
}

async function openReportsInFlp(): Promise<void> {
	await press(CONTROLS.home.navReportsBtn);
	await waitForPageInFlp(CONTROLS.reportsOverview.overviewPage, "Reports");
	await expectAppHashToBe(OVERVIEW_APP_HASH);
}

describe("FLP nested component with its own guard router", () => {
	beforeEach(async () => {
		await resetFlpDemo();
		await openReportsInFlp();
		await setConfidentialUnlocked(false);
	});

	it("writes the nested router's route behind the shell intent and the parent route", async () => {
		await press(CONTROLS.reportsOverview.navSalesBtn);

		await waitForPageInFlp(CONTROLS.reportsSales.salesPage, "Sales Report");
		await expectAppHashToBe(SALES_APP_HASH);
		const browserHash = await browser.execute(() => window.location.hash);
		expect(browserHash).toMatch(/^#app-preview.*&\/reports&\/reports\/sales$/);

		const settlement = await settleReportsNavigation();
		expect(settlement.status).toBe("committed");
		expect(settlement.route).toBe("sales");
	});

	it("redirects to the overview when the nested guard finds the report locked", async () => {
		await press(CONTROLS.reportsOverview.navConfidentialBtn);

		const settlement = await settleReportsNavigation();
		expect(settlement.status).toBe("redirected");
		expect(settlement.route).toBe("overview");
		await waitForPageInFlp(CONTROLS.reportsOverview.overviewPage, "Reports");
		await expectAppHashToBe(OVERVIEW_APP_HASH);
	});

	it("opens the guarded report once it is unlocked", async () => {
		await press(CONTROLS.reportsOverview.unlockCheckbox);
		await expectControlText(CONTROLS.reportsOverview.accessStatus, "Confidential reports unlocked");

		await press(CONTROLS.reportsOverview.navConfidentialBtn);

		await waitForPageInFlp(CONTROLS.reportsConfidential.confidentialPage, "Confidential Report");
		await expectAppHashToBe(CONFIDENTIAL_APP_HASH);
	});

	it("handles browser back within the nested router and out of it", async () => {
		await press(CONTROLS.reportsOverview.navSalesBtn);
		await waitForPageInFlp(CONTROLS.reportsSales.salesPage, "Sales Report");

		await browser.back();
		await waitForPageInFlp(CONTROLS.reportsOverview.overviewPage, "Reports");
		await expectAppHashToBe(OVERVIEW_APP_HASH);

		await browser.back();
		await waitForHomePageInFlp();
		await expectAppHashToBe("");
	});

	it("displays the nested component again after the parent left its route", async () => {
		await press(CONTROLS.reportsOverview.navSalesBtn);
		await waitForPageInFlp(CONTROLS.reportsSales.salesPage, "Sales Report");

		await navigateToRouteInFlp("home");
		await waitForHomePageInFlp();
		await expectAppHashToBe("");

		await openReportsInFlp();
	});
});
