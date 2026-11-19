import Component from "sap/ui/core/Component";
import ComponentContainer from "sap/ui/core/ComponentContainer";
import UIComponent from "sap/ui/core/UIComponent";
import HashChanger from "sap/ui/core/routing/HashChanger";
import NavigationOutcome from "ui5/guard/router/NavigationOutcome";
import type { GuardContext, GuardFn, GuardResult, GuardRouter } from "ui5/guard/router/types";
import {
	captureHashWrites,
	captureWarnings,
	flushPromises,
	getComponentRouter,
	initHashChanger,
	getHash,
	loadModule,
	recordHashChanges,
	recordSettlements,
	waitForRoute,
} from "../../testHelpers";

// ============================================================
// Module: Manifest-driven router instantiation
// ============================================================
QUnit.module("Router - Manifest-driven instantiation");

QUnit.test("UIComponent creates router with manifest-provided guardRouter options", async function (assert: Assert) {
	const component = await Component.create({
		name: "ui5.guard.router.qunit.fixtures.manifest",
	});

	try {
		const manifestRouter = getComponentRouter(component);
		// Each option of the fixture differs from its default.
		const warnings = captureWarnings(() => {
			manifestRouter.addRouteGuard("totallyUnknownRoute", () => true);
		});
		assert.deepEqual(
			warnings.filter((w) => w.message.includes("unknown route")),
			[],
			"unknownRouteRegistration 'ignore': an unknown route is not warned about",
		);

		initHashChanger();
		manifestRouter.initialize();
		assert.notOk(manifestRouter.isInitialized(), "guardLoading 'block': the start waits for the guard modules");
		await waitForRoute(manifestRouter, "home");

		const recorder = recordHashChanges();
		manifestRouter.navTo("protected");
		const result = await manifestRouter.navigationSettled();
		recorder.stop();

		assert.strictEqual(
			result.status,
			NavigationOutcome.Blocked,
			"the guard, declared relative to the component's sap.app.id, blocks",
		);
		// The restored hash is reported first: the router restores it while the hash change is dispatched.
		assert.deepEqual(
			recorder.hashes,
			["", "protected"],
			"navToPreflight 'off': the hash changed before the guard blocked it",
		);
	} finally {
		component.destroy();
	}
});

QUnit.test("guard context exposes the owner component, including on redirect hops", async function (assert: Assert) {
	initHashChanger();
	const component = await Component.create({
		name: "ui5.guard.router.qunit.fixtures.manifest",
	});

	try {
		const manifestRouter = getComponentRouter(component);
		const contexts: GuardContext[] = [];
		// Global guards run before the manifest blockGuard, so this redirect wins.
		manifestRouter.addGuard((context: GuardContext) => {
			contexts.push(context);
			return context.toRoute === "protected" ? "home" : true;
		});
		manifestRouter.initialize();
		await waitForRoute(manifestRouter, "home");

		manifestRouter.navTo("protected");
		await manifestRouter.navigationSettled();

		const routes = contexts.map((context) => context.toRoute);
		assert.deepEqual(
			routes,
			["home", "protected", "home"],
			"initial, preflight and redirect-hop contexts captured",
		);
		assert.ok(
			contexts.every((context) => context.ownerComponent === component),
			"every context references the owning component",
		);
	} finally {
		component.destroy();
	}
});

interface OwnerProbe {
	owners: unknown[];
	decide: GuardFn | undefined;
}

/**
 * Run `test` on the nested fixture app, started as a page does: the parent component initializes
 * its router in init(). Its "shell" route displays the child component under the prefix "child".
 */
