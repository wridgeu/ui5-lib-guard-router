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

/**
 * Tracks whether the FLP dirty-state provider was called for the current
 * navigation. Set by the dirty provider callback when the form is dirty;
 * auto-cleared on the next microtask (after the synchronous guard chain
 * completes). This lets the leave guard distinguish a genuine FLP
 * cross-app navigation (provider fired) from an invalid in-app hash
 * (provider not called).
 */
let _flpDirtyNavPending = false;

export function markFlpDirtyNavPending(): void {
	_flpDirtyNavPending = true;
	setTimeout(() => {
		_flpDirtyNavPending = false;
	}, 0);
}

export function isFlpDirtyNavPending(): boolean {
	return _flpDirtyNavPending;
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
