import { CONTROLS, selectorFor } from "../shared/controls";
import {
	getRuntimeSettlementRevision,
	waitForPage,
	resetAuth,
	expectHashToBe,
	waitForRuntimeSettlement,
} from "./helpers";

describe("Guard blocks enter navigation", () => {
	it("should stay on Home and report Blocked when navigating to Blocked", async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();
		await waitForPage(CONTROLS.home.homePage, "Home");

		const navBtn = await browser.asControl(selectorFor(CONTROLS.home.navBlockedBtn));
		const settlementRevision = await getRuntimeSettlementRevision();
		await navBtn.press();

		await expectHashToBe("", {
			timeoutMsg: "Hash should stay on home after enter guard blocks",
			afterRevision: settlementRevision,
		});
		await waitForPage(CONTROLS.home.homePage, "Home", { afterRevision: settlementRevision });

		const settlement = await waitForRuntimeSettlement(
			{
				status: "Blocked",
				route: "home",
				hash: "(empty hash)",
			},
			{
				afterRevision: settlementRevision,
			},
		);
		expect(settlement.route).toBe("home");
		expect(settlement.hash).toBe("(empty hash)");
	});
});
