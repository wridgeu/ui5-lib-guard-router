import { CONTROLS } from "../shared/controls";
import {
	expectHashToBe,
	getRuntimeSettlementRevision,
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

		// Home and the empty hash are also the state before the forward navigation: the
		// settlement after `settlementRevision` proves that the guard ran and redirected.
		await waitForRuntimeSettlement(
			{ status: "Redirected", route: "home", hash: "" },
			{ afterRevision: settlementRevision },
		);
		await expectHashToBe("", "Hash should settle to home after guard redirect");
		await waitForPage(CONTROLS.home.homePage, "Home");
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
