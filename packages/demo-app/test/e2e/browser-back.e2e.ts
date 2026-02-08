import { waitForPage, resetAuth } from "./helpers";

describe("Browser back navigation with guards", () => {
	it("should handle back navigation cleanly after login flow", async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();

		// Login
		const toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" },
		});
		await toggleBtn.press();

		// Navigate to Protected
		const navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" },
		});
		await navBtn.press();

		// Verify we're on Protected
		await waitForPage("container-demo.app---protectedView--protectedPage", "Protected Page");

		// Browser back
		await browser.back();

		// Should be on Home
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});

	it("should not show protected page on browser back after logout", async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();

		// Login
		let toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" },
		});
		await toggleBtn.press();

		// Navigate to Protected
		const navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" },
		});
		await navBtn.press();
		await waitForPage("container-demo.app---protectedView--protectedPage", "Protected Page");

		// Navigate back to Home
		await browser.back();
		await waitForPage("container-demo.app---homeView--homePage", "Home");

		// Logout (re-retrieve control with forceSelect after navigation)
		toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" },
			forceSelect: true,
		});
		await toggleBtn.press();

		// Verify logged out
		const status = await browser.asControl({
			selector: { id: "container-demo.app---homeView--authStatus" },
			forceSelect: true,
		});
		expect(await status.getProperty("text")).toBe("Logged Out");

		// Try browser forward (toward previously visited #/protected)
		await browser.execute(() => window.history.forward());

		// Guard should block: still on Home, not Protected
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});

	it("should handle back after a blocked navigation attempt", async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();

		// Try navigating to protected (will be blocked - logged out)
		const navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" },
		});
		await navBtn.press();

		// Should still be on Home
		await waitForPage("container-demo.app---homeView--homePage", "Home");

		// Browser back should not break the app
		await browser.back();

		// App should remain on Home (or recover to it)
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});

	it("should handle multiple back/forward cycles", async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();

		// Login
		const toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" },
		});
		await toggleBtn.press();

		// Navigate Home → Protected
		const navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" },
		});
		await navBtn.press();
		await waitForPage("container-demo.app---protectedView--protectedPage", "Protected Page");

		// Back to Home
		await browser.back();
		await waitForPage("container-demo.app---homeView--homePage", "Home");

		// Forward to Protected (still logged in)
		await browser.execute(() => window.history.forward());
		await waitForPage("container-demo.app---protectedView--protectedPage", "Protected Page");

		// Back to Home again
		await browser.back();
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});
});
