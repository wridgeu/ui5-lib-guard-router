import Log from "sap/base/Log";
import { isRecord, parseGuardRouterConfig, type ResolvedGuardRouterOptions } from "ui5/guard/router/GuardConfig";
import { logMessages, type SinonTestContext } from "../testHelpers";

const DEFAULTS: ResolvedGuardRouterOptions = {
	unknownRouteRegistration: "warn",
	navToPreflight: "guard",
	guardLoading: "lazy",
	inheritance: "none",
};

QUnit.module("GuardConfig - isRecord");

QUnit.test("accepts plain objects only", function (assert) {
	assert.strictEqual(isRecord({}), true);
	assert.strictEqual(isRecord(Object.create(null)), true);
	assert.strictEqual(isRecord(null), false);
	assert.strictEqual(isRecord(undefined), false);
	assert.strictEqual(isRecord([]), false);
	assert.strictEqual(isRecord("x"), false);
	assert.strictEqual(isRecord(new Date()), false);
	assert.strictEqual(isRecord(new Map()), false);
});

QUnit.module("GuardConfig - options");

QUnit.test("missing config uses the defaults without a warning", function (this: SinonTestContext, assert) {
	const warning = this.stub(Log, "warning");
	assert.deepEqual(parseGuardRouterConfig(undefined, ""), { options: DEFAULTS, routeMeta: new Map(), guards: [] });
	assert.strictEqual(warning.callCount, 0);
});

QUnit.test("a config that is not a plain object uses the defaults", function (this: SinonTestContext, assert) {
	const warning = this.stub(Log, "warning");
	for (const raw of [null, "lazy", [], new Date()]) {
		assert.deepEqual(parseGuardRouterConfig(raw, ""), { options: DEFAULTS, routeMeta: new Map(), guards: [] });
	}
	assert.deepEqual(logMessages(warning), Array(4).fill("guardRouter config is not a plain object, using defaults"));
});

QUnit.test("valid options are applied", function (this: SinonTestContext, assert) {
	const warning = this.stub(Log, "warning");
	const options = {
		unknownRouteRegistration: "throw",
		navToPreflight: "off",
		guardLoading: "block",
		inheritance: "pattern-tree",
	};
	assert.deepEqual(parseGuardRouterConfig(Object.assign(Object.create(null), options), "").options, options);
	assert.strictEqual(warning.callCount, 0);
});

QUnit.test("each invalid option falls back to its default", function (this: SinonTestContext, assert) {
	const warning = this.stub(Log, "warning");
	const { options } = parseGuardRouterConfig(
		{ unknownRouteRegistration: "x", navToPreflight: 1, guardLoading: "eager", inheritance: true },
		"",
	);
	assert.deepEqual(options, DEFAULTS);
	assert.deepEqual(logMessages(warning), [
		"guardRouter.unknownRouteRegistration has invalid value, using default",
		"guardRouter.navToPreflight has invalid value, using default",
		"guardRouter.guardLoading has invalid value, using default",
		"guardRouter.inheritance has invalid value, using default",
	]);
});

QUnit.module("GuardConfig - routeMeta");

QUnit.test("keeps a frozen copy per route and skips invalid entries", function (this: SinonTestContext, assert) {
	const warning = this.stub(Log, "warning");
	const home = { title: "Home" };
	const { routeMeta } = parseGuardRouterConfig({ routeMeta: { home, bad: "x" } }, "");
	assert.deepEqual([...routeMeta.keys()], ["home"]);
	assert.deepEqual(routeMeta.get("home"), home);
	assert.notStrictEqual(routeMeta.get("home"), home, "a copy");
	assert.strictEqual(Object.isFrozen(routeMeta.get("home")), true);
	assert.deepEqual(logMessages(warning), ['guardRouter.routeMeta["bad"]: expected object, skipping']);
});

QUnit.test("a routeMeta block that is not an object is skipped", function (this: SinonTestContext, assert) {
	const warning = this.stub(Log, "warning");
	assert.strictEqual(parseGuardRouterConfig({ routeMeta: [] }, "").routeMeta.size, 0);
	assert.deepEqual(logMessages(warning), ["guardRouter.routeMeta: expected object, skipping"]);
});

QUnit.module("GuardConfig - guards");

