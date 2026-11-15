import { CONTROLS } from "../shared/controls";
import {
	expectHashToBe,
	fireEvent,
	getHistoryLength,
	getRuntimeSettlementRevision,
	resetAuth,
	waitForPage,
	waitForRuntimeSettlement,
} from "./helpers";

describe("navTo preflight - history guarantees", () => {
	beforeEach(async () => {
		await resetAuth();
		await browser.url("#");
		await waitForPage(CONTROLS.home.homePage, "Home");
	});

	it("programmatic navTo to blocked route should not increase history length", async () => {
		const before = await getHistoryLength();
		const rev = await getRuntimeSettlementRevision();

		await fireEvent(CONTROLS.home.navBlockedBtn, "press");

		await waitForRuntimeSettlement({ status: "Blocked", route: "home" }, { afterRevision: rev });
		await expectHashToBe("");

		const after = await getHistoryLength();
		expect(after).toBe(before);
	});

	it("programmatic navTo to redirect route should not increase history length", async () => {
		const before = await getHistoryLength();
		const rev = await getRuntimeSettlementRevision();

		await fireEvent(CONTROLS.home.navForbiddenBtn, "press");

		await waitForRuntimeSettlement({ status: "Redirected", route: "home" }, { afterRevision: rev });
		await expectHashToBe("");

		const after = await getHistoryLength();
		expect(after).toBe(before);
	});

	it("programmatic navTo to protected route when logged out should not increase history length", async () => {
		const before = await getHistoryLength();
		const rev = await getRuntimeSettlementRevision();

		await fireEvent(CONTROLS.home.navProtectedBtn, "press");

		await waitForRuntimeSettlement({ status: "Redirected", route: "home" }, { afterRevision: rev });
		await expectHashToBe("");

		const after = await getHistoryLength();
		expect(after).toBe(before);
	});

	it("programmatic navTo to allowed route should increase history length by 1", async () => {
		// Log in first
		await fireEvent(CONTROLS.home.toggleLoginBtn, "press");

		const before = await getHistoryLength();
		const rev = await getRuntimeSettlementRevision();

		await fireEvent(CONTROLS.home.navProtectedBtn, "press");

		await waitForPage(CONTROLS.protected.protectedPage, "Protected Page", {
			afterRevision: rev,
		});
		await waitForRuntimeSettlement({ status: "Committed", route: "protected" }, { afterRevision: rev });

		const after = await getHistoryLength();
		expect(after).toBe(before + 1);
	});
});
