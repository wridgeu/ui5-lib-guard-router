import type UIComponent from "sap/ui/core/UIComponent";
import {
	expectControlText,
	loginAndGoToProtectedInFlp,
	resetFlpDemo,
	setDirtyStateInFlp,
	triggerFlpCrossAppNavigationAndExpectDirtyPrompt,
	waitForProtectedPageInFlp,
} from "./helpers";

describe("FLP preview integration", () => {
	beforeEach(async () => {
		await resetFlpDemo();
	});

	it("shows FLP runtime state on launch", async () => {
		await expectControlText("launchModeText", "FLP Preview");
		await expectControlText("ushellStatus", "sap.ushell.Container available");
		await expectControlText("flpDirtyProviderStatus", "FLP cross-app dirty protection active");
	});

	it("keeps app navigation working inside FLP preview", async () => {
		await loginAndGoToProtectedInFlp();
		await expectControlText("protectedFlpDirtyProviderStatus", "FLP cross-app dirty protection active");
		await expectControlText("protectedCurrentHashText", "#/protected");
	});

	it("triggers FLP dirty-state prompt on cross-app navigation and stays on page after dismissal", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);

		await triggerFlpCrossAppNavigationAndExpectDirtyPrompt();
		await waitForProtectedPageInFlp();
		await expectControlText("protectedCurrentHashText", "#/protected");
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

		const triggered = await browser.execute(() => {
			const Container = sap.ui.require("sap/ushell/Container");
			const navService = Container?.getService("CrossApplicationNavigation");
			if (!navService?.toExternal) return false;
			navService.toExternal({ target: { shellHash: "Shell-home" } });
			return true;
		});
		expect(triggered).toBe(true);

		// Wait for the FLP to complete cross-app navigation — the hash changes
		// to Shell-home when _handleDataLoss allows navigation through.
		// This proves the dirty-state filter ran without calling confirm().
		await browser.waitUntil(
			async () => {
				const hash = await browser.execute(() => window.location.hash);
				return hash.includes("Shell-home");
			},
			{
				timeout: 5000,
				timeoutMsg: "FLP did not complete cross-app navigation to Shell-home (dirty provider may have blocked)",
			},
		);

		const confirmWasCalled = await browser.execute(() => {
			return (window as Window & { __flpConfirmCalled?: boolean }).__flpConfirmCalled === true;
		});
		expect(confirmWasCalled).toBe(false);

		// Restore original confirm
		await browser.execute(() => {
			const w = window as Window & { __flpOriginalConfirm?: typeof confirm };
			if (w.__flpOriginalConfirm) {
				window.confirm = w.__flpOriginalConfirm;
				delete w.__flpOriginalConfirm;
			}
		});
	});

	it("allows in-app navigation without dirty-state prompt even when dirty", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);

		// In-app navigation (navigating to home) should go through the router's
		// leave guard, not the FLP dirty-state provider. The dirty form leave guard
		// blocks in-app navigation silently, so we stay on the protected page.
		await browser.execute(() => {
			const Component = sap.ui.require("sap/ui/core/Component");
			const all = Component.registry.all() as Record<string, UIComponent>;
			const component = Object.values(all).find((c) => c.getManifestEntry("sap.app")?.id === "demo.app");
			component?.getRouter().navTo("home", {}, undefined, true);
		});

		// The dirty form guard should block in-app navigation, keeping us on protected
		await waitForProtectedPageInFlp();
		await expectControlText("protectedCurrentHashText", "#/protected");
	});
});
