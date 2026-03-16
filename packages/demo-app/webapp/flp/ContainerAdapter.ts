type FlpNavigationContext = {
	isCrossAppNavigation?: boolean;
};

export type FlpDirtyStateProvider = (navigationContext?: FlpNavigationContext) => boolean;

type FlpContainer = {
	registerDirtyStateProvider?: (provider: FlpDirtyStateProvider) => void;
	deregisterDirtyStateProvider?: (provider: FlpDirtyStateProvider) => void;
};

type FlpGlobal = typeof globalThis & {
	sap?: {
		ushell?: {
			Container?: FlpContainer;
		};
	};
};

function getContainer(): FlpContainer | null {
	return (globalThis as FlpGlobal).sap?.ushell?.Container ?? null;
}

export function hasUshellContainer(): boolean {
	return getContainer() !== null;
}

export function registerDirtyStateProvider(provider: FlpDirtyStateProvider): (() => void) | null {
	const container = getContainer();
	if (!container?.registerDirtyStateProvider || !container?.deregisterDirtyStateProvider) {
		return null;
	}

	container.registerDirtyStateProvider(provider);

	return (): void => {
		container.deregisterDirtyStateProvider?.(provider);
	};
}
