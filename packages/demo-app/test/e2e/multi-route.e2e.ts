import { CONTROLS, press } from "../shared/controls";
import {
	expectHashToBe,
	fireEvent,
	getRuntimeSettlementRevision,
	loginAndGoToProtected,
	startAtHome,
	toggleLogin,
	waitForPage,
	waitForRuntimeSettlement,
} from "./helpers";

/** On Protected: press the Page nav button and assert that the navigation to Home committed. */
async function navBackToHome(): Promise<void> {
	const settlementRevision = await getRuntimeSettlementRevision();
	await fireEvent(CONTROLS.protected.protectedPage, "navButtonPress");

	await waitForPage(CONTROLS.home.homePage, "Home", { afterRevision: settlementRevision });
	await expectHashToBe("");
}

/**
 * On Home: press a navigation button whose guard redirects to Home. Home and the empty
 * hash are also the starting state, so the fresh settlement is what proves the redirect.
 */
async function pressAndExpectRedirectHome(button: "navProtectedBtn" | "navForbiddenBtn"): Promise<void> {
	const settlementRevision = await getRuntimeSettlementRevision();
	await press(CONTROLS.home[button]);

	await waitForRuntimeSettlement(
		{ status: "Redirected", route: "home", hash: "(empty hash)" },
		{ afterRevision: settlementRevision },
	);
	await expectHashToBe("", "Hash should settle to home after guard redirect");
	await waitForPage(CONTROLS.home.homePage, "Home");
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
