import { CONTROLS, press } from "../shared/controls";
import { getRuntimeSettlementRevision } from "../shared/models";
import { expectHashToBe, waitForPage, waitForRuntimeSettlement } from "./helpers/wait";
import { startAtHome, toggleLogin, expectKeptOnHome } from "./helpers/scenarios";

describe("Guard allows navigation when logged in", () => {
	it("should allow navigation to Protected after login", async () => {
		await startAtHome();
		await toggleLogin("Logged In");

		const settlementRevision = await getRuntimeSettlementRevision();
		await press(CONTROLS.home.navProtectedBtn);

		// The hash is only written once the async guard allowed the navigation.
		await waitForPage(CONTROLS.protected.protectedPage, "Protected Page", { afterRevision: settlementRevision });
		await waitForRuntimeSettlement(
			{ status: "Committed", route: "protected", hash: "protected" },
			{ afterRevision: settlementRevision },
		);
		await expectHashToBe("#/protected");
	});
});

describe("Guard blocks enter navigation", () => {
	it("should stay on Home and report Blocked when navigating to Blocked", async () => {
		await startAtHome();

		const settlementRevision = await getRuntimeSettlementRevision();
		await press(CONTROLS.home.navBlockedBtn);

		await expectKeptOnHome("Blocked", settlementRevision);
	});
});

describe("Guard redirects to Home", () => {
	it("should redirect from Forbidden to Home", async () => {
		await startAtHome();

		const settlementRevision = await getRuntimeSettlementRevision();
		await press(CONTROLS.home.navForbiddenBtn);

		await expectKeptOnHome("Redirected", settlementRevision);
	});
});

describe("Guard redirects unauthenticated navigation", () => {
	it("should redirect to Home when navigating to Protected while logged out", async () => {
		// Asserts "Logged Out" on Home.
		await startAtHome();

		const settlementRevision = await getRuntimeSettlementRevision();
		await press(CONTROLS.home.navProtectedBtn);

		// The async permission guard redirects.
		await expectKeptOnHome("Redirected", settlementRevision);
	});
});
