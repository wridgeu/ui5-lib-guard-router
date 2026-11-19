import { CONTROLS, getAppComponentId } from "../shared/controls";
import { getHistoryEntryIndex } from "../shared/history";
import { getRuntimeSettlementRevision } from "../shared/models";
import { loginAndGoToProtected, resetAuth, startAtHome } from "./helpers/scenarios";
import { expectHashToBe, waitForPage, waitForRuntimeSettlement } from "./helpers/wait";

/** Add an enter guard of "protected" that never answers, behind the permission check of the demo app. */
async function holdProtected(): Promise<void> {
	await browser.execute(
		(componentId: string) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			Component.getComponentById(componentId)
				.getRouter()
				.addRouteGuard("protected", () => new Promise<boolean>(() => {}));
		},
		await getAppComponentId(),
	);
}

/** `navTo()` to the nested component with a route of it: UI5 writes the hash once the component is loaded. */
async function navToSalesReport(): Promise<void> {
	await browser.execute(
		(componentId: string) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			Component.getComponentById(componentId)
				.getRouter()
				.navTo("reports", {}, { reports: { route: "sales" } });
		},
		await getAppComponentId(),
	);
}

/**
 * A `navTo()` with component targets waits for UI5 to write its hash, for as long as the nested
 * component loads, and until the next navigation if the load fails. Isolated spec file: the load of the nested
 * component fails here, and UI5 does not load a failed module again.
 */
describe("Browser history while a navTo() waits for its hash (isolated session)", () => {
	it("should take back only the last step after a step back to the committed hash ended an earlier hash change", async () => {
		await startAtHome();
		await loginAndGoToProtected();
		let revision = await getRuntimeSettlementRevision();
		await browser.back();
		await waitForRuntimeSettlement({ status: "committed", route: "home", hash: "" }, { afterRevision: revision });
		const homeEntry = await getHistoryEntryIndex();

		// The nested component fails to load.
		await browser.sendCommand("Network.enable", {});
		await browser.sendCommand("Network.setBlockedURLs", { urls: ["*/reporting/Component.js"] });

		// A hash change that an async guard holds: the URL shows a hash that is not committed.
		await holdProtected();
		revision = await getRuntimeSettlementRevision();
		await browser.forward();
		await expectHashToBe("#/protected");

		// An allowed navTo() supersedes it and waits for its hash, which UI5 never writes.
		await navToSalesReport();
		await waitForRuntimeSettlement({ status: "cancelled", route: "home", hash: "" }, { afterRevision: revision });
		await expectHashToBe("#/protected");

		// Back to the committed hash: the hash change of the first step is undone by the user.
		await browser.back();
		await expectHashToBe("");
		expect(await getHistoryEntryIndex()).toBe(homeEntry);

		// Logged out, the permission check redirects a step forward to Home: that step is taken
		// back alone, not together with the step that is undone already.
		await resetAuth();
		revision = await getRuntimeSettlementRevision();
		await browser.forward();
		await waitForRuntimeSettlement({ status: "redirected", route: "home", hash: "" }, { afterRevision: revision });
		await expectHashToBe("");
		expect(await getHistoryEntryIndex()).toBe(homeEntry);
		await waitForPage(CONTROLS.home.homePage, "Home");
	});
});
