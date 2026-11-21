/**
 * Mermaid wraps a label line it measures at or above its wrapping width, and some browsers then draw the wrapped
 * label unwrapped and clip it. Lines that fit with room to spare are never wrapped.
 * The widths, measured with the Mermaid of the repo: a flowchart node `flowchart.wrappingWidth` (120px without it),
 * an edge label 200px, a state diagram transition 200px.
 * A character takes at most about 10px in the 16px labels, also in Verdana, the wide fallback of the Mermaid font.
 */
const PX_PER_CHAR = 10;
const EDGE_WIDTH = 200;
const NODE_WIDTH = 120;
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
/** A flowchart edge label: `-- "label" -->`, `-. "label" .->`, `== "label" ==>` or `-->|"label"|`. */
const EDGE_LABEL = /(?:-[-.]|==)\s*"([^"\n]*)"|\|"([^"\n]*)"\|/g;

/**
 * The diagram without its front matter: a `config:` block may precede the diagram type.
 *
 * @param {string} diagram
 */
function diagramBody(diagram) {
	return diagram.replace(FRONT_MATTER, "");
}

/**
 * Whether the diagram is a flowchart (`flowchart` or its older keyword `graph`).
 *
 * @param {string} diagram
 */
export function isFlowchart(diagram) {
	return /^\s*(?:flowchart|graph)\b/.test(diagramBody(diagram));
}

/**
 * The label lines of a flowchart or state diagram that are too long to stay unwrapped.
 *
 * @param {string} diagram
 * @returns {string[]}
 */
export function longLabelLines(diagram) {
	const config = diagram.match(FRONT_MATTER)?.[1] ?? "";
	const body = diagramBody(diagram);
	/** @type {[string, number][]} label and its wrapping width */
	const labels = [];
	if (isFlowchart(diagram)) {
		const nodeWidth = Number(config.match(/wrappingWidth:\s*(\d+)/)?.[1] ?? NODE_WIDTH);
		for (const [, dashed, piped] of body.matchAll(EDGE_LABEL)) labels.push([dashed ?? piped, EDGE_WIDTH]);
		// A subgraph title is not wrapped.
		const nodes = body.replace(EDGE_LABEL, "").replace(/^\s*subgraph .*$/gm, "");
		for (const [, label] of nodes.matchAll(/"([^"\n]*)"/g)) labels.push([label, nodeWidth]);
	} else if (/^\s*stateDiagram/.test(body)) {
		for (const [, label] of body.matchAll(/-->[^:\n]*:(.*)$/gm)) labels.push([label.trim(), EDGE_WIDTH]);
	}
	return labels.flatMap(([label, width]) =>
		label
			.split(/<br\s*\/?>/)
			.filter((line) => line.replace(/#\d+;/g, "#").length > width / PX_PER_CHAR)
			.map((line) => `"${line}" is longer than ${width / PX_PER_CHAR} characters`),
	);
}
