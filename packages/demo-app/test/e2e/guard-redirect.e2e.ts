import { getRuntimeSettlementRevision, waitForPage, expectHashToBe, waitForRuntimeSettlement } from "./helpers";

describe("Guard redirects to Home", () => {
	it("should redirect from Forbidden to Home", async () => {
		await browser.goTo({ sHash: "" });

		// Try to navigate to forbidden
		const navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navForbiddenBtn" },
		});
		const settlementRevision = await getRuntimeSettlementRevision();
		await navBtn.press();

		// Wait for hash to settle after redirect
		await expectHashToBe("", {
			timeoutMsg: "Hash should settle to home after guard redirect",
			afterRevision: settlementRevision,
		});

		// Verify we're on Home page
		await waitForPage("container-demo.app---homeView--homePage", "Home", { afterRevision: settlementRevision });

		const settlement = await waitForRuntimeSettlement(
			{
				status: "Redirected",
				route: "home",
				hash: "(empty hash)",
			},
			{ afterRevision: settlementRevision },
		);
		expect(settlement.route).toBe("home");
		expect(settlement.hash).toBe("(empty hash)");
	});
});