async function withNestedApp(test: (parent: UIComponent, probe: OwnerProbe) => Promise<void>): Promise<void> {
	const probe = await loadModule<OwnerProbe>("ui5/guard/router/qunit/fixtures/nested/child/guards/ownerProbe");
	probe.owners.length = 0;
	initHashChanger();
	const parent = await Component.create({
		name: "ui5.guard.router.qunit.fixtures.nested",
		manifest: true,
	});
	if (!(parent instanceof UIComponent)) {
		throw new Error("The parent is not a UIComponent");
	}
	const container = new ComponentContainer({ component: parent }).placeAt("qunit-fixture");

	try {
		await test(parent, probe);
	} finally {
		probe.decide = undefined;
		container.destroy();
		for (const component of [...probe.owners, parent]) {
			if (component instanceof UIComponent && !component.isDestroyed()) {
				component.destroy();
			}
		}
		HashChanger.getInstance().setHash("");
	}
}

/** The child component, as the owner that its manifest guard saw first. */
function getChild(probe: OwnerProbe): UIComponent {
	const owner = probe.owners[0];
	if (!(owner instanceof UIComponent)) {
		throw new Error("No guard of the child component ran");
	}
	return owner;
}

/** What a test sees of a child whose guard is pending on its first navigation. */
interface PendingChild {
	childRouter: GuardRouter;
	/** Settle the pending guard of the child. */
	decide: (result: GuardResult) => void;
	/** The routes that the parent and the child router matched since, in order. */
	matches: string[];
	/** Resolves when the parent route that displays the child has matched. */
	shellMatched: Promise<void>;
}

/**
 * Navigate the parent to the route that displays the child, whose guard waits for `decide` on the
 * child's first navigation. Resolves once the parent's component target has asked the child router
 * whether a match is in progress.
 */
async function displayChildWithPendingGuard(parentRouter: GuardRouter, probe: OwnerProbe): Promise<PendingChild> {
	let decide: (result: GuardResult) => void = () => {};
	const guardCalled = new Promise<void>((called) => {
		probe.decide = () => {
			probe.decide = undefined;
			called();
			return new Promise<GuardResult>((resolve) => {
				decide = resolve;
			});
		};
	});
	const matches: string[] = [];
	parentRouter.getRoute("shell")?.attachMatched(() => {
		matches.push("parent:shell");
	});
	const shellMatched = waitForRoute(parentRouter, "shell");
	parentRouter.navTo("shell");
	await guardCalled;
	const child = getChild(probe);
	const childRouter = getComponentRouter(child);
	childRouter.attachRouteMatched((event) => {
		matches.push(`child:${event.getParameter("name")}`);
	});
	// The component target asks the child router once the child is created.
	await child.rootControlLoaded();
	await flushPromises();
	return { childRouter, decide: (result) => decide(result), matches, shellMatched };
}

QUnit.test("a component loaded as a routing target navigates under its prefix", async function (assert: Assert) {
	await withNestedApp(async (parent, probe) => {
		const parentRouter = getComponentRouter(parent);
		assert.strictEqual(
			(await parentRouter.navigationSettled()).route,
			"home",
			"the parent starts on its home route",
		);

		// The "shell" route displays the child component and gives its router the prefix "child".
		parentRouter.navTo("shell");
		await waitForRoute(parentRouter, "shell");

		// A component target counts as displayed only once the child router matched its first route,
		// so the child's manifest guard has already seen its owner component.
		const child = getChild(probe);
		assert.notStrictEqual(child, parent, "the guard's owner component is not the parent");
		assert.strictEqual(
			child.getManifestEntry("/sap.app/id"),
			"ui5.guard.router.qunit.fixtures.nested.child",
			"the guard's owner component is the nested component",
		);
		const childRouter = getComponentRouter(child);
		assert.ok(child.getRouter() === childRouter, "its router is the guard router that ran the guard");
		const initial = await childRouter.navigationSettled();
		assert.strictEqual(initial.route, "list", "the child router matched its own initial route");
		assert.strictEqual(getHash(), "shell", "the child's empty hash leaves the parent's hash as it is");

		const parentStatuses = recordSettlements(parentRouter);
		const childStatuses = recordSettlements(childRouter);

		childRouter.navTo("detail");
		await waitForRoute(childRouter, "detail");
		assert.strictEqual(getHash(), "shell&/child/detail", "the child's hash is written under its prefix");

		const recorder = recordHashChanges();
		childRouter.navTo("locked");
		const blocked = await childRouter.navigationSettled();
		recorder.stop();
		assert.strictEqual(blocked.status, NavigationOutcome.Blocked, "the child's manifest guard blocks navTo");
		assert.strictEqual(blocked.route, "detail", "the child stays on its route");
		assert.deepEqual(recorder.hashes, [], "the browser hash never changed");

		// The same navigation from the address bar.
		HashChanger.getInstance().setHash("shell&/child/locked");
		await flushPromises();
		assert.deepEqual(
			childStatuses,
			[NavigationOutcome.Committed, NavigationOutcome.Blocked, NavigationOutcome.Blocked],
			"the child settled the allowed navigation and both blocked ones",
		);
		assert.strictEqual(getHash(), "shell&/child/detail", "the blocked browser hash is restored under the prefix");
		assert.strictEqual((await childRouter.navigationSettled()).route, "detail", "the child is still on its route");

		assert.ok(
			probe.owners.length === 4 && probe.owners.every((seen) => seen === child),
			"every navigation of the child passed the nested component as owner",
		);

		assert.deepEqual(parentStatuses, [], "the parent router saw no navigation");
		assert.strictEqual((await parentRouter.navigationSettled()).route, "shell", "the parent route stays matched");
	});
});

