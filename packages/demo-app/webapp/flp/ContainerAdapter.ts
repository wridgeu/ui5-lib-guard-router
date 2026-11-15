import type Container from "sap/ushell/Container";

type DirtyStateProvider = Parameters<typeof Container.registerDirtyStateProvider>[0];

// Probe instead of import: standalone runs on OpenUI5, which has no sap.ushell.
function getContainer(): typeof Container | undefined {
	return sap.ui.require("sap/ushell/Container");
}

export function hasUshellContainer(): boolean {
	return getContainer() !== undefined;
}

export function registerDirtyStateProvider(provider: DirtyStateProvider): (() => void) | null {
	const container = getContainer();
	if (!container) {
		return null;
	}

	container.registerDirtyStateProvider(provider);

	return (): void => {
		container.deregisterDirtyStateProvider(provider);
	};
}
