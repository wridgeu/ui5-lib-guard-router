/**
 * Pattern-tree helpers: compare UI5 route patterns by their mandatory path segments.
 */

/** Matches a standalone optional (`:param:`) or rest (`:param*:`) segment. */
const OPTIONAL_OR_REST_SEGMENT = /^:[^:]*\*?:$/;

/**
 * Strips inline query and optional-query suffixes from a segment.
 *
 * UI5 (crossroads.js) allows query parameters to attach directly to a
 * path segment without a `/` separator:
 * - `product{?query}`  → mandatory query on `product`
 * - `product:?query:`  → optional query on `product`
 * - `{id}{?query}`     → mandatory param + mandatory query
 *
 * For pattern-tree ancestry we only care about the path portion,
 * so these suffixes are stripped.
 */
function stripInlineQuery(seg: string): string {
	// Strip mandatory query `{?...}` suffix
	const mqIdx = seg.indexOf("{?");
	if (mqIdx !== -1) return seg.slice(0, mqIdx);
	// Strip optional query `:?...:` suffix
	const oqIdx = seg.indexOf(":?");
	if (oqIdx !== -1) return seg.slice(0, oqIdx);
	return seg;
}

/**
 * Extract mandatory path segments from a UI5 route pattern.
 *
 * Splits on `/`, strips inline query suffixes, then drops empty segments,
 * standalone optional (`:param:`), and rest (`:param*:`) segments.
 */
export function patternSegments(pattern: string): string[] {
	return pattern
		.split("/")
		.map(stripInlineQuery)
		.filter((seg) => seg !== "" && !OPTIONAL_OR_REST_SEGMENT.test(seg));
}

/**
 * Check if `ancestorPattern` is a URL-tree ancestor of `candidatePattern`.
 *
 * Both patterns are reduced to their mandatory path segments and compared
 * positionally. Mandatory parameter segments (`{paramA}`, `{paramB}`) are
 * treated as equivalent regardless of name, so `employees/{empId}` is
 * recognized as an ancestor of `employees/{id}/resume`.
 */
export function isPatternAncestor(ancestorPattern: string, candidatePattern: string): boolean {
	if (ancestorPattern === "") return true;
	const ancestorSegments = patternSegments(ancestorPattern);
	if (ancestorSegments.length === 0) return false;
	const candidateSegments = patternSegments(candidatePattern);
	if (candidateSegments.length <= ancestorSegments.length) return false;
	return ancestorSegments.every((seg, i) => {
		const candidateSeg = candidateSegments[i];
		if (seg === candidateSeg) return true;
		// Treat any two mandatory parameter segments as equivalent
		return seg.startsWith("{") && candidateSeg.startsWith("{");
	});
}

/** A route name with its pattern. */
export interface RoutePattern {
	readonly name: string;
	readonly pattern: string;
}

/** Number of mandatory segments in the pattern of `route` (0 when unknown). */
function depthOf(route: string, patternByName: ReadonlyMap<string, string>): number {
	return patternSegments(patternByName.get(route) ?? "").length;
}

/**
 * Entries ordered by the pattern depth of their own route, declaration order within one depth.
 * Expanding them in this order puts an ancestor's entries before a descendant's on every route.
 */
function byRouteDepth<T extends { readonly route: string }>(
	entries: T[],
	patternByName: ReadonlyMap<string, string>,
): T[] {
	return entries.toSorted((a, b) => depthOf(a.route, patternByName) - depthOf(b.route, patternByName));
}

/**
 * Copy each route-specific entry to every descendant route (`inheritance: "pattern-tree"`).
 * Global (`"*"`) entries and entries for routes without a known pattern are kept as-is.
 * Ordered by the pattern depth of the route an entry was declared for, so on every route
 * ancestor guards run before descendant guards, whatever the declaration order. Where global
 * entries end up does not matter: the pipeline runs global guards separately.
 * A route named `"*"` does not pass its entries on, because a `"*"` entry is a global one.
 */
export function expandToDescendants<T extends { readonly route: string }>(entries: T[], routes: RoutePattern[]): T[] {
	if (routes.length === 0) return entries;
	const patternByName = new Map(routes.map((r) => [r.name, r.pattern]));

	const expanded: T[] = [];
	for (const entry of byRouteDepth(entries, patternByName)) {
		expanded.push(entry);
		if (entry.route === "*") continue;
		const ancestorPattern = patternByName.get(entry.route);
		if (ancestorPattern === undefined) continue;
		for (const { name, pattern } of routes) {
			if (name !== entry.route && isPatternAncestor(ancestorPattern, pattern)) {
				expanded.push({ ...entry, route: name });
			}
		}
	}

	return expanded;
}

/**
 * Entries a newly added route inherits (`inheritance: "pattern-tree"`): copies of its
 * ancestors' entries for the new route, and copies of its own entries for its existing
 * descendants. `routes` must include the new route. Ordered like {@link expandToDescendants}.
 */
export function expandForNewRoute<T extends { readonly route: string }>(
	entries: T[],
	newName: string,
	routes: RoutePattern[],
): T[] {
	const patternByName = new Map(routes.map((r) => [r.name, r.pattern]));
	const newPattern = patternByName.get(newName);
	if (newPattern === undefined) return [];

	const result: T[] = [];
	for (const entry of byRouteDepth(entries, patternByName)) {
		if (entry.route === "*") continue;
		if (entry.route !== newName) {
			const ancestorPattern = patternByName.get(entry.route);
			if (ancestorPattern !== undefined && isPatternAncestor(ancestorPattern, newPattern)) {
				result.push({ ...entry, route: newName });
			}
		} else {
			for (const { name, pattern } of routes) {
				if (name !== newName && isPatternAncestor(newPattern, pattern)) {
					result.push({ ...entry, route: name });
				}
			}
		}
	}

	return result;
}
