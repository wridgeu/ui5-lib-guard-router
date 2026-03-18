import {
	getRuntimeSettlementRevision,
	waitForPage,
	resetAuth,
	expectHashToBe,
	waitForRuntimeSettlement,
} from "./helpers";

describe("Guard redirects unauthenticated navigation", () => {
	it("should redirect to Home when navigating to Protected while logged out", async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();

		// Verify we start on Home and are logged out
		const status = await browser.asControl({
			selector: { id: "container-demo.app---homeView--authStatus" },
		});
		expect(await status.getProperty("text")).toBe("Logged Out");

		// Try to navigate to protected
		const navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" },
		});
		const settlementRevision = await getRuntimeSettlementRevision();
		await navBtn.press();

		// Wait for hash to settle (async guard takes time, hash changes before guard completes)
		await expectHashToBe("", {
			timeoutMsg: "Hash should settle to home after guard redirect",
			afterRevision: settlementRevision,
		});

		// Verify we're back on Home page after the redirect
		await waitForPage("container-demo.app---homeView--homePage", "Home", { afterRevision: settlementRevision });

		const settlement = await waitForRuntimeSettlement(
			{
				status: "Redirected",
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
