import { CONTROLS, press } from "../shared/controls";
import {
	expectHashToBe,
	getRuntimeSettlementRevision,
	startAtHome,
	waitForPage,
	waitForRuntimeSettlement,
} from "./helpers";

describe("Guard redirects unauthenticated navigation", () => {
	it("should redirect to Home when navigating to Protected while logged out", async () => {
		// Asserts "Logged Out" on Home.
		await startAtHome();

		const settlementRevision = await getRuntimeSettlementRevision();
		await press(CONTROLS.home.navProtectedBtn);

		// Home and the empty hash are also the starting state: the settlement after
		// `settlementRevision` proves that the async guard ran and redirected.
		await waitForRuntimeSettlement(
			{ status: "Redirected", route: "home", hash: "(empty hash)" },
			{ afterRevision: settlementRevision },
		);
		await expectHashToBe("", "Hash should settle to home after guard redirect");
		await waitForPage(CONTROLS.home.homePage, "Home");
	});
});
