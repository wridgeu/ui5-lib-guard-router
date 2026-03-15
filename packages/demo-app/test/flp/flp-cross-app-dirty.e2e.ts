import { loginAndGoToProtectedInFlp, resetFlpDemo, setDirtyStateInFlp } from "./helpers";

/**
 * Dirty cross-app navigation with user confirmation. Isolated spec file
 * because toExternal() (e.g. FLP home button) navigates to Shell-home after
 * the user confirms, which leaves the sandbox unrecoverable for the session.
 */
describe("FLP cross-app navigation -- dirty form, user confirms", () => {
	before(async () => {
		await resetFlpDemo();
	});

	it("shows dirty prompt and completes cross-app navigation when user confirms", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);

		// Monkey-patch confirm to return true (user confirms they want to leave).
		// In both production and sandbox, toExternal() (triggered by FLP home
		// button, tile click, etc.) operates at the shell level. The dirty-state
		// provider fires, the FLP shows its confirm dialog, and on confirmation
		// the shell completes the cross-app navigation. The app router's leave
		// guard is never involved.
		await browser.execute(() => {
			const w = window as Window & { __flpConfirmCalled?: boolean; __flpOriginalConfirm?: typeof confirm };
			w.__flpConfirmCalled = false;
			w.__flpOriginalConfirm = window.confirm;
			window.confirm = (_message?: string): boolean => {
				w.__flpConfirmCalled = true;
				return true;
			};
		});

		try {
			const triggered = await browser.execute(() => {
				const Container = sap.ui.require("sap/ushell/Container");
				const navService = Container?.getService("CrossApplicationNavigation");
				if (!navService?.toExternal) return false;
				navService.toExternal({ target: { shellHash: "Shell-home" } });
				return true;
			});
			expect(triggered).toBe(true);

			// The dirty-state provider fires and the user confirms.
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
					timeoutMsg: "FLP did not complete cross-app navigation after user confirmed dirty dialog",
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
