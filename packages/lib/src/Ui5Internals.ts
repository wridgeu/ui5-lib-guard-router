/**
 * Adapters for the UI5 internals and loosely-typed UI5 APIs that {@link Router}
 * relies on. Keeping them in one module makes upstream parity audits and UI5
 * upgrades easy to review (see `docs/reference/upstream-parity.md`).
 */
import coreLibrary from "sap/ui/core/library";
import type MobileRouter from "sap/m/routing/Router";
import type { HashChangerBase$HashChangedEvent } from "sap/ui/core/routing/HashChangerBase";
import type History from "sap/ui/core/routing/History";

const HistoryDirection = coreLibrary.routing.HistoryDirection;

export type Direction = ReturnType<History["getDirection"]>;

/**
 * The router config as UI5 gets it: the caller's object without `guardRouter`. It is a view and
 * not a copy, because `UIComponent` adds `targetParent` (the ID of the root view) to its config
 * object after it has constructed the router, and the native router reads it from that object.
 */
export function withoutGuardRouter(config: object): object {
	const hidden = (key: PropertyKey): boolean => key === "guardRouter";
	return new Proxy(config, {
		get: (target, key, receiver): unknown => (hidden(key) ? undefined : Reflect.get(target, key, receiver)),
		has: (target, key) => !hidden(key) && Reflect.has(target, key),
		ownKeys: (target) => Reflect.ownKeys(target).filter((key) => !hidden(key)),
		getOwnPropertyDescriptor: (target, key) =>
			hidden(key) ? undefined : Reflect.getOwnPropertyDescriptor(target, key),
	});
}

/**
 * Report a navigation that waits for async guards as a route match in progress, through the
 * UI5-private member `_bMatchingProcessStarted` of `sap.ui.core.routing.Router`. UI5 reads it
 * to tell whether the router of a nested component is still matching; without this, a parent
 * route would count the component as displayed before its first route matched. The router does
 * not write the member: this replaces it with an accessor that forwards what UI5 writes to
 * `onNativeChange` and reads `isMatching()`.
 */
export function mirrorMatchingProcess(
	router: object,
	isMatching: () => boolean,
	onNativeChange: (matching: boolean) => void,
): void {
	Object.defineProperty(router, "_bMatchingProcessStarted", {
		get: isMatching,
		set: onNativeChange,
	});
}

/** How this engine prints the resolve function of a Promise: `function () { [native code] }` in V8. */
let resolverSource!: string;
void new Promise((resolve) => {
	resolverSource = Function.prototype.toString.call(resolve);
});

/**
 * Whether `value` looks exactly like the resolve function of a native Promise: a function with
 * the name `""`, the length `1` and the source text that this engine prints for such a function.
 * `Router#attachRouteMatched` needs this to recognize a UI5 component target that waits for the
 * router. A function written in JavaScript never matches; other anonymous built-ins with one
 * parameter do, above all the reject function of a Promise.
 */
export function isPromiseResolver(value: unknown): value is () => void {
	return (
		typeof value === "function" &&
		value.name === "" &&
		value.length === 1 &&
		Function.prototype.toString.call(value) === resolverSource
	);
}

/** Read `newHash` from a UI5 `hashChanged` event (`@openui5/types` declares it as `object | undefined`). */
export function readEventHash(event: HashChangerBase$HashChangedEvent): string | null {
	const newHash: unknown = event.getParameter("newHash");
	return typeof newHash === "string" ? newHash : null;
}

/** Entry in UI5's `Router#getTitleHistory()`, which `@openui5/types` types as `any[]`. */
export interface TitleHistoryEntry {
	readonly hash: string;
	readonly title?: string;
	readonly isHome?: boolean;
}

export function isTitleHistoryEntry(value: unknown): value is TitleHistoryEntry {
	return (
		typeof value === "object" &&
		value !== null &&
		"hash" in value &&
		typeof value.hash === "string" &&
		(!("title" in value) || value.title === undefined || typeof value.title === "string") &&
		(!("isHome" in value) || value.isHome === undefined || typeof value.isHome === "boolean")
	);
}

/**
 * Leave the title history of UI5 (`getTitleHistory()`) as after the native equivalent of a
 * redirected hash change: the hash change, then `navTo(target, ..., true)`. The route of the
 * hash change never matched, so UI5 has not handled its title:
 * - A new entry or a step forward would have added a title, which the title of the target
 *   replaces: UI5 must not remove the title of the route before it.
 * - A step back to a titled route would have removed the title of the route that was left, so
 *   that a titled target replaces the entry the step arrived at and an untitled target leaves
 *   that entry in place until the next titled route: remove the left entry here under UI5's
 *   condition for a step back when the arrived hash has an entry in the title history.
 */
export function alignTitleHistory(
	router: MobileRouter,
	direction: Direction | undefined,
	attemptedHash?: string,
): void {
	if (direction === HistoryDirection.NewEntry || direction === HistoryDirection.Forwards) {
		Reflect.set(router, "_bLastHashReplaced", false);
	} else if (direction === HistoryDirection.Backwards) {
		const titles: unknown[] = router.getTitleHistory();
		const left = titles.at(-1);
		const arrived =
			attemptedHash === undefined
				? titles.at(-2)
				: titles.findLast((entry) => isTitleHistoryEntry(entry) && entry.hash === attemptedHash);
		if (isTitleHistoryEntry(left) && isTitleHistoryEntry(arrived) && !left.isHome && left.title !== arrived.title) {
			titles.pop();
		}
	}
}
