/// <reference types="@wdio/globals/types" />

import { setDirtyState } from "../e2e/helpers";
import {
	clickFlpHomeButton,
	expectControlText,
	loginAndGoToProtectedInFlp,
	resetFlpDemo,
	waitForDirtyStatePrompt,
	waitForProtectedPageInFlp,
} from "./helpers";

describe("FLP preview integration", () => {
	beforeEach(async () => {
		await resetFlpDemo();
	});

	it("shows FLP runtime state on launch", async () => {
		await expectControlText("container-demo.app---homeView--launchModeText", "FLP Preview");
		await expectControlText("container-demo.app---homeView--ushellStatus", "sap.ushell.Container available");
		await expectControlText(
			"container-demo.app---homeView--flpDirtyProviderStatus",
			"FLP cross-app dirty protection active",
		);
	});

	it("keeps app navigation working inside FLP preview", async () => {
		await loginAndGoToProtectedInFlp();
		await expectControlText(
			"container-demo.app---protectedView--protectedFlpDirtyProviderStatus",
			"FLP cross-app dirty protection active",
		);
		await expectControlText("container-demo.app---protectedView--protectedCurrentHashText", "#/protected");
	});

	it("uses the FLP dirty-state prompt for cross-app navigation", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyState(true);

		await clickFlpHomeButton();
		await waitForDirtyStatePrompt();

		const alertText = await browser.getAlertText();
		expect(alertText.length).toBeGreaterThan(0);

		await browser.dismissAlert();
		await waitForProtectedPageInFlp();
		await expectControlText("container-demo.app---protectedView--protectedCurrentHashText", "#/protected");
	});
});