/**
 * Display the child on its "detail" route (`shell&/child/detail`) and record the routes it matches
 * from then on.
 */
async function showChildDetail(
	parent: UIComponent,
	probe: OwnerProbe,
): Promise<{ parentRouter: GuardRouter; childRouter: GuardRouter; childMatches: string[] }> {
	const parentRouter = getComponentRouter(parent);
	parentRouter.navTo("shell");
	await waitForRoute(parentRouter, "shell");
	const childRouter = getComponentRouter(getChild(probe));
	childRouter.navTo("detail");
	await waitForRoute(childRouter, "detail");
	const childMatches: string[] = [];
	childRouter.attachRouteMatched((event) => {
		childMatches.push(String(event.getParameter("name")));
	});
	return { parentRouter, childRouter, childMatches };
}

QUnit.test(
	"a hash change that the parent blocks is undone with the hash of the nested component",
	async function (assert: Assert) {
		await withNestedApp(async (parent, probe) => {
			const { parentRouter, childRouter, childMatches } = await showChildDetail(parent, probe);
			parentRouter.addLeaveGuard("shell", () => false);
			const parentStatuses = recordSettlements(parentRouter);

			const hashChanger = HashChanger.getInstance();
			const backOnDetail = waitForRoute(childRouter, "detail");
			const writes = await captureHashWrites(hashChanger, () => {
				hashChanger.setHash("");
			});
			await backOnDetail;

			assert.deepEqual(parentStatuses, [NavigationOutcome.Blocked], "the parent blocks the navigation");
			assert.deepEqual(
				writes,
				["set:", "replace:shell&/child/detail"],
				"one write restores the hash of the parent and of the nested component",
			);
			assert.strictEqual(getHash(), "shell&/child/detail", "the full previous hash is back");
			assert.strictEqual(
				(await parentRouter.navigationSettled()).route,
				"shell",
				"the parent stays on its route",
			);
			assert.deepEqual(
				await childRouter.navigationSettled(),
				{ status: NavigationOutcome.Committed, route: "detail", hash: "detail" },
				"the nested component is on the route it was on",
			);
			// UI5 reports the refused hash to the nested router before the parent can restore it.
			assert.deepEqual(childMatches, ["list", "detail"], "it received the refused hash, then the previous one");
		});
	},
);

