/**
 * Browser history traversal tracking and cross-router undo coordination.
 *
 * Uses the Navigation API (`window.navigation`) when available to record how far
 * a history step moved before UI5 learns of the hash change, and ensures at most
 * one router on the page steps back when multiple routers refuse the same step.
 */

/** A step through the browser history (back, forward): how far it went, and the URL it arrived at. */
export interface HistoryStep {
	readonly offset: number;
	readonly href: string;
}

/** What it takes to undo the hash change that an uncommitted navigation arrived with. */
export interface HashChangeUndo {
	/** The hash of the root hash changer after the first change that this takes back. */
	readonly first: string;
	/**
	 * The hash of the root hash changer before that change, with the hashes of nested routers.
	 * The root hash changer reports it with the change, after the routers have parsed their part.
	 */
	fullHash: string | undefined;
	/** The hash of the root hash changer after the change. */
	readonly shown: string;
	/** Whether the router has started to put the URL back, and the hash change that does it is still to come. */
	started: boolean;
	/** The step through the browser history that the change was, if it was one. */
	readonly step: HistoryStep | null;
}

/** The step through the browser history that brought the browser to the URL it shows, if a step did. */
let lastStep: HistoryStep | null = null;
/** The URL of a step that a router is taking back, until the browser reports the next URL change. */
let undoneHref: string | null = null;

// The Navigation API tells how far a step through the history went, before UI5 learns of the
// hash change. UI5's History only infers it, and wrongly once an entry lacks its state. Without
// the API (Firefox before 147, Safari before 26.2) no step is known and the entry is replaced.
window.navigation?.addEventListener("currententrychange", (event) => {
	const href = window.location.href;
	if (undoneHref !== href) undoneHref = null;
	const entry = window.navigation.currentEntry;
	if (entry && event.navigationType === "traverse") {
		lastStep = { offset: entry.index - event.from.index, href };
	} else if (lastStep?.href !== href) {
		// Not an entry whose state alone is replaced, as UI5's History does after a step.
		lastStep = null;
	}
});

/** Return the current history step if it matches the current URL and has not already been consumed by the caller. */
export function getUnconsumedStep(consumed: HistoryStep | null): HistoryStep | null {
	return lastStep && lastStep.href === window.location.href && lastStep !== consumed ? lastStep : null;
}

/**
 * Create a {@link HashChangeUndo} for a newly reported root hash `shown`.
 * When superseding a `pending` undo, keep the original `first`/`fullHash` and combine the
 * step offsets so a single undo takes back both changes (or drops `step` if they cancel out).
 */
export function composeHashChangeUndo(
	pending: HashChangeUndo | null,
	shown: string,
	step: HistoryStep | null,
): HashChangeUndo {
	if (!pending) return { first: shown, fullHash: undefined, shown, step, started: false };
	const offset = pending.step && step ? pending.step.offset + step.offset : 0;
	return {
		first: pending.first,
		fullHash: pending.fullHash,
		shown,
		step: step && offset ? { offset, href: step.href } : null,
		started: false,
	};
}

/**
 * Take back a browser history step once across all routers on the page.
 * If another router is already taking back the step from the current URL, do nothing and wait.
 */
export function undoHistoryStep(step: HistoryStep): void {
	const href = window.location.href;
	if (undoneHref === href) return;
	undoneHref = href;
	window.history.go(-step.offset);
}
