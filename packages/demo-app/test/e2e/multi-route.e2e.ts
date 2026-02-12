import { waitForPage, fireEvent, resetAuth, expectHashToBe } from "./helpers";

describe("Multi-route navigation sequences", () => {
	it("should handle Home -> Protected -> Home -> Forbidden (blocked) -> Home sequence", async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();

		// Login
		const toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" },
		});
		await toggleBtn.press();

		// Go to Protected (allowed)
		const navProtected = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" },
		});
		await navProtected.press();

		// Wait for view - confirms async guard completed
		await waitForPage("container-demo.app---protectedView--protectedPage", "Protected Page");

		// Nav back to Home
		await fireEvent("container-demo.app---protectedView--protectedPage", "navButtonPress");
		await waitForPage("container-demo.app---homeView--homePage", "Home");

		// Try Forbidden (always blocked, redirects to Home)
		const navForbidden = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navForbiddenBtn" },
			forceSelect: true,
		});
		await navForbidden.press();

		// Wait for hash to settle after redirect
		await expectHashToBe("", "Hash should settle to home after guard redirect");
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});

	it("should block protected after mid-session logout", async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();

		// Login
		let toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" },
		});
		await toggleBtn.press();

		// Navigate to Protected (allowed)
		const navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" },
		});
		await navBtn.press();

		// Wait for view - confirms async guard completed
		await waitForPage("container-demo.app---protectedView--protectedPage", "Protected Page");
		await fireEvent("container-demo.app---protectedView--protectedPage", "navButtonPress");
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

		// Try Protected again (should now be blocked)
		const navBtn2 = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" },
			forceSelect: true,
		});
		await navBtn2.press();

		// Wait for hash to settle after guard redirects
		await expectHashToBe("", "Hash should settle to home after guard redirect");
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});

	it("should handle login -> protected -> logout -> protected (blocked) -> login -> protected (allowed)", async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();

		// Login
		let toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" },
		});
		await toggleBtn.press();

		// Protected (allowed)
		let navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" },
		});
		await navBtn.press();

		// Wait for view - confirms async guard completed
		await waitForPage("container-demo.app---protectedView--protectedPage", "Protected Page");

		// Back to home
		await fireEvent("container-demo.app---protectedView--protectedPage", "navButtonPress");
		await waitForPage("container-demo.app---homeView--homePage", "Home");

		// Logout
		toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" },
			forceSelect: true,
		});
		await toggleBtn.press();

		// Try Protected (blocked)
		navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" },
			forceSelect: true,
		});
		await navBtn.press();

		await expectHashToBe("", "Hash should settle to home after guard redirect");
		await waitForPage("container-demo.app---homeView--homePage", "Home");

		// Login again
		toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" },
			forceSelect: true,
		});
		await toggleBtn.press();

		// Protected (allowed again)
		navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" },
			forceSelect: true,
		});
		await navBtn.press();

		// Wait for view - confirms async guard completed
		await waitForPage("container-demo.app---protectedView--protectedPage", "Protected Page");
	});
});
