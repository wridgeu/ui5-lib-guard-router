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
		await waitForPage("container-demo.app---homeView--homePage", "Home");

		const navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navBlockedBtn" },
		});
		const settlementRevision = await getRuntimeSettlementRevision();
		await navBtn.press();

		await expectHashToBe("", "Hash should stay on home after enter guard blocks");
		await waitForPage("container-demo.app---homeView--homePage", "Home");

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
