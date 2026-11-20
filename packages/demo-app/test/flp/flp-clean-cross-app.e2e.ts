import {
	installDialogHandler,
	loginAndGoToProtectedInFlp,
	resetFlpDemo,
	setDirtyStateInFlp,
	triggerFlpCrossAppNavigation,
} from "./helpers";

/**
 * Clean cross-app navigation test. Isolated spec file because the
 * cross-app navigation ends on Shell-home, leaving the sandbox
 * unrecoverable for the browser session.
 */
describe("FLP clean cross-app navigation (isolated session)", () => {
	before(async () => {
		await resetFlpDemo();
	});

	it("completes clean cross-app navigation without triggering FLP dirty prompt", async () => {
		await loginAndGoToProtectedInFlp();
		// Asserts that the page shows the clean state.
		await setDirtyStateInFlp(false);

		// Records a confirm() if FLP shows one: with a clean form the dirty-state provider answers false.
		const { record, cleanup } = installDialogHandler(true);

		try {
			await triggerFlpCrossAppNavigation();

			await browser.waitUntil(
				async () => {
					const hash = await browser.execute(() => window.location.hash);
					return hash.includes("Shell-home");
				},
				{
					timeout: 5000,
					timeoutMsg: "FLP did not complete clean cross-app navigation to Shell-home",
				},
			);

			expect(record.called).toBe(false);
		} finally {
			cleanup();
		}
	});
});
