import { waitForPage, fireEvent, resetAuth } from "./helpers";

describe("UI5 in-app nav back button", () => {
	it("should navigate back to Home via the Page nav button", async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();

		// Login and go to Protected
		const toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" },
		});
		await toggleBtn.press();

		const navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" },
		});
		await navBtn.press();

		// Wait for view - confirms async guard completed
		await waitForPage("container-demo.app---protectedView--protectedPage", "Protected Page");

		// Click the UI5 Page's built-in nav back button
		await fireEvent("container-demo.app---protectedView--protectedPage", "navButtonPress");

		// Should be back on Home
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});

	it("should allow re-navigation after using nav back button", async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();

		// Login
		const toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" },
		});
		await toggleBtn.press();

		// Go to Protected
		const navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" },
		});
		await navBtn.press();
		// Wait for view - confirms async guard completed
		await waitForPage("container-demo.app---protectedView--protectedPage", "Protected Page");

		// Nav back via UI5 button
		await fireEvent("container-demo.app---protectedView--protectedPage", "navButtonPress");
		await waitForPage("container-demo.app---homeView--homePage", "Home");

		// Navigate to Protected again
		const navBtn2 = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" },
			forceSelect: true,
		});
		await navBtn2.press();

		// Wait for view - confirms async guard completed
		await waitForPage("container-demo.app---protectedView--protectedPage", "Protected Page");
	});
});
