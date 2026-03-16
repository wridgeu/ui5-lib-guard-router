import type Event from "sap/ui/base/Event";
import HashChanger from "sap/ui/core/routing/HashChanger";

function normalizeHash(hash: string): string {
	return hash.replace(/^#\/?/, "");
}

export function getCurrentHash(): string {
	const hash = HashChanger.getInstance().getHash();
	return hash ? `#/${hash}` : "";
}

export function setHash(hash: string): void {
	HashChanger.getInstance().setHash(normalizeHash(hash));
}

export function runHashSequence(hashes: string[], stepDelayMs = 25): void {
	hashes.forEach((hash, index) => {
		setTimeout(() => {
			setHash(hash);
		}, index * stepDelayMs);
	});
}

export function attachHashChanged(onChange: () => void): () => void {
	const hashChanger = HashChanger.getInstance();
	const handler = (_event: Event): void => {
		onChange();
	};

	hashChanger.attachEvent("hashChanged", handler);

	return (): void => {
		hashChanger.detachEvent("hashChanged", handler);
	};
}
