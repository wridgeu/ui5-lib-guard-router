import { waitForPage, resetAuth, expectHashToBe } from "./helpers";

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
		await navBtn.press();

		// Wait for hash to settle (async guard takes time, hash changes before guard completes)
		await expectHashToBe("", "Hash should settle to home after guard redirect");

		// Verify we're back on Home page after the redirect
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});
});