QUnit.test(
	"a hash change that the parent blocks after an async guard is undone with the hash of the nested component",
	async function (assert: Assert) {
		await withNestedApp(async (parent, probe) => {
			const { parentRouter, childRouter } = await showChildDetail(parent, probe);
			let decide: (allowed: boolean) => void = () => {};
			parentRouter.addLeaveGuard("shell", () => new Promise<boolean>((resolve) => (decide = resolve)));

			HashChanger.getInstance().setHash("");
			await waitForRoute(childRouter, "list");
			assert.strictEqual(getHash(), "", "the refused hash is shown while the guard is pending");

			const backOnDetail = waitForRoute(childRouter, "detail");
			const writes = await captureHashWrites(HashChanger.getInstance(), () => {
				decide(false);
			});
			await backOnDetail;

			assert.deepEqual(writes, ["replace:shell&/child/detail"], "one write restores the full previous hash");
			assert.strictEqual(getHash(), "shell&/child/detail", "the full previous hash is back");
			assert.strictEqual(
				(await parentRouter.navigationSettled()).status,
				NavigationOutcome.Blocked,
				"the parent blocked the navigation",
			);
			assert.strictEqual(
				(await childRouter.navigationSettled()).route,
				"detail",
				"the child is back on its route",
			);
		});
	},
);

QUnit.test(
	"a blocked hash change of the nested router restores only its own hash once the URL has moved on",
	async function (assert: Assert) {
		await withNestedApp(async (parent, probe) => {
			const { childRouter } = await showChildDetail(parent, probe);
			const decisions: ((allowed: boolean) => void)[] = [];
			childRouter.addLeaveGuard("detail", () => new Promise<boolean>((resolve) => decisions.push(resolve)));

			const hashChanger = HashChanger.getInstance();
			hashChanger.setHash("shell&/child/list");
			// Another nested component navigates while the guard is pending.
			hashChanger.setHash("shell&/child/list&/other/item");
			decisions[0](false);
			const blocked = await childRouter.navigationSettled();

			assert.strictEqual(blocked.status, NavigationOutcome.Blocked, "the navigation is blocked");
			assert.strictEqual(
				getHash(),
				"shell&/child/detail&/other/item",
				"the hash of the other component is untouched",
			);
		});
	},
);

QUnit.test(
	"two hash changes of which the second supersedes the first are undone with the hash before both",
	async function (assert: Assert) {
		await withNestedApp(async (parent, probe) => {
			const { parentRouter, childRouter } = await showChildDetail(parent, probe);
			const decisions: ((allowed: boolean) => void)[] = [];
			parentRouter.addLeaveGuard("shell", () => new Promise<boolean>((resolve) => decisions.push(resolve)));
			const parentStatuses = recordSettlements(parentRouter);

			HashChanger.getInstance().setHash("");
			await waitForRoute(childRouter, "list");
			HashChanger.getInstance().setHash("elsewhere");
			await flushPromises();
			assert.deepEqual(parentStatuses, [NavigationOutcome.Cancelled], "the second hash change cancels the first");

			const backOnDetail = waitForRoute(childRouter, "detail");
			const writes = await captureHashWrites(HashChanger.getInstance(), () => {
				decisions.at(-1)?.(false);
			});
			await backOnDetail;

			assert.deepEqual(
				writes,
				["replace:shell&/child/detail"],
				"one write restores the hash before both changes",
			);
			assert.deepEqual(parentStatuses, [NavigationOutcome.Cancelled, NavigationOutcome.Blocked]);
			assert.strictEqual(getHash(), "shell&/child/detail", "the full previous hash is back");
		});
	},
);

QUnit.test(
	"a hash change that the parent redirects to the route it shows is undone with the hash of the nested component",
	async function (assert: Assert) {
		await withNestedApp(async (parent, probe) => {
			const { parentRouter, childRouter } = await showChildDetail(parent, probe);
			parentRouter.addRouteGuard("home", () => "shell");
			const shellMatches: string[] = [];
			parentRouter.attachRouteMatched((event) => shellMatches.push(String(event.getParameter("name"))));

			HashChanger.getInstance().setHash("");
			await waitForRoute(childRouter, "detail");

			assert.deepEqual(
				await parentRouter.navigationSettled(),
				{ status: NavigationOutcome.Redirected, route: "shell", hash: "shell" },
				"the parent settles as Redirected on the route it shows",
			);
			assert.strictEqual(getHash(), "shell&/child/detail", "the full previous hash is back");
			assert.deepEqual(shellMatches, [], "the parent route does not match again");
		});
	},
);

