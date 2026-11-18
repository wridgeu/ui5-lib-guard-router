import { CONTROLS, press } from "../shared/controls";
import {
	expectHashToBe,
	fireEvent,
	getRuntimeSettlementRevision,
	loginAndGoToProtected,
	startAtHome,
	waitForPage,
	waitForRuntimeSettlement,
} from "./helpers";

/** On Protected: press the Page's built-in nav button and assert that the navigation to Home committed. */
async function navBackToHome(): Promise<void> {
	const settlementRevision = await getRuntimeSettlementRevision();
	await fireEvent(CONTROLS.protected.protectedPage, "navButtonPress");

	await waitForPage(CONTROLS.home.homePage, "Home", { afterRevision: settlementRevision });
	await waitForRuntimeSettlement(
		{ status: "Committed", route: "home", hash: "(empty hash)" },
		{ afterRevision: settlementRevision },
	);
	await expectHashToBe("");
}

describe("UI5 in-app nav back button", () => {
	it("should navigate back to Home via the Page nav button", async () => {
		await startAtHome();
		await loginAndGoToProtected();

		await navBackToHome();
	});

	it("should allow re-navigation after using nav back button", async () => {
		await startAtHome();
		await loginAndGoToProtected();
		await navBackToHome();

		// Navigate to Protected again
		const settlementRevision = await getRuntimeSettlementRevision();
		await press(CONTROLS.home.navProtectedBtn);

		await waitForPage(CONTROLS.protected.protectedPage, "Protected Page", { afterRevision: settlementRevision });
		await waitForRuntimeSettlement(
			{ status: "Committed", route: "protected", hash: "protected" },
			{ afterRevision: settlementRevision },
		);
		await expectHashToBe("#/protected");
	});
});
