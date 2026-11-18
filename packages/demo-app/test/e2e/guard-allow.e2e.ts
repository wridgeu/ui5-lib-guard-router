import { CONTROLS, press } from "../shared/controls";
import { getRuntimeSettlementRevision } from "../shared/models";
import { expectHashToBe, startAtHome, toggleLogin, waitForPage, waitForRuntimeSettlement } from "./helpers";

describe("Guard allows navigation when logged in", () => {
	it("should allow navigation to Protected after login", async () => {
		await startAtHome();
		await toggleLogin("Logged In");

		const settlementRevision = await getRuntimeSettlementRevision();
		await press(CONTROLS.home.navProtectedBtn);

		// The hash is only written once the async guard allowed the navigation.
		await waitForPage(CONTROLS.protected.protectedPage, "Protected Page", { afterRevision: settlementRevision });
		await waitForRuntimeSettlement(
			{ status: "Committed", route: "protected", hash: "protected" },
			{ afterRevision: settlementRevision },
		);
		await expectHashToBe("#/protected");
	});
});
