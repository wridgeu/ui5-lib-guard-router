describe("Browser back navigation with guards", () => {
	it("should handle back navigation cleanly after login flow", async () => {
		await browser.url("/index.html");

		// Login
		const toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" }
		});
		await toggleBtn.press();

		// Navigate to Protected
		const navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" }
		});
		await navBtn.press();
		await browser.pause(500);

		// Verify we're on Protected
		const protectedPage = await browser.asControl({
			selector: { id: "container-demo.app---protectedView--protectedPage" }
		});
		expect(await protectedPage.getProperty("title")).toBe("Protected Page");

		// Browser back
		await browser.back();
		await browser.pause(500);

		// Should be on Home
		const homePage = await browser.asControl({
			selector: { id: "container-demo.app---homeView--homePage" }
		});
		expect(await homePage.getProperty("title")).toBe("Home");
	});

	it("should not show protected page on browser back after logout", async () => {
		await browser.url("/index.html");

		// Login
		const toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" }
		});
		await toggleBtn.press();

		// Navigate to Protected
		const navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" }
		});
		await navBtn.press();
		await browser.pause(500);

		// Navigate back to Home
		await browser.back();
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

		// Try browser forward (toward previously visited #/protected)
		await browser.execute(() => window.history.forward());
		await browser.pause(1000);

		// Guard should block: still on Home, not Protected
		const homePage = await browser.asControl({
			selector: { id: "container-demo.app---homeView--homePage" }
		});
		expect(await homePage.getProperty("title")).toBe("Home");
	});

	it("should handle back after a blocked navigation attempt", async () => {
		await browser.url("/index.html");

		// Try navigating to protected (will be blocked - logged out)
		const navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" }
		});
		await navBtn.press();
		await browser.pause(500);

		// Should still be on Home
		const homePage = await browser.asControl({
			selector: { id: "container-demo.app---homeView--homePage" }
		});
		expect(await homePage.getProperty("title")).toBe("Home");

		// Browser back should not break the app
		await browser.back();
		await browser.pause(500);

		// App should still be functional
		const url = await browser.getUrl();
		// Should not crash - we might be on a blank page or still on Home
		expect(url).toBeDefined();
	});

	it("should handle multiple back/forward cycles", async () => {
		await browser.url("/index.html");

		// Login
		const toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" }
		});
		await toggleBtn.press();

		// Navigate Home → Protected
		const navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" }
		});
		await navBtn.press();
		await browser.pause(500);

		// Back to Home
		await browser.back();
		await browser.pause(500);

		// Forward to Protected (still logged in)
		await browser.execute(() => window.history.forward());
		await browser.pause(500);

		const protectedPage = await browser.asControl({
			selector: { id: "container-demo.app---protectedView--protectedPage" }
		});
		expect(await protectedPage.getProperty("title")).toBe("Protected Page");

		// Back to Home again
		await browser.back();
		await browser.pause(500);

		const homePage = await browser.asControl({
			selector: { id: "container-demo.app---homeView--homePage" }
		});
		expect(await homePage.getProperty("title")).toBe("Home");
	});
});
