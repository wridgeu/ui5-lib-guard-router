import { loginAndGoToProtectedInFlp, resetFlpDemo, setDirtyStateInFlp } from "./helpers";

/**
 * Non-dirty cross-app navigation. Isolated spec file because toExternal()
 * navigates to Shell-home (home button, tile click, etc.), which leaves the
 * FLP sandbox in an unrecoverable state for the browser session.
 */
describe("FLP cross-app navigation -- clean form", () => {
	before(async () => {
		await resetFlpDemo();
	});

	it("completes cross-app navigation without dirty prompt when form is clean", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(false);

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

			const confirmWasCalled = await browser.execute(() => {
				return (window as Window & { __flpConfirmCalled?: boolean }).__flpConfirmCalled === true;
			});
			expect(confirmWasCalled).toBe(false);
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
