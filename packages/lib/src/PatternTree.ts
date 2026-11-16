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
