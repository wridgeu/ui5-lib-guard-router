import { CONTROLS, expectControlText } from "../shared/controls";
import { getRuntimeSettlementRevision, setDirtyState } from "../shared/models";
import {
	expectHashToBe,
	fireEvent,
	loginAndGoToProtected,
	startAtHome,
	waitForPage,
	waitForRuntimeSettlement,
} from "./helpers";

/** On Protected: set the form state and assert that the page shows it. */
async function setDirtyOnProtected(isDirty: boolean): Promise<void> {
	await setDirtyState(isDirty);
	await expectControlText(CONTROLS.protected.dirtyStatus, isDirty ? "Form has unsaved changes" : "Form is clean");
}

/** Assert that the navigation started after `afterRevision` was blocked and Protected is still shown. */
async function expectLeaveBlocked(afterRevision: number): Promise<void> {
	await waitForRuntimeSettlement({ status: "Blocked", route: "protected", hash: "protected" }, { afterRevision });
	await expectHashToBe("#/protected", "Hash should stay at protected after leave guard blocks");
	await waitForPage(CONTROLS.protected.protectedPage, "Protected Page");
}

/** Assert that the navigation started after `afterRevision` left Protected and committed on Home. */
async function expectLeftToHome(afterRevision: number): Promise<void> {
	await waitForPage(CONTROLS.home.homePage, "Home", { afterRevision });
	await waitForRuntimeSettlement({ status: "Committed", route: "home", hash: "" }, { afterRevision });
	await expectHashToBe("", "Hash should settle to home after leave guard allows");
}

describe("Leave Guard - Dirty Form", () => {
	beforeEach(async () => {
		await startAtHome();
		await loginAndGoToProtected();
	});

	it("should allow leaving protected page when form is clean", async () => {
		await setDirtyOnProtected(false);
		const settlementRevision = await getRuntimeSettlementRevision();

		await fireEvent(CONTROLS.protected.protectedPage, "navButtonPress");

		await expectLeftToHome(settlementRevision);
	});

	it("should block leaving protected page when form is dirty", async () => {
		await setDirtyOnProtected(true);
		const settlementRevision = await getRuntimeSettlementRevision();

		await fireEvent(CONTROLS.protected.protectedPage, "navButtonPress");

		await expectLeaveBlocked(settlementRevision);
	});

	it("should allow leaving after clearing dirty state", async () => {
		// The dirty state has to be in effect first: the same navigation is blocked.
		await setDirtyOnProtected(true);
		const blockedRevision = await getRuntimeSettlementRevision();
		await fireEvent(CONTROLS.protected.protectedPage, "navButtonPress");
		await expectLeaveBlocked(blockedRevision);

		await setDirtyOnProtected(false);
		const settlementRevision = await getRuntimeSettlementRevision();

		await fireEvent(CONTROLS.protected.protectedPage, "navButtonPress");

		await expectLeftToHome(settlementRevision);
	});

	it("should block browser back when form is dirty", async () => {
		await setDirtyOnProtected(true);
		const settlementRevision = await getRuntimeSettlementRevision();

		await browser.back();

		await expectLeaveBlocked(settlementRevision);
	});
});