QUnit.test(
	"a hash change that the nested component blocks while the parent's guard is pending is undone as a whole",
	async function (assert: Assert) {
		await withNestedApp(async (parent, probe) => {
			const { parentRouter, childRouter, childMatches } = await showChildDetail(parent, probe);
			parentRouter.addLeaveGuard("shell", () => new Promise<boolean>(() => {}));
			childRouter.addLeaveGuard("detail", () => false);
			const parentStatuses = recordSettlements(parentRouter);
			const childStatuses = recordSettlements(childRouter);

			const hashChanger = HashChanger.getInstance();
			const writes = await captureHashWrites(hashChanger, () => {
				hashChanger.setHash("");
			});

			assert.deepEqual(
				writes,
				["set:", "replace:shell&/child/detail"],
				"the nested router restores the full hash",
			);
			assert.strictEqual(getHash(), "shell&/child/detail", "the full previous hash is back");
			assert.deepEqual(childStatuses, [NavigationOutcome.Blocked], "the nested component blocked");
			assert.deepEqual(parentStatuses, [NavigationOutcome.Cancelled], "which ends the parent's navigation");
			assert.deepEqual(childMatches, [], "the nested component matched no route");
		});
	},
);

QUnit.test(
	"a redirect to the hash that is shown sets the route of the nested component (componentTargetInfo)",
	async function (assert: Assert) {
		await withNestedApp(async (parent, probe) => {
			const parentRouter = getComponentRouter(parent);
			parentRouter.navTo("shell");
			await waitForRoute(parentRouter, "shell");
			const childRouter = getComponentRouter(getChild(probe));
			assert.strictEqual((await childRouter.navigationSettled()).route, "list", "the child is on its list");

			parentRouter.addRouteGuard("home", () => ({
				route: "shell",
				componentTargetInfo: { child: { route: "detail" } },
			}));
			parentRouter.navTo("home");
			await waitForRoute(childRouter, "detail");

			assert.deepEqual(
				await parentRouter.navigationSettled(),
				{ status: NavigationOutcome.Redirected, route: "shell", hash: "shell" },
				"the parent settles as Redirected on the route it was on",
			);
			assert.strictEqual(getHash(), "shell&/child/detail", "UI5 wrote the hash of the nested component");
		});
	},
);

for (const [kind, target] of [
	["a route name", "list"],
	["a route with parameters", { route: "list", parameters: {} }],
] as const) {
	QUnit.test(
		`a nested router that is redirected to its empty hash (${kind}) while the URL shows it leaves the URL as it is`,
		async function (assert: Assert) {
			await withNestedApp(async (parent, probe) => {
				const { childRouter } = await showChildDetail(parent, probe);
				// Pending for the hash change, allowed for the navTo() that supersedes it.
				let leaveGuardCalls = 0;
				childRouter.addLeaveGuard("detail", () =>
					++leaveGuardCalls === 1 ? new Promise<boolean>(() => {}) : true,
				);
				// Global guards run before the manifest guard that blocks "locked".
				childRouter.addGuard((context: GuardContext) => (context.toRoute === "locked" ? target : true));

				// The hash of the child becomes empty: the URL shows it without the prefix of the child.
				HashChanger.getInstance().setHash("shell");
				childRouter.navTo("locked");
				await flushPromises();

				assert.deepEqual(
					await childRouter.navigationSettled(),
					{ status: NavigationOutcome.Redirected, route: "list", hash: "" },
					"the child is on the redirect target",
				);
				assert.strictEqual(getHash(), "shell", "no prefix is added for the empty hash of the child");
			});
		},
	);
}

