import {
	installDialogHandler,
	loginAndGoToProtectedInFlp,
	resetFlpDemo,
	setDirtyStateInFlp,
	triggerFlpCrossAppNavigation,
} from "./helpers";

/**
 * Cross-app navigation test. Isolated spec file because toExternal()
 * (e.g. FLP home button, tile click) navigates to Shell-home, leaving
 * the sandbox unrecoverable for the browser session.
 */
describe("FLP cross-app navigation (isolated session)", () => {
	before(async () => {
		await resetFlpDemo();
	});

	it("completes dirty cross-app navigation after user confirms FLP dialog", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);

		// Accept the FLP dirty-state confirm dialog (user confirms navigation).
		const { record, cleanup } = installDialogHandler(true);

		try {
			await triggerFlpCrossAppNavigation();

			// Verify the dirty-state provider triggered the confirm dialog.
			await browser.waitUntil(() => record.called, {
				timeout: 5000,
				timeoutMsg: "FLP dirty-state provider did not trigger a confirm dialog",
			});

			// Cross-app navigation completes to Shell-home after confirmation.
			await browser.waitUntil(
				async () => {
					const hash = await browser.execute(() => window.location.hash);
					return hash.includes("Shell-home");
				},
				{
					timeout: 5000,
					timeoutMsg: "FLP did not complete cross-app navigation to Shell-home",
				},
			);
		} finally {
			cleanup();
		}
	});
});
