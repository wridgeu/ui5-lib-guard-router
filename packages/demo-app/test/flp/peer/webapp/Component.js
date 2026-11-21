sap.ui.define(["sap/ui/core/UIComponent"], (UIComponent) => {
	"use strict";

	/**
	 * A second app in the launchpad of the E2E tests: a target for cross-app navigation that,
	 * unlike the launchpad home, keeps the demo app alive.
	 */
	return UIComponent.extend("demo.peer.Component", {
		metadata: {
			manifest: "json",
			interfaces: ["sap.ui.core.IAsyncContentCreation"],
		},
	});
});
