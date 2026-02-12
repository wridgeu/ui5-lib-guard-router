import { waitForPage, expectHashToBe } from "./helpers";

describe("Guard redirects to Home", () => {
	it("should redirect from Forbidden to Home", async () => {
		await browser.goTo({ sHash: "" });

		// Try to navigate to forbidden
		const navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navForbiddenBtn" },
		});
		await navBtn.press();

		// Wait for hash to settle after redirect
		await expectHashToBe("", "Hash should settle to home after guard redirect");

		// Verify we're on Home page
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});
});
