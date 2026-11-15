import { CONTROLS, selectorFor } from "../shared/controls";
import { getRuntimeSettlementRevision, waitForPage, resetAuth, waitForRuntimeSettlement } from "./helpers";

describe("Guard allows navigation when logged in", () => {
	it("should allow navigation to Protected after login", async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();

		// Toggle login
		const toggleBtn = await browser.asControl(selectorFor(CONTROLS.home.toggleLoginBtn));
		await toggleBtn.press();

		// Verify logged in
		const status = await browser.asControl(selectorFor(CONTROLS.home.authStatus));
		expect(await status.getProperty("text")).toBe("Logged In");

		// Navigate to protected
		const navBtn = await browser.asControl(selectorFor(CONTROLS.home.navProtectedBtn));
		const settlementRevision = await getRuntimeSettlementRevision();
		await navBtn.press();

		// Wait for view to load - this confirms async guard completed and navigation committed.
		// Don't wait for hash first because it changes BEFORE async guard completes.
		await waitForPage(CONTROLS.protected.protectedPage, "Protected Page");

		const settlement = await waitForRuntimeSettlement(
			{
				status: "Committed",
				route: "protected",
				hash: "protected",
			},
			{
				afterRevision: settlementRevision,
			},
		);
		expect(settlement.route).toBe("protected");
		expect(settlement.hash).toBe("protected");

		// Hash should now be correct
		const url = await browser.getUrl();
		expect(url).toContain("#/protected");
	});
});
