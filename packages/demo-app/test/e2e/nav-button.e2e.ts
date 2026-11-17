import { CONTROLS, selectorFor } from "../shared/controls";
import { waitForPage, fireEvent, resetAuth } from "./helpers";

describe("UI5 in-app nav back button", () => {
	it("should navigate back to Home via the Page nav button", async () => {
		await browser.url("#");
		await resetAuth();

		// Login and go to Protected
		const toggleBtn = await browser.asControl(selectorFor(CONTROLS.home.toggleLoginBtn));
		await toggleBtn.press();

		const navBtn = await browser.asControl(selectorFor(CONTROLS.home.navProtectedBtn));
		await navBtn.press();

		// Wait for view - confirms async guard completed
		await waitForPage(CONTROLS.protected.protectedPage, "Protected Page");

		// Click the UI5 Page's built-in nav back button
		await fireEvent(CONTROLS.protected.protectedPage, "navButtonPress");

		// Should be back on Home
		await waitForPage(CONTROLS.home.homePage, "Home");
	});

	it("should allow re-navigation after using nav back button", async () => {
		await browser.url("#");
		await resetAuth();

		// Login
		const toggleBtn = await browser.asControl(selectorFor(CONTROLS.home.toggleLoginBtn));
		await toggleBtn.press();

		// Go to Protected
		const navBtn = await browser.asControl(selectorFor(CONTROLS.home.navProtectedBtn));
		await navBtn.press();
		// Wait for view - confirms async guard completed
		await waitForPage(CONTROLS.protected.protectedPage, "Protected Page");

		// Nav back via UI5 button
		await fireEvent(CONTROLS.protected.protectedPage, "navButtonPress");
		await waitForPage(CONTROLS.home.homePage, "Home");

		// Navigate to Protected again
		const navBtn2 = await browser.asControl(selectorFor(CONTROLS.home.navProtectedBtn));
		await navBtn2.press();

		// Wait for view - confirms async guard completed
		await waitForPage(CONTROLS.protected.protectedPage, "Protected Page");
	});
});
