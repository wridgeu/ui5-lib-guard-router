import {
	installDialogHandler,
	loginAndGoToProtectedInFlp,
	resetFlpDemo,
	triggerFlpCrossAppNavigation,
} from "./helpers";

/**
 * Clean cross-app navigation test. Isolated spec file because toExternal()
 * navigates to Shell-home, leaving the sandbox unrecoverable for the
 * browser session.
 */
describe("FLP clean cross-app navigation (isolated session)", () => {
	before(async () => {
		await resetFlpDemo();
	});

	it("completes clean cross-app navigation without triggering FLP dirty prompt", async () => {
		await loginAndGoToProtectedInFlp();
		// Form is clean (isDirty = false, the default after resetFlpDemo)

		// Install a dialog handler to detect whether FLP calls confirm.
		// With a clean form, the dirty-state provider should return false
		// and FLP should NOT show any confirmation dialog.
		const { record, cleanup } = installDialogHandler(true);

		try {
			await triggerFlpCrossAppNavigation();

			// Navigation should complete to Shell-home without any prompt.
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

			// Confirm dialog was never triggered. Clean state means no prompt.
			expect(record.called).toBe(false);
		} finally {
			cleanup();
		}
	});
});
