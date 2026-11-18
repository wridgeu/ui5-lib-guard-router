import { CONTROLS, press } from "../shared/controls";
import { getRuntimeSettlementRevision } from "../shared/models";
import { expectKeptOnHome, startAtHome } from "./helpers";

describe("Guard blocks enter navigation", () => {
	it("should stay on Home and report Blocked when navigating to Blocked", async () => {
		await startAtHome();

		const settlementRevision = await getRuntimeSettlementRevision();
		await press(CONTROLS.home.navBlockedBtn);

		await expectKeptOnHome("Blocked", settlementRevision);
	});
});
