import { CONTROLS, press } from "../shared/controls";
import { getRuntimeSettlementRevision } from "../shared/models";
import { expectKeptOnHome, loginAndGoToProtected, navBackToHome, startAtHome, toggleLogin } from "./helpers/scenarios";

/** On Home: press a navigation button whose guard redirects to Home. */
async function pressAndExpectRedirectHome(button: "navProtectedBtn" | "navForbiddenBtn"): Promise<void> {
	const settlementRevision = await getRuntimeSettlementRevision();
	await press(CONTROLS.home[button]);

	await expectKeptOnHome("redirected", settlementRevision);
}

describe("Multi-route navigation sequences", () => {
	beforeEach(async () => {
		await startAtHome();
		await loginAndGoToProtected();
		await navBackToHome();
	});

	it("should handle Home -> Protected -> Home -> Forbidden (redirected) -> Home sequence", async () => {
		await pressAndExpectRedirectHome("navForbiddenBtn");
	});

	it("should redirect protected to Home after mid-session logout", async () => {
		await toggleLogin("Logged Out");

		await pressAndExpectRedirectHome("navProtectedBtn");
	});

	it("should handle login -> protected -> logout -> protected (redirected) -> login -> protected (allowed)", async () => {
		await toggleLogin("Logged Out");
		await pressAndExpectRedirectHome("navProtectedBtn");

		// Login again: Protected is allowed again
		await loginAndGoToProtected();
	});
});
