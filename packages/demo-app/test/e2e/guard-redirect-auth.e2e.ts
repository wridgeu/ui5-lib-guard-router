import { CONTROLS, press } from "../shared/controls";
import { getRuntimeSettlementRevision } from "../shared/models";
import { expectKeptOnHome, startAtHome } from "./helpers";

describe("Guard redirects unauthenticated navigation", () => {
	it("should redirect to Home when navigating to Protected while logged out", async () => {
		// Asserts "Logged Out" on Home.
		await startAtHome();

		const settlementRevision = await getRuntimeSettlementRevision();
		await press(CONTROLS.home.navProtectedBtn);

		// The async permission guard redirects.
		await expectKeptOnHome("Redirected", settlementRevision);
	});
});
