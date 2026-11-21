import HashChanger from "sap/ui/core/routing/HashChanger";

function normalizeHash(hash: string): string {
	return hash.replace(/^#\/?/, "");
}

export function getCurrentHash(): string {
	const hash = HashChanger.getInstance().getHash();
	return hash ? `#/${hash}` : "";
}

// The global hash changer on purpose: like a URL typed into the address bar, it replaces the whole hash, also the part of a nested component.
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
