import { CONTROLS, press } from "../shared/controls";
import { getRuntimeSettlementRevision } from "../shared/models";
import {
	expectHashToBe,
	expectKeptOnHome,
	startAtHome,
	toggleLogin,
	waitForPage,
	waitForRuntimeSettlement,
} from "./helpers";

describe("Redirect chain: admin -> protected -> home", () => {
	beforeEach(async () => {
		await startAtHome();
	});

	it("should follow the full chain when logged out (admin -> protected -> home)", async () => {
		const rev = await getRuntimeSettlementRevision();
		await press(CONTROLS.home.navAdminBtn);

		// Admin guard redirects to protected, protected's async auth guard
		// checks login state (logged out) and redirects to home.
		// The entire chain settles as Redirected on home.
		await expectKeptOnHome("Redirected", rev, 5000);
	});

	it("should stop at protected when logged in (admin -> protected)", async () => {
		await toggleLogin("Logged In");

		const rev = await getRuntimeSettlementRevision();
		await press(CONTROLS.home.navAdminBtn);

		// Admin guard redirects to protected, protected's auth guard allows
		// because user is logged in. Chain stops at protected.
		await waitForRuntimeSettlement(
			{ status: "Redirected", route: "protected", hash: "protected" },
			{ afterRevision: rev, timeout: 5000 },
		);
		await expectHashToBe("#/protected");
		await waitForPage(CONTROLS.protected.protectedPage, "Protected Page");
	});
});
