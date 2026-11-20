import { CONTROLS, getAppComponentId } from "../shared/controls";
import { waitForPage } from "./helpers/wait";

describe("BaseController", () => {
	it("should throw when getModel is asked for a model that is not set", async () => {
		await waitForPage(CONTROLS.home.homePage, "Home");
		const message = await browser.execute(
			(componentId: string) => {
				const Component = sap.ui.require("sap/ui/core/Component");
				const BaseController = sap.ui.require("demo/app/controller/BaseController");
				const JSONModel = sap.ui.require("sap/ui/model/json/JSONModel");
				const controller = Component.getComponentById(componentId).byId("homeView")?.getController();
				if (!(controller instanceof BaseController)) return "(not a BaseController)";
				try {
					// getModel is protected, which the bracket access gets past.
					controller["getModel"]("missing", JSONModel);
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
