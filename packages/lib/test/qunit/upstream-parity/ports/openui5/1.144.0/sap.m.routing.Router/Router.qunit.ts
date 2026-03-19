/**
 * Ported from vendored OpenUI5 test source
 * Source repo: UI5/openui5
 * Source path: src/sap.m/test/sap/m/qunit/routing/async/Router.qunit.js
 * Source tag: 1.144.0
 * Source commit: 3ee7b61446490b20e4ab95bb33404a520761daf5
 * Imported: 2026-03-18
 * Local adaptations:
 * - Replaced original upstream test bootstrap with local adapter harness
 * - Scoped execution to native-parity mode (no guards registered)
 */
import sinon from "sinon";
import NavContainer from "sap/m/NavContainer";
import Page from "sap/m/Page";
import Views from "sap/ui/core/routing/Views";
import { cloneJson, normalizeNavContainerToArgs } from "../../../../adapters/assertions";
import { createForwardNavigationFixture, createViewLevelFixture } from "../../../../adapters/fixtures";
import {
	createRouterByFlavor,
	destroyRouters,
	type ComparableRouter,
	type RouterFlavor,
} from "../../../../adapters/routerFactories";

type ForwardNavigationResult = {
	toCallCount: number;
	normalizedToArgs: unknown[] | null;
	routeMatched: {
		name: string | undefined;
		arguments: unknown;
	} | null;
};

type RouteMatchedEvent = {
	getParameter(name: string): unknown;
};

type RouteMatchedApi = {
	attachRouteMatched(data: undefined, handler: (event: RouteMatchedEvent) => void): void;
	detachRouteMatched(handler: (event: RouteMatchedEvent) => void, listener?: unknown): void;
};

function stubViewsForSinglePage(targetPage: Page) {
	const prototype = Views.prototype as unknown as { _getView: (...args: unknown[]) => unknown };
	return sinon.stub(prototype, "_getView").callsFake(() => targetPage);
}

function stubViewsByName(viewMap: Record<string, Page>) {
	const prototype = Views.prototype as unknown as {
		_getView: (options: { viewName?: string; name?: string }) => unknown;
	};

	return sinon.stub(prototype, "_getView").callsFake((options: unknown) => {
		const candidateOptions = options as { viewName?: string; name?: string };
		const candidate = String(candidateOptions.viewName ?? candidateOptions.name ?? "").toLowerCase();
		for (const [name, page] of Object.entries(viewMap)) {
			if (candidate.endsWith(name.toLowerCase()) || candidate.includes(`.${name.toLowerCase()}`)) {
				return page;
			}
		}

		throw new Error(`Unexpected view request in upstream parity port: ${candidate}`);
	});
}

function waitForRouteMatched(
	router: ComparableRouter,
	routeName: string,
): Promise<ForwardNavigationResult["routeMatched"]> {
	return new Promise((resolve) => {
		const routeMatchedApi = router as unknown as RouteMatchedApi;
		const handler = (event: RouteMatchedEvent) => {
			if ((event.getParameter("name") as string | undefined) !== routeName) {
				return;
			}

			routeMatchedApi.detachRouteMatched(handler, undefined);
			resolve({
				name: event.getParameter("name") as string | undefined,
				arguments: cloneJson(event.getParameter("arguments") as unknown),
			});
		};

		routeMatchedApi.attachRouteMatched(undefined, handler);
	});
}

async function runForwardNavigationScenario(flavor: RouterFlavor): Promise<ForwardNavigationResult> {
	const startPage = new Page();
	const navContainer = new NavContainer({ pages: startPage });
	const targetPage = new Page();
	const router = createRouterByFlavor(flavor, ...createForwardNavigationFixture(navContainer.getId()));
	const toSpy = sinon.spy(navContainer, "to");
	const getViewStub = stubViewsForSinglePage(targetPage);

	try {
		const routeMatchedPromise = waitForRouteMatched(router, "myRoute");
		router.parse("some/myData");
		const routeMatched = await routeMatchedPromise;

		return {
			toCallCount: toSpy.callCount,
			normalizedToArgs:
				toSpy.callCount > 0 ? normalizeNavContainerToArgs(toSpy.firstCall.args, targetPage.getId()) : null,
			routeMatched,
		};
	} finally {
		getViewStub.restore();
		toSpy.restore();
		destroyRouters(router);
		navContainer.destroy();
		targetPage.destroy();
		startPage.destroy();
	}
}

async function runViewLevelScenario(flavor: RouterFlavor): Promise<{
	backToPageCallCount: number;
	backToSecondTarget: boolean;
}> {
	const navContainer = new NavContainer(`${flavor}-container`);
	const firstPage = new Page();
	const secondPage = new Page();
	const initialPage = new Page();
	const router = createRouterByFlavor(flavor, ...createViewLevelFixture(navContainer.getId()));
	const getViewStub = stubViewsByName({ first: firstPage, second: secondPage, initial: initialPage });
	const backToPageSpy = sinon.spy(navContainer, "backToPage");

	try {
		const targets = router.getTargets();
		if (!targets) {
			throw new Error("Router targets are not available");
		}

		await targets.display("initial");
		const routeMatchedPromise = waitForRouteMatched(router, "route");
		router.parse("anyPattern");
		await routeMatchedPromise;
		return {
			backToPageCallCount: backToPageSpy.callCount,
			backToSecondTarget: backToPageSpy.callCount > 0 && backToPageSpy.firstCall.args[0] === secondPage.getId(),
		};
	} finally {
		backToPageSpy.restore();
		getViewStub.restore();
		destroyRouters(router);
		navContainer.destroy();
		firstPage.destroy();
		secondPage.destroy();
		initialPage.destroy();
	}
}

QUnit.module("UpstreamParity - OpenUI5 1.144.0 async Router");

QUnit.test("forward navigation on NavContainer matches the upstream contract", async function (assert: Assert) {
	const nativeResult = await runForwardNavigationScenario("native");
	const guardResult = await runForwardNavigationScenario("guard");

	assert.strictEqual(nativeResult.toCallCount, 1, "Native router performs one forward navigation");
	assert.strictEqual(guardResult.toCallCount, nativeResult.toCallCount, "Guard router matches native call count");
	assert.deepEqual(
		nativeResult.normalizedToArgs,
		["<target-page>", "flip", { eventData: "myData" }, { some: "parameter" }],
		"Native router matches the upstream forward-navigation arguments",
	);
	assert.deepEqual(
		guardResult.normalizedToArgs,
		nativeResult.normalizedToArgs,
		"Guard router matches the native NavContainer transition arguments",
	);
	assert.deepEqual(
		nativeResult.routeMatched,
		{
			name: "myRoute",
			arguments: { eventData: "myData" },
		},
		"Native router exposes the expected routeMatched payload",
	);
	assert.deepEqual(
		guardResult.routeMatched,
		nativeResult.routeMatched,
		"Guard router matches the native routeMatched payload",
	);
});

QUnit.test(
	"viewLevel back navigation with multiple targets matches the upstream contract",
	async function (assert: Assert) {
		const nativeResult = await runViewLevelScenario("native");
		const guardResult = await runViewLevelScenario("guard");

		assert.strictEqual(nativeResult.backToPageCallCount, 1, "Native router performs one backToPage navigation");
		assert.ok(nativeResult.backToSecondTarget, "Native router targets the second page for back navigation");
		assert.deepEqual(guardResult, nativeResult, "Guard router matches the native back-navigation outcome");
	},
);
