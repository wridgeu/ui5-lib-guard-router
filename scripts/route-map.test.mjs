import assert from "node:assert/strict";
import { test } from "node:test";
import { routeMapErrors } from "./route-map.mjs";

const MAP = `flowchart LR
    gLogger("✓ logger, global:<br/>logs")
    rHome["home<br/>(empty) → Home"] -.- gHome("✓ homeGuard: allows")
    rEdit["edit<br/>edit/{id} → Edit"] -.- gDirty("✕ dirtyGuard, leave")
    rOld["old, never matches<br/>edit/{id} → target"] ~~~ rTeam["team<br/>team, no target"]
    rNone["bypassed<br/>no match → NotFound"]
`;
const ROUTING = {
	routes: [
		{ name: "home", pattern: "" },
		{ name: "edit", pattern: "edit/{id}" },
		{ name: "old", pattern: "edit/{id}" },
		{ name: "team", pattern: "team" },
	],
	bypassed: true,
	guards: { "*": ["guards.logger"], home: ["guards.homeGuard"], edit: { leave: ["guards.dirtyGuard"] } },
};

await test("a map that shows every route, pattern and manifest guard has no error", () => {
	assert.deepEqual(routeMapErrors(MAP, ROUTING), []);
});

await test("a route missing from the map or from the manifest is reported", () => {
	assert.deepEqual(
		routeMapErrors(MAP, { ...ROUTING, routes: [...ROUTING.routes, { name: "new", pattern: "new" }] }),
		["route new is missing"],
	);
	assert.deepEqual(routeMapErrors(MAP, { ...ROUTING, routes: ROUTING.routes.slice(0, 3) }), [
		"route team is not in the manifest",
	]);
});

await test("a pattern other than the manifest's is reported", () => {
	const routes = ROUTING.routes.map((route) => (route.name === "team" ? { ...route, pattern: "crew" } : route));
	assert.deepEqual(routeMapErrors(MAP, { ...ROUTING, routes }), ['route team shows the pattern "team", not "crew"']);
	const empty = ROUTING.routes.map((route) => (route.name === "home" ? { ...route, pattern: "start" } : route));
	assert.deepEqual(routeMapErrors(MAP, { ...ROUTING, routes: empty }), [
		'route home shows the pattern "", not "start"',
	]);
});

await test("a bypassed node is shown exactly when the manifest has one", () => {
	assert.deepEqual(routeMapErrors(MAP, { ...ROUTING, bypassed: false }), [
		"shows a bypassed node the manifest lacks",
	]);
	assert.deepEqual(routeMapErrors(MAP.replace(/ *rNone.*\n/, ""), ROUTING), ["the bypassed node is missing"]);
});

await test("a manifest guard must be on the node of its route, a global one marked global", () => {
	const moved = { ...ROUTING, guards: { ...ROUTING.guards, home: [], team: ["guards.homeGuard"] } };
	assert.deepEqual(routeMapErrors(MAP, moved), ["guard homeGuard of route team is missing on its route"]);
	assert.deepEqual(routeMapErrors(MAP.replace("global", "all"), ROUTING), [
		"guard logger of route * is missing on its route",
	]);
	const enter = { ...ROUTING, guards: { ...ROUTING.guards, edit: { enter: ["guards.authGuard"] } } };
	assert.deepEqual(routeMapErrors(MAP, enter), ["guard authGuard of route edit is missing on its route"]);
	const leave = { ...ROUTING, guards: { ...ROUTING.guards, edit: { leave: ["guards.formGuard"] } } };
	assert.deepEqual(routeMapErrors(MAP, leave), ["guard formGuard of route edit is missing on its route"]);
});
