import {
	expectHashToBe,
	fireEvent,
	getHistoryLength,
	getRuntimeSettlementRevision,
	resetAuth,
	waitForPage,
	waitForRuntimeSettlement,
} from "./helpers";

describe("navTo preflight - history guarantees", () => {
	beforeEach(async () => {
		await resetAuth();
		await browser.url("#");
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});

	it("programmatic navTo to blocked route should not increase history length", async () => {
		const before = await getHistoryLength();
		const rev = await getRuntimeSettlementRevision();

		await fireEvent("container-demo.app---homeView--navBlockedBtn", "press");

		await waitForRuntimeSettlement({ status: "Blocked", route: "home" }, { afterRevision: rev });
		await expectHashToBe("");

		const after = await getHistoryLength();
		expect(after).toBe(before);
	});

	it("programmatic navTo to redirect route should not increase history length", async () => {
		const before = await getHistoryLength();
		const rev = await getRuntimeSettlementRevision();

		await fireEvent("container-demo.app---homeView--navForbiddenBtn", "press");

		await waitForRuntimeSettlement({ status: "Redirected", route: "home" }, { afterRevision: rev });
		await expectHashToBe("");

		const after = await getHistoryLength();
		expect(after).toBe(before);
	});

	it("programmatic navTo to protected route when logged out should not increase history length", async () => {
		const before = await getHistoryLength();
		const rev = await getRuntimeSettlementRevision();

		await fireEvent("container-demo.app---homeView--navProtectedBtn", "press");

		await waitForRuntimeSettlement({ status: "Redirected", route: "home" }, { afterRevision: rev });
		await expectHashToBe("");

		const after = await getHistoryLength();
		expect(after).toBe(before);
	});

	it("programmatic navTo to allowed route should increase history length by 1", async () => {
		// Log in first
		await fireEvent("container-demo.app---homeView--toggleLoginBtn", "press");

		const before = await getHistoryLength();
		const rev = await getRuntimeSettlementRevision();

		await fireEvent("container-demo.app---homeView--navProtectedBtn", "press");

		await waitForPage("container-demo.app---protectedView--protectedPage", "Protected Page", {
			afterRevision: rev,
		});
		await waitForRuntimeSettlement({ status: "Committed", route: "protected" }, { afterRevision: rev });

		const after = await getHistoryLength();
		expect(after).toBe(before + 1);
	});
});
