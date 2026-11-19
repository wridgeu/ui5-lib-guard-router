sap.ui.define(
	["sap/ui/core/UIComponent", "sap/m/Page"],
	(
		/** @type {typeof import("sap/ui/core/UIComponent").default} */ UIComponent,
		/** @type {typeof import("sap/m/Page").default} */ Page,
	) => {
		"use strict";

		/**
		 * A second app in the FLP sandbox of the E2E tests: a target for cross-app navigation that,
		 * unlike the launchpad home, keeps the demo app alive.
		 */
		return UIComponent.extend("demo.peer.Component", {
			metadata: {
				manifest: "json",
				interfaces: ["sap.ui.core.IAsyncContentCreation"],
			},

			createContent() {
				return new Page({ title: "Peer App" });
			},
		});
	},
);
