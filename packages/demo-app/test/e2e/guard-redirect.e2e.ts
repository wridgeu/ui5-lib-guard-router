import { CONTROLS, press } from "../shared/controls";
import { getRuntimeSettlementRevision } from "../shared/models";
import { expectKeptOnHome, startAtHome } from "./helpers";

describe("Guard redirects to Home", () => {
	it("should redirect from Forbidden to Home", async () => {
		await startAtHome();

		const settlementRevision = await getRuntimeSettlementRevision();
		await press(CONTROLS.home.navForbiddenBtn);

		await expectKeptOnHome("Redirected", settlementRevision);
	});
});
