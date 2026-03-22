import {
	expectHashToBe,
	fireEvent,
	getRuntimeSettlementRevision,
	resetAuth,
	waitForPage,
	waitForRuntimeSettlement,
} from "./helpers";

describe("Redirect chain: admin -> protected -> home", () => {
	beforeEach(async () => {
		await browser.url("#");
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});

	it("should follow the full chain when logged out (admin -> protected -> home)", async () => {
		await resetAuth();

		const rev = await getRuntimeSettlementRevision();
		await fireEvent("container-demo.app---homeView--navAdminBtn", "press");

		// Admin guard redirects to protected, protected's async auth guard
		// checks login state (logged out) and redirects to home.
		// The entire chain settles as Redirected on home.
		await waitForRuntimeSettlement({ status: "Redirected", route: "home" }, { afterRevision: rev, timeout: 5000 });
		await expectHashToBe("");
	});

	it("should stop at protected when logged in (admin -> protected)", async () => {
		// Log in first
		await fireEvent("container-demo.app---homeView--toggleLoginBtn", "press");

		const rev = await getRuntimeSettlementRevision();
		await fireEvent("container-demo.app---homeView--navAdminBtn", "press");

		// Admin guard redirects to protected, protected's auth guard allows
		// because user is logged in. Chain stops at protected.
		await waitForRuntimeSettlement(
			{ status: "Redirected", route: "protected" },
			{ afterRevision: rev, timeout: 5000 },
		);
		await expectHashToBe("#/protected");
	});
});
