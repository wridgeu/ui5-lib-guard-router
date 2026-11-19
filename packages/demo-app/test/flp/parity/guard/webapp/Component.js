sap.ui.define(
	["sap/ui/core/UIComponent", "sap/m/Page"],
	(
		/** @type {typeof import("sap/ui/core/UIComponent").default} */ UIComponent,
		/** @type {typeof import("sap/m/Page").default} */ Page,
	) => {
		"use strict";

		/**
		 * An app with routing and the guard router and no guards, for flp-native-parity.e2e.ts. The test compares
		 * it with ../../native, which differs in the router class of the manifest only. `trace` is
		 * what the router did.
		 */
		return UIComponent.extend("demo.parity.guard.Component", {
			metadata: {
				manifest: "json",
				interfaces: ["sap.ui.core.IAsyncContentCreation"],
			},

			/** @this {import("sap/ui/core/UIComponent").default & { trace: string[] }} */
			init() {
				UIComponent.prototype.init.call(this);
				this.trace = [];
				const router = this.getRouter();
				for (const id of ["beforeRouteMatched", "routeMatched", "routePatternMatched", "bypassed"]) {
					router.attachEvent(
						id,
						(
							/** @type {import("sap/ui/base/Event").default<{ name?: string, hash?: string, arguments?: object }>} */ event,
						) => {
							const { name, hash, arguments: routeArguments } = event.getParameters();
							this.trace.push(`${id} ${name ?? hash} ${JSON.stringify(routeArguments ?? {})}`);
						},
					);
				}
				router.initialize();
			},

			createContent() {
				return new Page({ title: "Parity App" });
			},
		});
	},
);
