import { loginAndGoToProtectedInFlp, resetFlpDemo, setDirtyStateInFlp } from "./helpers";

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

		// Monkey-patch confirm to return true (user confirms) and track
		// whether it was called. Headless Chrome returns false for confirm()
		// by default, so without this the FLP dialog would block.
		await browser.execute(() => {
			const w = window as Window & { __flpConfirmCalled?: boolean; __flpOriginalConfirm?: typeof confirm };
			w.__flpConfirmCalled = false;
			w.__flpOriginalConfirm = window.confirm;
			window.confirm = (): boolean => {
				w.__flpConfirmCalled = true;
				return true;
			};
		});

		try {
			// toExternal() (triggered by FLP home button, tile clicks, etc.)
			// operates at the shell level. The dirty-state provider fires,
			// FLP shows its confirm dialog, user confirms, navigation completes.
			const triggered = await browser.execute(() => {
				const Container = sap.ui.require("sap/ushell/Container");
				const navService = Container?.getService("CrossApplicationNavigation");
				if (!navService?.toExternal) return false;
				navService.toExternal({ target: { shellHash: "Shell-home" } });
				return true;
			});
			expect(triggered).toBe(true);

			// Verify the dirty-state provider actually triggered the confirm dialog.
			await browser.waitUntil(
				async () => {
					return browser.execute(() => {
						return (window as Window & { __flpConfirmCalled?: boolean }).__flpConfirmCalled === true;
					});
				},
				{ timeout: 5000, timeoutMsg: "FLP dirty-state provider did not call window.confirm" },
			);

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
			await browser.execute(() => {
				const w = window as Window & { __flpOriginalConfirm?: typeof confirm };
				if (w.__flpOriginalConfirm) {
					window.confirm = w.__flpOriginalConfirm;
					delete w.__flpOriginalConfirm;
				}
			});
		}
	});
});
