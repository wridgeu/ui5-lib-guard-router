import { waitForPage } from "./helpers";

describe("Direct URL navigation with guards", () => {
	it("should redirect to Home when accessing #/protected directly while logged out", async () => {
		await browser.goTo({ sHash: "" });
		await browser.execute(() => { window.location.hash = "#/protected"; });

		await waitForPage("container-demo.app---homeView--homePage", "Home");

		const url = await browser.getUrl();
		expect(url).not.toContain("#/protected");
	});

	it("should redirect to Home when accessing #/forbidden directly", async () => {
		await browser.goTo({ sHash: "" });
		await browser.execute(() => { window.location.hash = "#/forbidden"; });

		await waitForPage("container-demo.app---homeView--homePage", "Home");

		const url = await browser.getUrl();
		expect(url).not.toContain("#/forbidden");
	});

	it("should load Protected page when accessing #/protected directly while logged in", async () => {
		// Start on home and login first
		await browser.goTo({ sHash: "" });
		const toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" }
		});
		await toggleBtn.press();

		// Now navigate directly to protected via hash change
		await browser.execute(() => { window.location.hash = "#/protected"; });

		await waitForPage("container-demo.app---protectedView--protectedPage", "Protected Page");
	});

	it("should handle navigating to a nonexistent route hash", async () => {
		await browser.goTo({ sHash: "" });
		await waitForPage("container-demo.app---homeView--homePage", "Home");

		await browser.execute(() => { window.location.hash = "#/this/does/not/exist"; });

		// Hash should settle to the nonexistent route (no guard intercepts unmatched routes)
		await browser.waitUntil(async () => {
			const url = await browser.getUrl();
			return url.includes("#/this/does/not/exist");
		}, { timeout: 5000, timeoutMsg: "Hash did not settle to nonexistent route" });

		// App should still be functional - verify UI is responsive by checking
		// that a known control is still present in the DOM
		const isAppAlive = await browser.execute(() => {
			const Element = sap.ui.require("sap/ui/core/Element");
			return !!Element?.getElementById("container-demo.app---appView--appContainer");
		});
		expect(isAppAlive).toBe(true);
	});

	it("should handle rapid hash changes in the address bar", async () => {
		await browser.goTo({ sHash: "" });
		await waitForPage("container-demo.app---homeView--homePage", "Home");

		// Rapidly change the hash multiple times
		await browser.execute(() => { window.location.hash = "#/protected"; });
		await browser.execute(() => { window.location.hash = "#/forbidden"; });
		await browser.execute(() => { window.location.hash = "#/protected"; });

		// Should end up on Home (all guarded while logged out)
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});
});
