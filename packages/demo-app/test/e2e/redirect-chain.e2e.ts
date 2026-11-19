import type BaseLog from "sap/base/Log";
import { CONTROLS, press } from "../shared/controls";
import { getRuntimeSettlementRevision } from "../shared/models";
import { expectHashToBe, waitForPage, waitForRuntimeSettlement } from "./helpers/wait";
import { expectKeptOnHome, startAtHome, toggleLogin } from "./helpers/scenarios";

describe("Redirect chain: admin -> protected -> home", () => {
	beforeEach(async () => {
		await startAtHome();
	});

	it("should follow the full chain when logged out (admin -> protected -> home)", async () => {
		// The guards of the demo log what they decide.
		const logged = await browser.execute((): number => {
			const Log: typeof BaseLog = sap.ui.require("sap/base/Log");
			Log.setLevel(Log.Level.INFO, "demo.app.guards");
			return Log.getLogEntries().length;
		});
		const rev = await getRuntimeSettlementRevision();
		await press(CONTROLS.home.navAdminBtn);

		// Admin guard redirects to protected, protected's async auth guard
		// checks login state (logged out) and redirects to home.
		// The entire chain settles as Redirected on home.
		await expectKeptOnHome("Redirected", rev, 5000);

		// A redirect from admin straight to home would settle the same: the guard of the hop
		// in between has to have run.
		const messages = await browser.execute((from: number): string[] => {
			const Log: typeof BaseLog = sap.ui.require("sap/base/Log");
			return Log.getLogEntries()
				.slice(from)
				.filter((entry) => entry.component === "demo.app.guards")
				.map((entry) => entry.message);
		}, logged);
		expect(messages).toContain('Async permission check completed for "protected": denied');
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
