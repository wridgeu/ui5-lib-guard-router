import UIComponent from "sap/ui/core/UIComponent";
import type { RouterInstance } from "ui5/ext/routing/types";

/**
 * @namespace demo.app
 */
export default class Component extends UIComponent {
	public static metadata = {
		manifest: "json",
		interfaces: ["sap.ui.core.IAsyncContentCreation"]
	};

	init(): void {
		super.init();

		const router = this.getRouter() as unknown as RouterInstance;

		router.addRouteGuard("protected", () => {
			const isLoggedIn = this.getModel("auth")?.getProperty("/isLoggedIn");
			return isLoggedIn ? true : "home";
		});

		router.addRouteGuard("forbidden", () => "home");

		router.initialize();
	}
}
