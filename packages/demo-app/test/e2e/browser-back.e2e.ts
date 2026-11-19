import { CONTROLS } from "../shared/controls";
import { getRuntimeSettlementRevision } from "../shared/models";
import { expectHashToBe, waitForPage, waitForRuntimeSettlement } from "./helpers/wait";
import { expectKeptOnHome, loginAndGoToProtected, startAtHome, toggleLogin } from "./helpers/scenarios";

/** On Protected: go back in the browser history and assert that the navigation to Home committed. */
async function browserBackToHome(): Promise<void> {
	const settlementRevision = await getRuntimeSettlementRevision();
	await browser.back();

	await waitForPage(CONTROLS.home.homePage, "Home", { afterRevision: settlementRevision });
	await waitForRuntimeSettlement(
		{ status: "committed", route: "home", hash: "" },
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

	it("should re-evaluate the enter guard on browser forward after logout", async () => {
		await browserBackToHome();
		await toggleLogin("Logged Out");

		// Browser forward (toward previously visited #/protected)
		const settlementRevision = await getRuntimeSettlementRevision();
		await browser.forward();

		await expectKeptOnHome("redirected", settlementRevision);
	});

	it("should handle multiple back/forward cycles", async () => {
		await browserBackToHome();

		// Forward to Protected (still logged in)
		const settlementRevision = await getRuntimeSettlementRevision();
		await browser.forward();
		await waitForPage(CONTROLS.protected.protectedPage, "Protected Page", { afterRevision: settlementRevision });
		await waitForRuntimeSettlement(
			{ status: "committed", route: "protected", hash: "protected" },
			{ afterRevision: settlementRevision },
		);
		await expectHashToBe("#/protected");

		await browserBackToHome();
	});
});
