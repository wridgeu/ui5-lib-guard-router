import { CONTROLS, press } from "../shared/controls";
import {
	expectHashToBe,
	getRuntimeSettlementRevision,
	startAtHome,
	waitForPage,
	waitForRuntimeSettlement,
} from "./helpers";

describe("Guard blocks enter navigation", () => {
	it("should stay on Home and report Blocked when navigating to Blocked", async () => {
		await startAtHome();

		const settlementRevision = await getRuntimeSettlementRevision();
		await press(CONTROLS.home.navBlockedBtn);

		// Home and the empty hash are also the starting state: the settlement after
		// `settlementRevision` proves that the navigation ran and was blocked.
		await waitForRuntimeSettlement(
			{ status: "Blocked", route: "home", hash: "(empty hash)" },
			{ afterRevision: settlementRevision },
		);
		await expectHashToBe("", "Hash should stay on home after enter guard blocks");
		await waitForPage(CONTROLS.home.homePage, "Home");
	});
});
