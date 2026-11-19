import { CONTROLS, expectControlText, press } from "../shared/controls";
import { getDirtyState, getRuntimeSettlementRevision, setDirtyState } from "../shared/models";
import { expectHashToBe, waitForPage, waitForRuntimeSettlement } from "./helpers/wait";
import { fireEvent } from "./helpers/browser";
import { getHistoryEntryIndex, getHistoryLength } from "../shared/history";
import { loginAndGoToProtected, startAtHome } from "./helpers/scenarios";

/** On Protected: set the form state and assert that the page shows it. */
async function setDirtyOnProtected(isDirty: boolean): Promise<void> {
	await setDirtyState(isDirty);
	await expectControlText(CONTROLS.protected.dirtyStatus, isDirty ? "Form has unsaved changes" : "Form is clean");
}

/** Assert that the navigation started after `afterRevision` was blocked and Protected is still shown. */
async function expectLeaveBlocked(afterRevision: number): Promise<void> {
	await waitForRuntimeSettlement({ status: "blocked", route: "protected", hash: "protected" }, { afterRevision });
	await expectHashToBe("#/protected", "Hash should stay at protected after leave guard blocks");
	await waitForPage(CONTROLS.protected.protectedPage, "Protected Page");
}

/** Assert that the navigation started after `afterRevision` left Protected and committed on Home. */
async function expectLeftToHome(afterRevision: number): Promise<void> {
	await waitForPage(CONTROLS.home.homePage, "Home", { afterRevision });
	await waitForRuntimeSettlement({ status: "committed", route: "home", hash: "" }, { afterRevision });
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

	it("should clear the dirty state and go home with the clear button", async () => {
		await setDirtyOnProtected(true);
		const settlementRevision = await getRuntimeSettlementRevision();

		await press(CONTROLS.protected.clearDirtyAndGoHomeBtn);

		// Committed on Home, not blocked: the button clears the state before it navigates.
		await expectLeftToHome(settlementRevision);
		expect(await getDirtyState()).toBe(false);
	});

	it("should block browser back when form is dirty", async () => {
		await setDirtyOnProtected(true);
		const settlementRevision = await getRuntimeSettlementRevision();

		await browser.back();

		await expectLeaveBlocked(settlementRevision);
	});

	it("should leave the browser history as it was after a blocked browser back", async () => {
		await setDirtyOnProtected(true);
		const historyLength = await getHistoryLength();
		const entryIndex = await getHistoryEntryIndex();
		const blockedRevision = await getRuntimeSettlementRevision();
		await browser.back();
		await expectLeaveBlocked(blockedRevision);
		// The browser is on the entry it left, not on the one before it with the hash replaced.
		expect(await getHistoryEntryIndex()).toBe(entryIndex);
		expect(await getHistoryLength()).toBe(historyLength);

		// The entry of Home is still behind Protected: one step back arrives there.
		await setDirtyOnProtected(false);
		const backRevision = await getRuntimeSettlementRevision();
		await browser.back();
		await expectLeftToHome(backRevision);

		// And the entry of Protected is still ahead of it.
		const forwardRevision = await getRuntimeSettlementRevision();
		await browser.forward();
		await waitForRuntimeSettlement(
			{ status: "committed", route: "protected", hash: "protected" },
			{ afterRevision: forwardRevision },
		);
		await waitForPage(CONTROLS.protected.protectedPage, "Protected Page");
	});

	it("should go one step back with the nav button after it was blocked", async () => {
		await setDirtyOnProtected(true);
		const blockedRevision = await getRuntimeSettlementRevision();
		await fireEvent(CONTROLS.protected.protectedPage, "navButtonPress");
		await expectLeaveBlocked(blockedRevision);

		await setDirtyOnProtected(false);
		const historyLength = await getHistoryLength();
		const settlementRevision = await getRuntimeSettlementRevision();
		await fireEvent(CONTROLS.protected.protectedPage, "navButtonPress");
		await expectLeftToHome(settlementRevision);

		// A step back, not a new entry: the entry of Protected is ahead.
		expect(await getHistoryLength()).toBe(historyLength);
		await browser.forward();
		await waitForPage(CONTROLS.protected.protectedPage, "Protected Page");
		await expectHashToBe("#/protected");
	});
});
