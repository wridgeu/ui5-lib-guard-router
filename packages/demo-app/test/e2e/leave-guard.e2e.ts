import { waitForPage, fireEvent, resetAuth, setDirtyState } from "./helpers";

describe("Leave Guard - Dirty Form", () => {
	beforeEach(async () => {
		await resetAuth();
		await browser.goTo({ sHash: "" });
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});

	it("should allow leaving protected page when form is clean", async () => {
		// Login and navigate to protected
		await fireEvent("container-demo.app---homeView--toggleLoginBtn", "press");
		await fireEvent("container-demo.app---homeView--navProtectedBtn", "press");
		await waitForPage("container-demo.app---protectedView--protectedPage", "Protected Page");

		// Ensure form is clean
		await setDirtyState(false);

		// Navigate back — should succeed
		await fireEvent("container-demo.app---protectedView--protectedPage", "navButtonPress");
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});

	it("should block leaving protected page when form is dirty", async () => {
		// Login and navigate to protected
		await fireEvent("container-demo.app---homeView--toggleLoginBtn", "press");
		await fireEvent("container-demo.app---homeView--navProtectedBtn", "press");
		await waitForPage("container-demo.app---protectedView--protectedPage", "Protected Page");

		// Mark form as dirty
		await setDirtyState(true);

		// Try to navigate back — should be blocked
		await fireEvent("container-demo.app---protectedView--protectedPage", "navButtonPress");
		await browser.pause(500);

		// Still on protected page
		const hash = await browser.execute(() => window.location.hash);
		expect(hash).toBe("#/protected");
	});

	it("should allow leaving after clearing dirty state", async () => {
		// Login and navigate to protected
		await fireEvent("container-demo.app---homeView--toggleLoginBtn", "press");
		await fireEvent("container-demo.app---homeView--navProtectedBtn", "press");
		await waitForPage("container-demo.app---protectedView--protectedPage", "Protected Page");

		// Mark dirty, then clean
		await setDirtyState(true);
		await setDirtyState(false);

		// Navigate back — should succeed now
		await fireEvent("container-demo.app---protectedView--protectedPage", "navButtonPress");
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});

	it("should block browser back when form is dirty", async () => {
		// Login and navigate to protected
		await fireEvent("container-demo.app---homeView--toggleLoginBtn", "press");
		await fireEvent("container-demo.app---homeView--navProtectedBtn", "press");
		await waitForPage("container-demo.app---protectedView--protectedPage", "Protected Page");

		// Mark form as dirty
		await setDirtyState(true);

		// Browser back — should be blocked by leave guard
		await browser.execute(() => window.history.back());
		await browser.pause(500);

		// Still on protected page
		const hash = await browser.execute(() => window.location.hash);
		expect(hash).toBe("#/protected");
	});
});
