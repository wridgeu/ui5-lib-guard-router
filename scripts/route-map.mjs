/**
 * @typedef {{ name: string, pattern: string }} Route
 * @typedef {{ routes: Route[], bypassed: boolean, guards: Record<string, string[] | { enter?: string[], leave?: string[] }> }} Routing
 */

/** A route node: `rId["name<br/>pattern → target"]`; the pattern of the empty hash reads `(empty)`. */
const ROUTE_NODE = /\b(\w+)\["([^"]*)"\]/g;
/** A guard node: `gId("text")`. */
const GUARD_NODE = /\b(\w+)\("([^"]*)"\)/g;
/** A link from a route node to a guard node: `rId[...] -.- gId(`. */
const GUARD_LINK = /\b(\w+)(?:\["[^"]*"\])? -\.- (\w+)\(/g;

/**
 * The differences between a route map (a Mermaid flowchart in the demo README) and the routing of a manifest:
 * every route with its pattern, the bypassed node, and every manifest guard on the node of its route.
 *
 * @param {string} diagram
 * @param {Routing} routing
 * @returns {string[]}
 */
export function routeMapErrors(diagram, routing) {
	const errors = [];
	/** @type {Map<string, { id: string, pattern: string }>} */
	const nodes = new Map();
	let bypassed = false;
	for (const [, id, label] of diagram.matchAll(ROUTE_NODE)) {
		const [title, second = ""] = label.split("<br/>");
		const name = title.split(",")[0];
		if (name === "bypassed") bypassed = true;
		else nodes.set(name, { id, pattern: second.split(/ →|,/)[0].replace("(empty)", "") });
	}
	for (const { name, pattern } of routing.routes) {
		const node = nodes.get(name);
		if (!node) errors.push(`route ${name} is missing`);
		else if (node.pattern !== pattern)
			errors.push(`route ${name} shows the pattern "${node.pattern}", not "${pattern}"`);
	}
	for (const name of nodes.keys()) {
		if (!routing.routes.some((route) => route.name === name)) errors.push(`route ${name} is not in the manifest`);
	}
	if (bypassed !== routing.bypassed)
		errors.push(bypassed ? "shows a bypassed node the manifest lacks" : "the bypassed node is missing");

	const guardText = new Map([...diagram.matchAll(GUARD_NODE)].map(([, id, text]) => [id, text]));
	const linked = [...diagram.matchAll(GUARD_LINK)].map(([, routeId, guardId]) => ({ routeId, guardId }));
	for (const [route, config] of Object.entries(routing.guards)) {
		const modules = Array.isArray(config) ? config : [...(config.enter ?? []), ...(config.leave ?? [])];
		for (const module of modules) {
			const name = module.split(".").at(-1) ?? module;
			const onRoute =
				route === "*"
					? [...guardText.values()].some((text) => text.includes(name) && text.includes("global"))
					: linked.some(
							({ routeId, guardId }) =>
								routeId === nodes.get(route)?.id && guardText.get(guardId)?.includes(name),
						);
			if (!onRoute) errors.push(`guard ${name} of route ${route} is missing on its route`);
		}
	}
	return errors;
}
