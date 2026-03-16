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

	it("triggers FLP dirty-state prompt on cross-app navigation and stays on page after cancel", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);

		// The monkey-patch intercepts confirm() to return false (user cancels)
		// and to verify the dirty-state provider actually called confirm().
		// Headless Chrome returns false for confirm() by default, but without
		// the intercept we cannot assert that the dialog was triggered.
		await triggerFlpCrossAppNavigationAndExpectDirtyPrompt();
		await waitForProtectedPageInFlp();
		await expectControlText("protectedCurrentHashText", "#/protected");
	});

	it("blocks dirty in-app navigation via leave guard", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);

		// In-app navigation goes through the router's leave guard.
		// The dirty form leave guard blocks silently.
		await browser.execute(() => {
			const Component = sap.ui.require("sap/ui/core/Component");
			const all = Component.registry.all() as Record<string, UIComponent>;
			const component = Object.values(all).find((c) => c.getManifestEntry("sap.app")?.id === "demo.app");
			component?.getRouter().navTo("home", {}, undefined, true);
		});

		await waitForProtectedPageInFlp();
		await expectControlText("protectedCurrentHashText", "#/protected");
	});
});
