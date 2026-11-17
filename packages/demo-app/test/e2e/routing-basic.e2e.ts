import { CONTROLS, selectorFor } from "../shared/controls";
import { waitForPage, resetAuth } from "./helpers";

describe("Basic routing (no guard interaction)", () => {
	it("should load Home view at root hash with default auth state", async () => {
		await browser.url("#");
		await resetAuth();
		await waitForPage(CONTROLS.home.homePage, "Home");

		const status = await browser.asControl(selectorFor(CONTROLS.home.authStatus));
		expect(await status.getProperty("text")).toBe("Logged Out");
	});
});
