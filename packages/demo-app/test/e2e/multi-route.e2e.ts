describe("Multi-route navigation sequences", () => {
	it("should handle Home → Protected → Home → Forbidden (blocked) → Home sequence", async () => {
		await browser.url("/index.html");

		// Login
		const toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" }
		});
		await toggleBtn.press();

		// Go to Protected (allowed)
		const navProtected = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" }
		});
		await navProtected.press();
		await browser.pause(500);

		let page = await browser.asControl({
			selector: { id: "container-demo.app---protectedView--protectedPage" }
		});
		expect(await page.getProperty("title")).toBe("Protected Page");

		// Nav back to Home
		await page.fireEvent("navButtonPress");
		await browser.pause(500);

		// Try Forbidden (always blocked, redirects to Home)
		const navForbidden = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navForbiddenBtn" }
		});
		await navForbidden.press();
		await browser.pause(500);

		// Should still be on Home
		const homePage = await browser.asControl({
			selector: { id: "container-demo.app---homeView--homePage" }
		});
		expect(await homePage.getProperty("title")).toBe("Home");

		const url = await browser.getUrl();
		expect(url).not.toContain("#/forbidden");
	});

	it("should block protected after mid-session logout", async () => {
		await browser.url("/index.html");

		// Login
		const toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" }
		});
		await toggleBtn.press();

		// Navigate to Protected (allowed)
		const navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" }
		});
		await navBtn.press();
		await browser.pause(500);

		// Nav back to Home
		const protectedPage = await browser.asControl({
			selector: { id: "container-demo.app---protectedView--protectedPage" }
		});
		await protectedPage.fireEvent("navButtonPress");
		await browser.pause(500);

		// Logout
		const logoutBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" }
		});
		await logoutBtn.press();

		// Verify logged out
		const status = await browser.asControl({
			selector: { id: "container-demo.app---homeView--authStatus" }
		});
		expect(await status.getProperty("text")).toBe("Logged Out");

		// Try Protected again (should now be blocked)
		const navBtn2 = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" }
		});
		await navBtn2.press();
		await browser.pause(500);

		// Should still be on Home (guard blocks)
		const homePage = await browser.asControl({
			selector: { id: "container-demo.app---homeView--homePage" }
		});
		expect(await homePage.getProperty("title")).toBe("Home");
	});

	it("should handle login → protected → logout → protected (blocked) → login → protected (allowed)", async () => {
		await browser.url("/index.html");

		// Login
		let toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" }
		});
		await toggleBtn.press();

		// Protected (allowed)
		let navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" }
		});
		await navBtn.press();
		await browser.pause(500);

		let page = await browser.asControl({
			selector: { id: "container-demo.app---protectedView--protectedPage" }
		});
		expect(await page.getProperty("title")).toBe("Protected Page");

		// Back to home
		await page.fireEvent("navButtonPress");
		await browser.pause(500);

		// Logout
		toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" }
		});
		await toggleBtn.press();

		// Try Protected (blocked)
		navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" }
		});
		await navBtn.press();
		await browser.pause(500);

		let homePage = await browser.asControl({
			selector: { id: "container-demo.app---homeView--homePage" }
		});
		expect(await homePage.getProperty("title")).toBe("Home");

		// Login again
		toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" }
		});
		await toggleBtn.press();

		// Protected (allowed again)
		navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" }
		});
		await navBtn.press();
		await browser.pause(500);

		page = await browser.asControl({
			selector: { id: "container-demo.app---protectedView--protectedPage" }
		});
		expect(await page.getProperty("title")).toBe("Protected Page");
	});
});
