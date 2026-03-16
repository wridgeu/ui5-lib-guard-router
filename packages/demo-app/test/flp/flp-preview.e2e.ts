import type UIComponent from "sap/ui/core/UIComponent";
import {
	expectControlText,
	installDialogHandler,
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

		await triggerFlpCrossAppNavigationAndExpectDirtyPrompt();
		await waitForProtectedPageInFlp();
		await expectControlText("protectedCurrentHashText", "#/protected");
	});

	it("blocks dirty in-app navigation via leave guard without triggering FLP confirm", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);

		// Install a dialog handler to detect whether FLP's confirm fires.
		// The leave guard should block in-app navigation silently --
		// without involving the FLP dirty-state provider at all.
		const { record, cleanup } = installDialogHandler(true);

		try {
			await browser.execute(() => {
				const Component = sap.ui.require("sap/ui/core/Component");
				const all = Component.registry.all() as Record<string, UIComponent>;
				const component = Object.values(all).find((c) => c.getManifestEntry("sap.app")?.id === "demo.app");
				component?.getRouter().navTo("home", {}, undefined, true);
			});

			// Page stays on Protected -- leave guard blocked the navigation.
			await waitForProtectedPageInFlp();
			await expectControlText("protectedCurrentHashText", "#/protected");

			// The dialog handler intercepts at the WebDriver BiDi protocol
			// level, so any confirm() call is captured synchronously during
			// the navigation. No confirm dialog was triggered.
			expect(record.called).toBe(false);
		} finally {
			cleanup();
		}
	});

	it("proves leave guard and FLP dirty provider operate independently on the same dirty state", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);

		// PART 1: In-app navigation -- leave guard blocks, no FLP confirm
		const { record: inAppRecord, cleanup: inAppCleanup } = installDialogHandler(true);

		try {
			await browser.execute(() => {
				const Component = sap.ui.require("sap/ui/core/Component");
				const all = Component.registry.all() as Record<string, UIComponent>;
				const component = Object.values(all).find((c) => c.getManifestEntry("sap.app")?.id === "demo.app");
				component?.getRouter().navTo("home", {}, undefined, true);
			});

			await waitForProtectedPageInFlp();
			expect(inAppRecord.called).toBe(false);
		} finally {
			inAppCleanup();
		}

		// PART 2: Same dirty state, cross-app navigation -- FLP confirm fires.
		// The dirty-state provider calls confirm(); we dismiss (cancel) so we
		// stay on the page. This proves the two mechanisms handle separate
		// scopes and do not interfere with each other.
		await triggerFlpCrossAppNavigationAndExpectDirtyPrompt();
		await waitForProtectedPageInFlp();
		await expectControlText("protectedCurrentHashText", "#/protected");
	});
});
