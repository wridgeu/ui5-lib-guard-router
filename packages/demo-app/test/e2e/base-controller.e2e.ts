import { CONTROLS, getAppComponentId } from "../shared/controls";
import { waitForPage } from "./helpers/wait";

describe("BaseController", () => {
	it("should throw when getModel is asked for a model that is not set", async () => {
		await waitForPage(CONTROLS.home.homePage, "Home");
		const message = await browser.execute(
			(componentId: string) => {
				const Component = sap.ui.require("sap/ui/core/Component");
				const controller = Component.getComponentById(componentId).byId("homeView")?.getController();
				if (!controller) {
					throw new Error('View "homeView" has no controller');
				}
				// getModel is protected: read it from the instance of the real Home controller.
				const getModel: unknown = Reflect.get(controller, "getModel");
				if (typeof getModel !== "function") {
					throw new Error("The Home controller has no getModel method");
				}
				try {
					getModel.call(controller, "missing");
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
