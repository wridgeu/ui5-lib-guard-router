import { waitForPage } from "./helpers";

describe("Guard redirects to Home", () => {
	it("should redirect from Forbidden to Home", async () => {
		await browser.goTo({ sHash: "" });

		// Try to navigate to forbidden
		const navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navForbiddenBtn" }
		});
		await navBtn.press();

		// Should be redirected to Home
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});

	it("should not have forbidden in the URL", async () => {
		const url = await browser.getUrl();
		expect(url).not.toContain("#/forbidden");
	});
});
