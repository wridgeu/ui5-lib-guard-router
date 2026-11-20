import type BaseController from "../../webapp/controller/BaseController";
import { CONTROLS, getAppComponentId } from "../shared/controls";
import { waitForPage } from "./helpers/wait";

describe("BaseController", () => {
	it("should throw when getModel is asked for a model that is not set", async () => {
		await waitForPage(CONTROLS.home.homePage, "Home");
		const message = await browser.execute(
			(componentId: string) => {
				const Component = sap.ui.require("sap/ui/core/Component");
				const controller = Component.getComponentById(componentId).byId("homeView")?.getController();
				try {
					// getModel is protected, which the bracket access gets past.
					(controller as BaseController)["getModel"]("missing");
				} catch (error) {
					return error instanceof Error ? error.message : String(error);
				}
				return "(no error thrown)";
			},
			await getAppComponentId(),
		);

		expect(message).toBe('Model "missing" is not available');
	});
});
