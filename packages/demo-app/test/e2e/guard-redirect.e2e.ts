import { CONTROLS, press } from "../shared/controls";
import {
	expectHashToBe,
	getRuntimeSettlementRevision,
	startAtHome,
	waitForPage,
	waitForRuntimeSettlement,
} from "./helpers";

describe("Guard redirects to Home", () => {
	it("should redirect from Forbidden to Home", async () => {
		await startAtHome();

		const settlementRevision = await getRuntimeSettlementRevision();
		await press(CONTROLS.home.navForbiddenBtn);

		// Home and the empty hash are also the starting state: the settlement after
		// `settlementRevision` proves that the navigation ran and was redirected.
		await waitForRuntimeSettlement(
			{ status: "Redirected", route: "home", hash: "(empty hash)" },
			{ afterRevision: settlementRevision },
		);
		await expectHashToBe("", "Hash should settle to home after guard redirect");
		await waitForPage(CONTROLS.home.homePage, "Home");
	});
});
