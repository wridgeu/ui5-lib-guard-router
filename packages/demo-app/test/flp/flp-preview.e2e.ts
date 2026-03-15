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
});
