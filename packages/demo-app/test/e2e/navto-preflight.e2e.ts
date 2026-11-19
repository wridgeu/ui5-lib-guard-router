import { CONTROLS, press } from "../shared/controls";
import { getRuntimeSettlementRevision } from "../shared/models";
import { expectHashToBe, waitForPage, waitForRuntimeSettlement } from "./helpers/wait";
import { getHistoryLength } from "./helpers/browser";
import { expectKeptOnHome, startAtHome, toggleLogin } from "./helpers/scenarios";

describe("navTo preflight - history guarantees", () => {
	beforeEach(async () => {
		await startAtHome();
	});

	it("programmatic navTo to blocked route should not increase history length", async () => {
		const before = await getHistoryLength();
		const rev = await getRuntimeSettlementRevision();

		await press(CONTROLS.home.navBlockedBtn);

		await expectKeptOnHome("Blocked", rev);

		const after = await getHistoryLength();
		expect(after).toBe(before);
	});

	it("programmatic navTo to redirect route should not increase history length", async () => {
		const before = await getHistoryLength();
		const rev = await getRuntimeSettlementRevision();

		await press(CONTROLS.home.navForbiddenBtn);

		await expectKeptOnHome("Redirected", rev);

		const after = await getHistoryLength();
		expect(after).toBe(before);
	});

	it("programmatic navTo to protected route when logged out should not increase history length", async () => {
		const before = await getHistoryLength();
		const rev = await getRuntimeSettlementRevision();

		await press(CONTROLS.home.navProtectedBtn);

		await expectKeptOnHome("Redirected", rev);

		const after = await getHistoryLength();
		expect(after).toBe(before);
	});

	it("programmatic navTo to allowed route should increase history length by 1", async () => {
		await toggleLogin("Logged In");

		const before = await getHistoryLength();
		const rev = await getRuntimeSettlementRevision();

		await press(CONTROLS.home.navProtectedBtn);

		await waitForPage(CONTROLS.protected.protectedPage, "Protected Page", {
			afterRevision: rev,
		});
		await waitForRuntimeSettlement(
			{ status: "Committed", route: "protected", hash: "protected" },
			{ afterRevision: rev },
		);
		await expectHashToBe("#/protected");

		const after = await getHistoryLength();
		expect(after).toBe(before + 1);
	});
});
