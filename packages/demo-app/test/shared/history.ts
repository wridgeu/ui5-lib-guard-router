/** Browser history reads shared by the standalone and FLP suites. */

/**
 * Return current window.history.length from the browser. Chrome caps it at 50 entries:
 * at the cap a new entry no longer changes the length, so the comparison would prove nothing.
 */
export async function getHistoryLength(): Promise<number> {
	const length = await browser.execute(() => window.history.length);
	if (length >= 50) {
		throw new Error(`window.history.length is ${length}: at the browser cap, new entries cannot be observed`);
	}
	return length;
}

/** The position of the current entry in the browser history. */
export function getHistoryEntryIndex(): Promise<number> {
	return browser.execute(() => window.navigation.currentEntry?.index ?? -1);
}
