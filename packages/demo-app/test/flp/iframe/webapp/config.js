// The launchpad services that need no backend, as in the preview of the demo, and the site of this folder.
window["sap-ushell-config"] = {
	defaultRenderer: "fiori2",
	renderers: {
		fiori2: {
			componentData: {
				config: {
					enableSearch: false,
					rootIntent: "Shell-home",
				},
			},
		},
	},
	ushell: {
		customPreload: { enabled: false },
	},
	services: {
		CommonDataModel: {
			adapter: {
				config: {
					ignoreSiteDataPersonalization: true,
					siteDataUrl: "site.json",
				},
			},
		},
		Personalization: {
			adapter: {
				module: "sap.ushell.adapters.local.PersonalizationAdapter",
				config: { storageType: "MEMORY" },
			},
		},
		PersonalizationV2: {
			adapter: {
				module: "sap.ushell.adapters.local.PersonalizationAdapter",
				config: { storageType: "MEMORY" },
			},
		},
		AppState: {
			adapter: { module: "sap.ushell.adapters.local.AppStateAdapter" },
			config: { transient: true },
		},
		NavTargetResolutionInternal: {
			config: { enableClientSideTargetResolution: true },
			adapter: { module: "sap.ushell.adapters.local.NavTargetResolutionInternalAdapter" },
		},
		UserInfo: {
			adapter: { module: "sap.ushell.adapters.local.UserInfoAdapter" },
		},
		FlpLaunchPage: {
			adapter: { module: "sap.ushell.adapters.cdm.v3.FlpLaunchPageAdapter" },
		},
	},
};
