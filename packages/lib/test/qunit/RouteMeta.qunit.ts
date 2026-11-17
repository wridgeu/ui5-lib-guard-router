import RouteMetaStore, { EMPTY_META } from "ui5/guard/router/RouteMeta";

const ROUTES = [
	{ name: "home", pattern: "" },
	{ name: "employees", pattern: "employees" },
	{ name: "employee", pattern: "employees/{id}" },
	{ name: "resume", pattern: "employees/{id}/resume" },
];

function manifest(entries: Record<string, Record<string, unknown>>): Map<string, Readonly<Record<string, unknown>>> {
	return new Map(Object.entries(entries).map(([name, meta]) => [name, Object.freeze(meta)]));
}

QUnit.module("RouteMeta - without inheritance");

QUnit.test("returns the manifest metadata itself, or the empty metadata", function (assert) {
	const meta = manifest({ home: { title: "Home" } });
	const store = new RouteMetaStore(meta, null);
	assert.strictEqual(store.get("home"), meta.get("home"));
	assert.strictEqual(store.get("employees"), EMPTY_META);
	assert.strictEqual(Object.isFrozen(EMPTY_META), true);
});

QUnit.test("runtime metadata is merged over the manifest metadata", function (assert) {
	const store = new RouteMetaStore(manifest({ home: { title: "Home", icon: "h" } }), null);
	store.set("home", { title: "Start" });
	store.set("employees", { title: "Staff" });
	assert.deepEqual(store.get("home"), { title: "Start", icon: "h" });
	assert.strictEqual(Object.isFrozen(store.get("home")), true);
	assert.deepEqual(store.get("employees"), { title: "Staff" });
});

QUnit.test("an empty object resolves to the empty metadata", function (assert) {
	const store = new RouteMetaStore(manifest({}), null);
	store.set("home", {});
	assert.strictEqual(store.get("home"), EMPTY_META);
});

QUnit.test("set copies and freezes, and replaces the cached value", function (assert) {
	const store = new RouteMetaStore(manifest({}), null);
	const meta = { title: "A" };
	store.set("home", meta);
	const first = store.get("home");
	assert.notStrictEqual(first, meta, "a copy");
	assert.strictEqual(store.get("home"), first, "cached");
	store.set("home", { title: "B" });
	assert.deepEqual(store.get("home"), { title: "B" });
});

QUnit.module("RouteMeta - pattern-tree inheritance");

QUnit.test("merges ancestors shallowest-first, manifest then runtime at each level", function (assert) {
	const store = new RouteMetaStore(
		manifest({
			home: { level: "home", root: true },
			employees: { level: "employees", section: "staff" },
			resume: { level: "resume" },
		}),
		() => ROUTES,
	);
	store.set("employees", { level: "employees-runtime", tab: "list" });
	store.set("employee", { level: "employee" });
	assert.deepEqual(store.get("resume"), {
		root: true,
		section: "staff",
		tab: "list",
		level: "resume",
	});
	assert.deepEqual(store.get("employee"), { root: true, section: "staff", tab: "list", level: "employee" });
});

QUnit.test("merges by pattern depth, not by the order routes are declared in", function (assert) {
	const store = new RouteMetaStore(
		manifest({ employee: { level: "employee" }, employees: { level: "employees" }, home: { level: "home" } }),
		() => ROUTES.toReversed(),
	);
	assert.deepEqual(store.get("resume"), { level: "employee" });
});

QUnit.test("a route without a pattern only sees its own metadata", function (assert) {
	const store = new RouteMetaStore(manifest({ home: { root: true }, loose: { own: 1 } }), () => ROUTES);
	assert.deepEqual(store.get("loose"), { own: 1 });
	assert.strictEqual(store.get("nothing"), EMPTY_META);
});

QUnit.test("caches results until invalidated", function (assert) {
	let routes = ROUTES.slice(0, 2);
	let lookups = 0;
	const store = new RouteMetaStore(manifest({ employees: { section: "staff" } }), () => {
		lookups++;
		return routes;
	});
	assert.strictEqual(store.get("employee"), EMPTY_META, "not a known route yet");
	assert.strictEqual(store.get("employee"), EMPTY_META);
	assert.strictEqual(lookups, 1, "cached");
	routes = ROUTES;
	store.invalidate();
	assert.deepEqual(store.get("employee"), { section: "staff" });
	assert.strictEqual(lookups, 2);
});

QUnit.test("clear drops manifest and runtime metadata", function (assert) {
	const store = new RouteMetaStore(manifest({ home: { a: 1 } }), null);
	store.set("employees", { b: 2 });
	store.get("home");
	store.clear();
	assert.strictEqual(store.get("home"), EMPTY_META);
	assert.strictEqual(store.get("employees"), EMPTY_META);
});
