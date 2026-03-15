import { loginAndGoToProtectedInFlp, resetFlpDemo, setDirtyStateInFlp } from "./helpers";

/**
 * Cross-app navigation test that leaves the FLP sandbox in an unrecoverable
 * state (Shell-home). Isolated in its own spec file so wdio gives it a fresh
 * browser session -- no ordering constraints on the main FLP suite.
 */
describe("FLP cross-app navigation (isolated session)", () => {
	beforeEach(async () => {
		await resetFlpDemo();
	});

	it("does not trigger dirty-state prompt on cross-app navigation when not dirty", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(false);

		// Cross-app navigation while not dirty should not show a confirm prompt.
		// Install an intercept to verify confirm is NOT called.
		await browser.execute(() => {
			const w = window as Window & { __flpConfirmCalled?: boolean };
			w.__flpConfirmCalled = false;
			const originalConfirm = window.confirm;
			(window as Window & { __flpOriginalConfirm?: typeof confirm }).__flpOriginalConfirm = originalConfirm;
			window.confirm = (_message?: string): boolean => {
				w.__flpConfirmCalled = true;
				return false;
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

			// Wait for the FLP to complete cross-app navigation -- the hash changes
			// to Shell-home when _handleDataLoss allows navigation through.
			// This proves the dirty-state filter ran without calling confirm().
			await browser.waitUntil(
				async () => {
					const hash = await browser.execute(() => window.location.hash);
					return hash.includes("Shell-home");
				},
				{
					timeout: 5000,
					timeoutMsg:
						"FLP did not complete cross-app navigation to Shell-home (dirty provider may have blocked)",
				},
			);

			const confirmWasCalled = await browser.execute(() => {
				return (window as Window & { __flpConfirmCalled?: boolean }).__flpConfirmCalled === true;
			});
			expect(confirmWasCalled).toBe(false);
		} finally {
			// Always restore original confirm, even if assertions fail
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
