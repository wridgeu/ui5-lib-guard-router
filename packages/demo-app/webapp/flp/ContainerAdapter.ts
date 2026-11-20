import type DirtyState from "sap/ushell/navigation/DirtyState";

type DirtyStateProvider = Parameters<typeof DirtyState.registerDirtyStateProvider>[0];

/**
 * Types for the synchronous `sap.ui.require(name)`, which UI5 declares as `any`. The demo probes
 * instead of importing: standalone runs on OpenUI5, which has no sap.ushell. Inside the launchpad
 * sap/ushell/Container has loaded DirtyState.
 */
declare global {
	namespace sap {
		namespace ui {
			function require(name: "sap/ushell/navigation/DirtyState"): typeof DirtyState | undefined;
		}
	}
}

export function hasUshellContainer(): boolean {
	return sap.ui.require("sap/ushell/Container") !== undefined;
}

/** Registers with DirtyState (SAPUI5 1.146+). */
export function registerDirtyStateProvider(provider: DirtyStateProvider): (() => void) | null {
	const dirtyState = sap.ui.require("sap/ushell/navigation/DirtyState");
	if (!dirtyState) {
		return null;
	}

	dirtyState.registerDirtyStateProvider(provider);

	return (): void => {
		dirtyState.deregisterDirtyStateProvider(provider);
	};
}
