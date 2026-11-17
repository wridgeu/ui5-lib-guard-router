import { CONTROLS, selectorFor } from "../shared/controls";
import {
	getRuntimeSettlementRevision,
	waitForPage,
	resetAuth,
	expectHashToBe,
	waitForRuntimeSettlement,
} from "./helpers";

describe("Browser back navigation with guards", () => {
	it("should handle back navigation cleanly after login flow", async () => {
		await browser.url("#");
		await resetAuth();

		// Login
		const toggleBtn = await browser.asControl(selectorFor(CONTROLS.home.toggleLoginBtn));
		await toggleBtn.press();

		// Navigate to Protected
		const navBtn = await browser.asControl(selectorFor(CONTROLS.home.navProtectedBtn));
		await navBtn.press();

		// Wait for view - confirms async guard completed
		await waitForPage(CONTROLS.protected.protectedPage, "Protected Page");

		// Browser back
		await browser.back();

		// Should be on Home
		await waitForPage(CONTROLS.home.homePage, "Home");
	});

	it("should not show protected page on browser back after logout", async () => {
		await browser.url("#");
		await resetAuth();

		// Login
		let toggleBtn = await browser.asControl(selectorFor(CONTROLS.home.toggleLoginBtn));
		await toggleBtn.press();

		// Navigate to Protected
		const navBtn = await browser.asControl(selectorFor(CONTROLS.home.navProtectedBtn));
		await navBtn.press();
		// Wait for view - confirms async guard completed
		await waitForPage(CONTROLS.protected.protectedPage, "Protected Page");

		// Navigate back to Home
		await browser.back();
		await waitForPage(CONTROLS.home.homePage, "Home");

		// Logout (re-retrieve control with forceSelect after navigation)
		toggleBtn = await browser.asControl(selectorFor(CONTROLS.home.toggleLoginBtn));
		await toggleBtn.press();

		// Verify logged out
		const status = await browser.asControl(selectorFor(CONTROLS.home.authStatus));
		expect(await status.getProperty("text")).toBe("Logged Out");

		// Try browser forward (toward previously visited #/protected)
		const settlementRevision = await getRuntimeSettlementRevision();
		await browser.execute(() => window.history.forward());

		// Guard should block: wait for hash to settle back to home
		await expectHashToBe("", {
			timeoutMsg: "Hash should settle to home after guard redirect",
			afterRevision: settlementRevision,
		});
		await waitForPage(CONTROLS.home.homePage, "Home", { afterRevision: settlementRevision });

		const settlement = await waitForRuntimeSettlement(
			{
				status: "Redirected",
				route: "home",
				hash: "(empty hash)",
			},
			{ afterRevision: settlementRevision },
		);
		expect(settlement.route).toBe("home");
		expect(settlement.hash).toBe("(empty hash)");
	});

	it("should handle multiple back/forward cycles", async () => {
		await browser.url("#");
		await resetAuth();

		// Login
		const toggleBtn = await browser.asControl(selectorFor(CONTROLS.home.toggleLoginBtn));
		await toggleBtn.press();

		// Navigate Home → Protected
		const navBtn = await browser.asControl(selectorFor(CONTROLS.home.navProtectedBtn));
		await navBtn.press();
		// Wait for view - confirms async guard completed
		await waitForPage(CONTROLS.protected.protectedPage, "Protected Page");

		// Back to Home
		await browser.back();
		await waitForPage(CONTROLS.home.homePage, "Home");

		// Forward to Protected (still logged in)
		await browser.execute(() => window.history.forward());
		// Wait for view - confirms async guard completed
		await waitForPage(CONTROLS.protected.protectedPage, "Protected Page");

		// Back to Home again
		await browser.back();
		await waitForPage(CONTROLS.home.homePage, "Home");
	});
});
