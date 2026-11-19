import { CONTROLS, expectControlText } from "../shared/controls";
import { getRuntimeSettlementRevision } from "../shared/models";
import {
	expectAppHashToBe,
	expectInAppNavigationBlocked,
	installDialogHandler,
	loginAndGoToProtectedInFlp,
	resetFlpDemo,
	setDirtyStateInFlp,
	triggerFlpCrossAppNavigationAndExpectDirtyPrompt,
	waitForProtectedPageInFlp,
	waitForRouterRunningInFlp,
} from "./helpers";

/** Set the app hash through the hash changer, as a link or a URL typed into the address bar does. */
async function setAppHashInFlp(hash: string): Promise<void> {
	await browser.execute((appHash: string) => {
		const HashChanger = sap.ui.require("sap/ui/core/routing/HashChanger");
		HashChanger.getInstance().setHash(appHash);
	}, hash);
}

/**
 * On Protected: change the app hash to one that a guard blocks, and assert that the page and
 * the URL stay as they were, without an FLP confirm dialog.
 */
async function expectHashChangeBlocked(hash: string): Promise<void> {
	const settlementRevision = await getRuntimeSettlementRevision();
	const { record, cleanup } = installDialogHandler(true);

	try {
		await setAppHashInFlp(hash);

		await expectAppHashToBe("protected", { afterRevision: settlementRevision });
		await waitForProtectedPageInFlp();
		await expectControlText(CONTROLS.protected.settlementStatus, "Blocked");
		await expectControlText(CONTROLS.protected.settlementHashText, "protected");
		await expectControlText(CONTROLS.protected.protectedCurrentHashText, "#/protected");
		expect(record.called).toBe(false);
	} finally {
		cleanup();
	}
}

describe("FLP preview integration", () => {
	beforeEach(async () => {
		await resetFlpDemo();
	});

	it("shows FLP runtime state on launch", async () => {
		await expectControlText(CONTROLS.home.launchModeText, "FLP Preview");
		await expectControlText(CONTROLS.home.ushellStatus, "sap.ushell.Container available");
		await expectControlText(CONTROLS.home.flpDirtyProviderStatus, "FLP cross-app dirty protection active");
	});

	it("keeps app navigation working inside FLP preview", async () => {
		await loginAndGoToProtectedInFlp();
		await expectControlText(
			CONTROLS.protected.protectedFlpDirtyProviderStatus,
			"FLP cross-app dirty protection active",
		);
		await expectControlText(CONTROLS.protected.protectedCurrentHashText, "#/protected");
		await expectControlText(CONTROLS.protected.settlementStatus, "Committed");
		await expectControlText(CONTROLS.protected.settlementRouteText, "protected");
		await expectControlText(CONTROLS.protected.settlementHashText, "protected");
		await expectControlText(CONTROLS.protected.settlementHashTechnicalText, 'Technical: "protected"');
	});

	it("triggers FLP dirty-state prompt on cross-app navigation and stays on page after cancel", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);

		await triggerFlpCrossAppNavigationAndExpectDirtyPrompt();
		await waitForProtectedPageInFlp();
	});

	it("still runs the leave guard after a cancelled cross-app navigation", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);

		// FLP stops the router of the app when the cross-app navigation starts, and initializes
		// it again once the user cancelled the prompt: the router has to resume on "protected".
		await triggerFlpCrossAppNavigationAndExpectDirtyPrompt();
		await waitForProtectedPageInFlp();
		await waitForRouterRunningInFlp();

		await expectInAppNavigationBlocked();
	});

	it("returns to the page when the leave guard blocks a hash change after a cancelled cross-app navigation", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);

		// FLP initializes the router again while the URL still shows the target of the cross-app
		// navigation, and puts the URL back without a hash change event.
		await triggerFlpCrossAppNavigationAndExpectDirtyPrompt();
		await waitForProtectedPageInFlp();
		await waitForRouterRunningInFlp();

		await expectHashChangeBlocked("employees");
		// The router is where it was: the next hash change is blocked and undone alike.
		await expectHashChangeBlocked("employees");
	});

	it("returns to the page when an enter guard blocks a hash change after a cancelled cross-app navigation", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);
		await triggerFlpCrossAppNavigationAndExpectDirtyPrompt();
		await waitForProtectedPageInFlp();
		await waitForRouterRunningInFlp();
		// The leave guard allows now, the enter guard of "blocked" does not.
		await setDirtyStateInFlp(false);

		await expectHashChangeBlocked("blocked");
	});

	it("blocks dirty in-app navigation via leave guard without triggering FLP confirm", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);

		await expectInAppNavigationBlocked();
	});

	it("proves leave guard and FLP dirty provider operate independently on the same dirty state", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);

		// PART 1: In-app navigation. Leave guard blocks, no FLP confirm.
		await expectInAppNavigationBlocked();

		// PART 2: Same dirty state, cross-app navigation. FLP confirm fires.
		await triggerFlpCrossAppNavigationAndExpectDirtyPrompt();
		await waitForProtectedPageInFlp();
	});
});
