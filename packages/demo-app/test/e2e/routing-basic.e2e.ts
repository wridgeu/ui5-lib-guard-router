import { CONTROLS, expectControlText } from "../shared/controls";
import { waitForPage } from "./helpers";

describe("Basic routing (no guard interaction)", () => {
	it("should load Home view at root hash with default auth state", async () => {
		// wdi5 has just loaded the base URL in a fresh session. The test neither navigates
		// nor resets a model, so every assertion describes what the app shows on load.
		expect(new URL(await browser.getUrl()).hash).toBe("");
		await waitForPage(CONTROLS.home.homePage, "Home");
		await expectControlText(CONTROLS.home.authStatus, "Logged Out");
		await expectControlText(CONTROLS.home.launchModeText, "Standalone");
	});
});
