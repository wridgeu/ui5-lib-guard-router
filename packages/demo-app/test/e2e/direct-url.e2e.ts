describe("Direct URL navigation with guards", () => {
	it("should redirect to Home when accessing #/protected directly while logged out", async () => {
		await browser.url("/index.html#/protected");
		await browser.pause(1000);

		const homePage = await browser.asControl({
			selector: { id: "container-demo.app---homeView--homePage" }
		});
		expect(await homePage.getProperty("title")).toBe("Home");

		const url = await browser.getUrl();
		expect(url).not.toContain("#/protected");
	});

	it("should redirect to Home when accessing #/forbidden directly", async () => {
		await browser.url("/index.html#/forbidden");
		await browser.pause(1000);

		const homePage = await browser.asControl({
			selector: { id: "container-demo.app---homeView--homePage" }
		});
		expect(await homePage.getProperty("title")).toBe("Home");

		const url = await browser.getUrl();
		expect(url).not.toContain("#/forbidden");
	});

	it("should load Protected page when accessing #/protected directly while logged in", async () => {
		// Start on home and login first
		await browser.url("/index.html");
		const toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" }
		});
		await toggleBtn.press();

		// Now navigate directly to protected via URL
		await browser.url("/index.html#/protected");
		await browser.pause(1000);

		const page = await browser.asControl({
			selector: { id: "container-demo.app---protectedView--protectedPage" }
		});
		expect(await page.getProperty("title")).toBe("Protected Page");
	});

	it("should handle navigating to a nonexistent route hash", async () => {
		await browser.url("/index.html#/this/does/not/exist");
		await browser.pause(1000);

		// App should still be functional (no crash)
		// The bypassed event fires but no target displays
		const url = await browser.getUrl();
		expect(url).toContain("#/this/does/not/exist");
	});

	it("should handle rapid hash changes in the address bar", async () => {
		await browser.url("/index.html");
		await browser.pause(500);

		// Rapidly change the hash multiple times
		await browser.execute(() => { window.location.hash = "#/protected"; });
		await browser.execute(() => { window.location.hash = "#/forbidden"; });
		await browser.execute(() => { window.location.hash = "#/protected"; });
		await browser.pause(1000);

		// Should end up on Home (all guarded while logged out)
		const homePage = await browser.asControl({
			selector: { id: "container-demo.app---homeView--homePage" }
		});
		expect(await homePage.getProperty("title")).toBe("Home");
	});
});