QUnit.test(
	"a parent route waits for the route that a nested component's first navigation is redirected to",
	async function (assert: Assert) {
		await withNestedApp(async (parent, probe) => {
			const child = await displayChildWithPendingGuard(getComponentRouter(parent), probe);

			child.decide("detail");
			await child.shellMatched;

			assert.deepEqual(
				child.matches,
				["child:detail", "parent:shell"],
				"the parent route matched after the route the child was redirected to",
			);
			const settled = await child.childRouter.navigationSettled();
			assert.strictEqual(
				settled.status,
				NavigationOutcome.Redirected,
				"the child's first navigation was redirected",
			);
			assert.strictEqual(getHash(), "shell&/child/detail", "the redirect target is written under the prefix");
		});
	},
);

QUnit.test(
	"a parent route matches although an async guard blocks a nested component's first navigation",
	async function (assert: Assert) {
		await withNestedApp(async (parent, probe) => {
			const parentRouter = getComponentRouter(parent);
			const child = await displayChildWithPendingGuard(parentRouter, probe);
			assert.deepEqual(child.matches, [], "the parent route waits for the child's guard");

			child.decide(false);
			const settled = await child.childRouter.navigationSettled();
			assert.strictEqual(settled.status, NavigationOutcome.Blocked, "the child's first navigation is blocked");

			// UI5 only waits for a routeMatched of the child, which a blocked navigation never fires.
			await child.shellMatched;
			assert.deepEqual(child.matches, ["parent:shell"], "the parent route matched, the child matched no route");
			assert.strictEqual(
				(await parentRouter.navigationSettled()).route,
				"shell",
				"the parent stays on its route",
			);
		});
	},
);

QUnit.test(
	"a blocked first navigation of a nested component leaves the browser hash as the parent set it",
	async function (assert: Assert) {
		await withNestedApp(async (parent, probe) => {
			const child = await displayChildWithPendingGuard(getComponentRouter(parent), probe);

			child.decide(false);
			const settled = await child.childRouter.navigationSettled();
			await child.shellMatched;

			assert.strictEqual(settled.status, NavigationOutcome.Blocked, "the child's first navigation is blocked");
			assert.strictEqual(getHash(), "shell", "the child's prefix is not added for its empty hash");
		});
	},
);

QUnit.test(
	"a redirect of a nested component to the route it shows leaves the browser hash as it is",
	async function (assert: Assert) {
		await withNestedApp(async (parent, probe) => {
			const parentRouter = getComponentRouter(parent);
			parentRouter.navTo("shell");
			await waitForRoute(parentRouter, "shell");
			const childRouter = getComponentRouter(getChild(probe));
			assert.strictEqual((await childRouter.navigationSettled()).route, "list", "the child shows its empty hash");

			for (const target of ["list", { route: "list" }]) {
				probe.decide = (context) => (context.toRoute === "detail" ? target : true);
				childRouter.navTo("detail");
				const settled = await childRouter.navigationSettled();

				assert.strictEqual(settled.status, NavigationOutcome.Redirected, "the child's guard redirected");
				assert.strictEqual(settled.route, "list", "back to the route the child shows");
				assert.strictEqual(getHash(), "shell", "the child's prefix is not added for its empty hash");
			}
		});
	},
);

QUnit.test(
	"a parent route matches although a guard blocks a nested component that is displayed again",
	async function (assert: Assert) {
		await withNestedApp(async (parent, probe) => {
			const parentRouter = getComponentRouter(parent);
			parentRouter.navTo("shell");
			await waitForRoute(parentRouter, "shell");
			const childRouter = getComponentRouter(getChild(probe));

			parentRouter.navTo("home");
			await waitForRoute(parentRouter, "home");
			assert.ok(childRouter.isStopped(), "leaving the parent route stops the child router");

			// UI5 starts the child router again and waits for its routeMatched.
			probe.decide = () => false;
			parentRouter.navTo("shell");
			await waitForRoute(parentRouter, "shell");

			const settled = await childRouter.navigationSettled();
			assert.strictEqual(settled.status, NavigationOutcome.Blocked, "the child's navigation is blocked");
			assert.strictEqual(probe.owners.length, 2, "the child's guard ran for both displays");
		});
	},
);
