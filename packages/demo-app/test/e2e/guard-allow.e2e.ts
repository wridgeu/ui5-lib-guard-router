import { waitForPage, resetAuth } from "./helpers";

describe("Guard allows navigation when logged in", () => {
	it("should allow navigation to Protected after login", async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();

		// Toggle login
		const toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" },
		});
		await toggleBtn.press();

		// Verify logged in
		const status = await browser.asControl({
			selector: { id: "container-demo.app---homeView--authStatus" },
		});
		expect(await status.getProperty("text")).toBe("Logged In");

		// Navigate to protected
		const navBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--navProtectedBtn" },
		});
		await navBtn.press();

		// Wait for view to load - this confirms async guard completed and navigation committed.
		// Don't wait for hash first because it changes BEFORE async guard completes.
		await waitForPage("container-demo.app---protectedView--protectedPage", "Protected Page");

		// Hash should now be correct
		const url = await browser.getUrl();
		expect(url).toContain("#/protected");
	});
});
