import { waitForPage, resetAuth } from "./helpers";

describe("Basic routing (no guard interaction)", () => {
	it("should load Home view at root hash with default auth state", async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();
		await waitForPage("container-demo.app---homeView--homePage", "Home");

		const status = await browser.asControl({
			selector: { id: "container-demo.app---homeView--authStatus" },
		});
		expect(await status.getProperty("text")).toBe("Logged Out");
	});
});