QUnit.test("module paths resolve against the component namespace", function (this: SinonTestContext, assert) {
	this.stub(Log, "warning");
	const guards = {
		"*": ["guards.auth", "module:shared.lib.guard", "module:shared/lib/other", "guards.multi#check#2"],
	};
	assert.deepEqual(parseGuardRouterConfig({ guards }, "my.app").guards, [
		{ route: "*", type: "enter", modulePath: "my/app/guards/auth", exportKey: undefined },
		{ route: "*", type: "enter", modulePath: "shared/lib/guard", exportKey: undefined },
		{ route: "*", type: "enter", modulePath: "shared/lib/other", exportKey: undefined },
		{ route: "*", type: "enter", modulePath: "my/app/guards/multi", exportKey: "check#2" },
	]);
	assert.deepEqual(parseGuardRouterConfig({ guards: { home: ["guards.auth#"] } }, "").guards, [
		{ route: "home", type: "enter", modulePath: "guards/auth", exportKey: "" },
	]);
});

QUnit.test("route entries in shorthand and object form", function (this: SinonTestContext, assert) {
	const warning = this.stub(Log, "warning");
	const info = this.stub(Log, "info");
	const guards = { home: ["g.a"], detail: { enter: ["g.b"], leave: ["g.c"] }, edit: { leave: ["g.d"] } };
	assert.deepEqual(parseGuardRouterConfig({ guards }, "").guards, [
		{ route: "home", type: "enter", modulePath: "g/a", exportKey: undefined },
		{ route: "detail", type: "enter", modulePath: "g/b", exportKey: undefined },
		{ route: "detail", type: "leave", modulePath: "g/c", exportKey: undefined },
		{ route: "edit", type: "leave", modulePath: "g/d", exportKey: undefined },
	]);
	assert.strictEqual(warning.callCount, 0);
	assert.strictEqual(info.callCount, 0);
});

QUnit.test('the "*" object form keeps enter guards and drops leave guards', function (this: SinonTestContext, assert) {
	const warning = this.stub(Log, "warning");
	const info = this.stub(Log, "info");
	assert.deepEqual(parseGuardRouterConfig({ guards: { "*": { enter: ["g.a"], leave: ["g.b"] } } }, "").guards, [
		{ route: "*", type: "enter", modulePath: "g/a", exportKey: undefined },
	]);
	assert.deepEqual(parseGuardRouterConfig({ guards: { "*": { leave: ["g.b"] } } }, "").guards, []);
	assert.deepEqual(parseGuardRouterConfig({ guards: { "*": { enter: ["g.a"] } } }, "").guards.length, 1);
	assert.deepEqual(logMessages(warning), [
		'guardRouter.guards["*"].leave: global leave guards are not supported, skipping',
		'guardRouter.guards["*"].leave: global leave guards are not supported, skipping',
	]);
	assert.deepEqual(logMessages(info), [
		'guardRouter.guards["*"]: object form; treating enter as global',
		'guardRouter.guards["*"]: object form; treating enter as global',
	]);
});

QUnit.test("invalid entries are skipped with a warning", function (this: SinonTestContext, assert) {
	const warning = this.stub(Log, "warning");
	const guards = { home: ["", 1, "g.a"], detail: { enter: [null], leave: [""] }, bad: "g.b" };
	assert.deepEqual(parseGuardRouterConfig({ guards }, "").guards, [
		{ route: "home", type: "enter", modulePath: "g/a", exportKey: undefined },
	]);
	assert.deepEqual(logMessages(warning), [
		'guardRouter.guards["home"]: invalid entry, skipping',
		'guardRouter.guards["home"]: invalid entry, skipping',
		'guardRouter.guards["detail"].enter: invalid entry, skipping',
		'guardRouter.guards["detail"].leave: invalid entry, skipping',
		'guardRouter.guards["bad"]: expected string[] or { enter?, leave? }, skipping',
	]);
});

QUnit.test("a guards block that is not an object is skipped", function (this: SinonTestContext, assert) {
	const warning = this.stub(Log, "warning");
	assert.deepEqual(parseGuardRouterConfig({ guards: ["g.a"] }, "").guards, []);
	assert.deepEqual(logMessages(warning), ["guardRouter.guards is not a plain object, skipping"]);
});
