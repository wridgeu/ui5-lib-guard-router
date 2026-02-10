import { waitForPage, resetAuth, expectHashToBe } from "./helpers";

describe("Direct URL navigation with guards", () => {
	it("should redirect to Home when accessing #/protected directly while logged out", async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();
		await browser.execute(() => {
			window.location.hash = "#/protected";
		});

		// Wait for hash to settle after async guard redirects
		await expectHashToBe("", "Hash should settle to home after guard redirect");
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});

	it("should redirect to Home when accessing #/forbidden directly", async () => {
		await browser.goTo({ sHash: "" });
		await browser.execute(() => {
			window.location.hash = "#/forbidden";
		});

		// Wait for hash to settle after sync guard redirects
		await expectHashToBe("", "Hash should settle to home after guard redirect");
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});

	it("should load Protected page when accessing #/protected directly while logged in", async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();

		const toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" },
		});
		await toggleBtn.press();

		await browser.execute(() => {
			window.location.hash = "#/protected";
		});

		// Wait for view to load - confirms async guard completed
		await waitForPage("container-demo.app---protectedView--protectedPage", "Protected Page");
	});

	it("should recover from navigating to a nonexistent route hash", async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();
		await waitForPage("container-demo.app---homeView--homePage", "Home");

		await browser.execute(() => {
			window.location.hash = "#/this/does/not/exist";
		});

		await browser.waitUntil(
			async () => {
				const url = await browser.getUrl();
				return url.includes("#/this/does/not/exist");
			},
			{ timeout: 5000, timeoutMsg: "Hash did not settle to nonexistent route" },
		);

		// Verify the app is still functional by navigating back to a known route
		await browser.execute(() => {
			window.location.hash = "#/";
		});
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});

	it("should handle rapid hash changes in the address bar", async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();
		await waitForPage("container-demo.app---homeView--homePage", "Home");

		// Rapidly change the hash multiple times
		await browser.execute(() => {
			window.location.hash = "#/protected";
		});
		await browser.execute(() => {
			window.location.hash = "#/forbidden";
		});
		await browser.execute(() => {
			window.location.hash = "#/protected";
		});

		// Should end up on Home (all guarded while logged out)
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});
});
