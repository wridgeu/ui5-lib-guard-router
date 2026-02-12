import { waitForPage, fireEvent, resetAuth, setDirtyState, expectHashToBe } from "./helpers";

async function loginAndGoToProtected(): Promise<void> {
	await fireEvent("container-demo.app---homeView--toggleLoginBtn", "press");
	await fireEvent("container-demo.app---homeView--navProtectedBtn", "press");
	await waitForPage("container-demo.app---protectedView--protectedPage", "Protected Page");
}

describe("Leave Guard - Dirty Form", () => {
	beforeEach(async () => {
		await resetAuth();
		await setDirtyState(false); // Ensure clean state before each test
		await browser.goTo({ sHash: "" });
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});

	it("should allow leaving protected page when form is clean", async () => {
		await loginAndGoToProtected();
		await setDirtyState(false);

		await fireEvent("container-demo.app---protectedView--protectedPage", "navButtonPress");
		await expectHashToBe("", "Hash should settle to home after leave guard allows");
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});

	it("should block leaving protected page when form is dirty", async () => {
		await loginAndGoToProtected();
		await setDirtyState(true);

		await fireEvent("container-demo.app---protectedView--protectedPage", "navButtonPress");

		// Leave guard should block - hash should stay at protected
		await expectHashToBe("#/protected", "Hash should stay at protected after leave guard blocks");
	});

	it("should allow leaving after clearing dirty state", async () => {
		await loginAndGoToProtected();
		await setDirtyState(true);
		await setDirtyState(false);

		await fireEvent("container-demo.app---protectedView--protectedPage", "navButtonPress");
		await expectHashToBe("", "Hash should settle to home after leave guard allows");
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});

	it("should block browser back when form is dirty", async () => {
		await loginAndGoToProtected();
		await setDirtyState(true);

		// Verify dirty state was set before attempting navigation
		const isDirty = await browser.execute(() => {
			const Component = sap.ui.require("sap/ui/core/Component");
			return Component?.getComponentById("container-demo.app")?.getModel("form")?.getProperty("/isDirty");
		});
		expect(isDirty).toBe(true);

		await browser.execute(() => window.history.back());
		await expectHashToBe("#/protected", "Hash should stay at protected after leave guard blocks");
	});
});
