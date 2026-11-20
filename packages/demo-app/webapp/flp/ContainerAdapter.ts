import type Container from "sap/ushell/Container";
import type DirtyState from "sap/ushell/navigation/DirtyState";

type DirtyStateProvider = Parameters<typeof DirtyState.registerDirtyStateProvider>[0];

// Probe instead of import: standalone runs on OpenUI5, which has no sap.ushell.
function getContainer(): typeof Container | undefined {
	return sap.ui.require("sap/ushell/Container") as typeof Container | undefined;
}

export function hasUshellContainer(): boolean {
	return getContainer() !== undefined;
}

/** Registers with DirtyState (SAPUI5 1.146+), which the launchpad's sap/ushell/Container has loaded. */
export function registerDirtyStateProvider(provider: DirtyStateProvider): (() => void) | null {
	const dirtyState = sap.ui.require("sap/ushell/navigation/DirtyState") as typeof DirtyState | undefined;
	if (!dirtyState) {
		return null;
	}

	dirtyState.registerDirtyStateProvider(provider);

	return (): void => {
		dirtyState.deregisterDirtyStateProvider(provider);
	};
}
