import { CONTROLS, expectControlText } from "../shared/controls";
import {
	expectHashToBe,
	getRuntimeSettlementRevision,
	setBrowserHash,
	startAtHome,
	toggleLogin,
	waitForPage,
	waitForRuntimeSettlement,
} from "./helpers";

/**
 * Assert that the hash change made after `afterRevision` did not leave Home: the guard
 * settled it with `status` and the router restored the empty hash. Home and the empty
 * hash are also the starting state, so the fresh settlement is what proves the outcome.
 */
async function expectKeptOnHome(status: "Redirected" | "Blocked", afterRevision: number): Promise<void> {
	await waitForRuntimeSettlement({ status, route: "home", hash: "" }, { afterRevision });
	await expectHashToBe("", "Hash should be restored to home");
	await waitForPage(CONTROLS.home.homePage, "Home");
}

describe("Direct URL navigation with guards", () => {
	beforeEach(async () => {
		await startAtHome();
	});

	it("should redirect to Home when accessing #/protected directly while logged out", async () => {
		const settlementRevision = await getRuntimeSettlementRevision();

		await setBrowserHash("#/protected");

		await expectKeptOnHome("Redirected", settlementRevision);
	});

	it("should redirect to Home when accessing #/forbidden directly", async () => {
		const settlementRevision = await getRuntimeSettlementRevision();

		await setBrowserHash("#/forbidden");

		await expectKeptOnHome("Redirected", settlementRevision);
	});

	it("should stay on Home and report Blocked when accessing #/blocked directly", async () => {
		const settlementRevision = await getRuntimeSettlementRevision();

		await setBrowserHash("#/blocked");

		await expectKeptOnHome("Blocked", settlementRevision);
	});

	it("should load Protected page when accessing #/protected directly while logged in", async () => {
		await toggleLogin("Logged In");
		const settlementRevision = await getRuntimeSettlementRevision();

		await setBrowserHash("#/protected");

		await waitForPage(CONTROLS.protected.protectedPage, "Protected Page", { afterRevision: settlementRevision });
		await waitForRuntimeSettlement(
			{ status: "Committed", route: "protected", hash: "protected" },
			{ afterRevision: settlementRevision },
		);
		await expectHashToBe("#/protected");
	});

	it("should show Not Found page for a nonexistent route hash", async () => {
		const settlementRevision = await getRuntimeSettlementRevision();

		await setBrowserHash("#/this/does/not/exist");

		await waitForPage(CONTROLS.notFound.notFoundPage, "Not Found", { afterRevision: settlementRevision });
		await expectHashToBe("#/this/does/not/exist");
		await expectControlText(CONTROLS.notFound.settlementStatus, "Bypassed");
		await expectControlText(CONTROLS.notFound.settlementRouteText, "(no match)");
		await expectControlText(CONTROLS.notFound.settlementHashText, "this/does/not/exist");

		// Verify the app recovers by navigating back to a known route
		const recoveryRevision = await getRuntimeSettlementRevision();
		await setBrowserHash("#/");
		await waitForPage(CONTROLS.home.homePage, "Home", { afterRevision: recoveryRevision });
		await waitForRuntimeSettlement(
			{ status: "Committed", route: "home", hash: "" },
			{ afterRevision: recoveryRevision },
		);
	});

	it("should handle rapid hash changes in the address bar", async () => {
		const settlementRevision = await getRuntimeSettlementRevision();

		// Rapidly change the hash multiple times
		await setBrowserHash("#/protected");
		await setBrowserHash("#/forbidden");
		await setBrowserHash("#/protected");

		// All three are guarded while logged out. waitForPage first waits for the pending
		// guard pipeline of the last hash, so the settlement read below is the final one.
		await waitForPage(CONTROLS.home.homePage, "Home");
		await waitForRuntimeSettlement(
			{ status: "Redirected", route: "home", hash: "" },
			{ afterRevision: settlementRevision },
		);
		await expectHashToBe("", "Hash should not stay on a guarded route");
	});
});
