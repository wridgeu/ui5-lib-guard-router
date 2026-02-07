describe("UI5 in-app nav back button", () => {
	it("should navigate back to Home via the Page nav button", async () => {
		await browser.url("/index.html");

		// Login and go to Protected
		const toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" }
		});
		await toggleBtn.press();

		const navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" }
		});
		await navBtn.press();
		await browser.pause(500);

		// Verify on Protected page
		const protectedPage = await browser.asControl({
			selector: { id: "container-demo.app---protectedView--protectedPage" }
		});
		expect(await protectedPage.getProperty("title")).toBe("Protected Page");

		// Click the UI5 Page's built-in nav back button
		await protectedPage.fireEvent("navButtonPress");
		await browser.pause(500);

		// Should be back on Home
		const homePage = await browser.asControl({
			selector: { id: "container-demo.app---homeView--homePage" }
		});
		expect(await homePage.getProperty("title")).toBe("Home");

		const url = await browser.getUrl();
		expect(url).not.toContain("#/protected");
	});

	it("should allow re-navigation after using nav back button", async () => {
		await browser.url("/index.html");

		// Login
		const toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" }
		});
		await toggleBtn.press();

		// Go to Protected
		const navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" }
		});
		await navBtn.press();
		await browser.pause(500);

		// Nav back via UI5 button
		const protectedPage = await browser.asControl({
			selector: { id: "container-demo.app---protectedView--protectedPage" }
		});
		await protectedPage.fireEvent("navButtonPress");
		await browser.pause(500);

		// Navigate to Protected again
		const navBtn2 = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" }
		});
		await navBtn2.press();
		await browser.pause(500);

		// Should be on Protected again
		const protectedPage2 = await browser.asControl({
			selector: { id: "container-demo.app---protectedView--protectedPage" }
		});
		expect(await protectedPage2.getProperty("title")).toBe("Protected Page");
	});
});
