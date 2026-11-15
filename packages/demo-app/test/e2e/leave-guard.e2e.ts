import { CONTROLS, getAppComponentId } from "../shared/controls";
import {
	getRuntimeSettlementRevision,
	waitForPage,
	fireEvent,
	resetAuth,
	setDirtyState,
	expectHashToBe,
	waitForRuntimeSettlement,
} from "./helpers";

async function loginAndGoToProtected(): Promise<void> {
	await fireEvent(CONTROLS.home.toggleLoginBtn, "press");
	await fireEvent(CONTROLS.home.navProtectedBtn, "press");
	await waitForPage(CONTROLS.protected.protectedPage, "Protected Page");
}

describe("Leave Guard - Dirty Form", () => {
	beforeEach(async () => {
		await resetAuth();
		await setDirtyState(false); // Ensure clean state before each test
		await browser.goTo({ sHash: "" });
		await waitForPage(CONTROLS.home.homePage, "Home");
	});

	it("should allow leaving protected page when form is clean", async () => {
		await loginAndGoToProtected();
		await setDirtyState(false);

		await fireEvent(CONTROLS.protected.protectedPage, "navButtonPress");
		await expectHashToBe("", "Hash should settle to home after leave guard allows");
		await waitForPage(CONTROLS.home.homePage, "Home");
	});

	it("should block leaving protected page when form is dirty", async () => {
		await loginAndGoToProtected();
		await setDirtyState(true);
		const settlementRevision = await getRuntimeSettlementRevision();

		await fireEvent(CONTROLS.protected.protectedPage, "navButtonPress");

		// Leave guard should block - hash should stay at protected
		await expectHashToBe("#/protected", {
			timeoutMsg: "Hash should stay at protected after leave guard blocks",
			afterRevision: settlementRevision,
		});
		const settlement = await waitForRuntimeSettlement(
			{
				status: "Blocked",
				route: "protected",
				hash: "protected",
			},
			{
				afterRevision: settlementRevision,
			},
		);

		expect(settlement.route).toBe("protected");
		expect(settlement.hash).toBe("protected");
	});

	it("should allow leaving after clearing dirty state", async () => {
		await loginAndGoToProtected();
		await setDirtyState(true);
		await setDirtyState(false);

		await fireEvent(CONTROLS.protected.protectedPage, "navButtonPress");
		await expectHashToBe("", "Hash should settle to home after leave guard allows");
		await waitForPage(CONTROLS.home.homePage, "Home");
	});

	it("should block browser back when form is dirty", async () => {
		await loginAndGoToProtected();
		await setDirtyState(true);

		// Verify dirty state was set before attempting navigation
		const isDirty = await browser.execute(
			(componentId: string) => {
				const Component = sap.ui.require("sap/ui/core/Component");
				return Component?.getComponentById(componentId)?.getModel("form")?.getProperty("/isDirty");
			},
			await getAppComponentId(),
		);
		expect(isDirty).toBe(true);

		const settlementRevision = await getRuntimeSettlementRevision();
		await browser.execute(() => window.history.back());
		await expectHashToBe("#/protected", {
			timeoutMsg: "Hash should stay at protected after leave guard blocks",
			afterRevision: settlementRevision,
		});
		const settlement = await waitForRuntimeSettlement(
			{
				status: "Blocked",
				route: "protected",
				hash: "protected",
			},
			{ afterRevision: settlementRevision },
		);
		expect(settlement.route).toBe("protected");
		expect(settlement.hash).toBe("protected");
	});
});
