import { CONTROLS } from "../shared/controls";
import { getRuntimeSettlementRevision } from "../shared/models";
import {
	expectHashToBe,
	expectKeptOnHome,
	loginAndGoToProtected,
	startAtHome,
	toggleLogin,
	waitForPage,
	waitForRuntimeSettlement,
} from "./helpers";

/** On Protected: go back in the browser history and assert that the navigation to Home committed. */
async function browserBackToHome(): Promise<void> {
	const settlementRevision = await getRuntimeSettlementRevision();
	await browser.back();

	await waitForPage(CONTROLS.home.homePage, "Home", { afterRevision: settlementRevision });
	await waitForRuntimeSettlement(
		{ status: "Committed", route: "home", hash: "" },
		{ afterRevision: settlementRevision },
	);
	await expectHashToBe("");
}

describe("Browser back navigation with guards", () => {
	beforeEach(async () => {
		await startAtHome();
		await loginAndGoToProtected();
	});

	it("should handle back navigation cleanly after login flow", async () => {
		await browserBackToHome();
	});

	it("should not show protected page on browser back after logout", async () => {
		await browserBackToHome();
		await toggleLogin("Logged Out");

		// Browser forward (toward previously visited #/protected)
		const settlementRevision = await getRuntimeSettlementRevision();
		await browser.forward();

		await expectKeptOnHome("Redirected", settlementRevision);
	});

	it("should handle multiple back/forward cycles", async () => {
		await browserBackToHome();

		// Forward to Protected (still logged in)
		const settlementRevision = await getRuntimeSettlementRevision();
		await browser.forward();
		await waitForPage(CONTROLS.protected.protectedPage, "Protected Page", { afterRevision: settlementRevision });
		await waitForRuntimeSettlement(
			{ status: "Committed", route: "protected", hash: "protected" },
			{ afterRevision: settlementRevision },
		);
		await expectHashToBe("#/protected");

		await browserBackToHome();
	});
});
