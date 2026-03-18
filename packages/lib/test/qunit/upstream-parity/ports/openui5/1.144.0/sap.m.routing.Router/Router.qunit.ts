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

type PrivateRoute = {
	_routeMatched: (...args: unknown[]) => Promise<unknown>;
};

type PrivateTargetHandler = {
	navigate: (...args: unknown[]) => unknown;
};

type Restorable = {
	restore(): void;
};

type SpyHandle = Restorable & {
	callCount: number;
	firstCall: {
		args: unknown[];
	};
	returnValues: unknown[];
};

type SinonLike = {
	stub(
		target: object,
		method: string,
	): {
		callsFake(fn: (...args: unknown[]) => unknown): Restorable;
	};
	spy(target: object, method: string): SpyHandle;
};

const sinonApi = (globalThis as unknown as { sinon: SinonLike }).sinon;

type ForwardNavigationResult = {
	toCallCount: number;
	normalizedToArgs: unknown[] | null;
	navigatePayload: unknown;
	routeMatched: {
		name: string | undefined;
		arguments: unknown;
	} | null;
};

function getPrivateRoute(router: ComparableRouter, routeName: string): PrivateRoute {
	return router.getRoute(routeName) as unknown as PrivateRoute;
}

function getPrivateTargetHandler(router: ComparableRouter): PrivateTargetHandler {
	return Reflect.get(router, "_oTargetHandler") as PrivateTargetHandler;
}

function stubViewsForSinglePage(targetPage: Page): Restorable {
	const prototype = Views.prototype as unknown as { _getView: (...args: unknown[]) => unknown };
	return sinonApi.stub(prototype, "_getView").callsFake(() => targetPage);
}

function stubViewsByName(viewMap: Record<string, Page>): Restorable {
	const prototype = Views.prototype as unknown as {
		_getView: (options: { viewName?: string; name?: string }) => unknown;
	};

	return sinonApi.stub(prototype, "_getView").callsFake((options: unknown) => {
		const candidateOptions = options as { viewName?: string; name?: string };
		const candidate = String(candidateOptions.viewName ?? candidateOptions.name ?? "").toLowerCase();
		for (const [name, page] of Object.entries(viewMap)) {
			if (candidate.endsWith(name.toLowerCase()) || candidate.includes(`.${name.toLowerCase()}`)) {
				return page;
			}
		}

		return viewMap.first ?? Object.values(viewMap)[0];
	});
}

async function runForwardNavigationScenario(flavor: RouterFlavor): Promise<ForwardNavigationResult> {
	const startPage = new Page();
	const navContainer = new NavContainer({ pages: startPage });
	const targetPage = new Page();
	const router = createRouterByFlavor(flavor, ...createForwardNavigationFixture(navContainer.getId()));
	const toSpy = sinonApi.spy(navContainer, "to");
	const navigateSpy = sinonApi.spy(getPrivateTargetHandler(router), "navigate");
	const routeMatchedSpy = sinonApi.spy(getPrivateRoute(router, "myRoute"), "_routeMatched");
	const getViewStub = stubViewsForSinglePage(targetPage);
	let routeMatched: ForwardNavigationResult["routeMatched"] = null;

	router.attachRouteMatched((event) => {
		routeMatched = {
			name: event.getParameter("name") as string | undefined,
			arguments: cloneJson(event.getParameter("arguments") as unknown),
		};
	});

	try {
		router.parse("some/myData");
		await routeMatchedSpy.returnValues[0];

		return {
			toCallCount: toSpy.callCount,
			normalizedToArgs:
				toSpy.callCount > 0 ? normalizeNavContainerToArgs(toSpy.firstCall.args, targetPage.getId()) : null,
			navigatePayload: navigateSpy.callCount > 0 ? cloneJson(navigateSpy.firstCall.args[0] as unknown) : null,
			routeMatched,
		};
	} finally {
		getViewStub.restore();
		routeMatchedSpy.restore();
		navigateSpy.restore();
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
	const backToPageSpy = sinonApi.spy(navContainer, "backToPage");
	const routeMatchedSpy = sinonApi.spy(getPrivateRoute(router, "route"), "_routeMatched");

	try {
		const targets = router.getTargets();
		if (!targets) {
			throw new Error("Router targets are not available");
		}

		await targets.display("initial");
		router.parse("anyPattern");
		await routeMatchedSpy.returnValues[0];
		return {
			backToPageCallCount: backToPageSpy.callCount,
			backToSecondTarget: backToPageSpy.callCount > 0 && backToPageSpy.firstCall.args[0] === secondPage.getId(),
		};
	} finally {
		backToPageSpy.restore();
		routeMatchedSpy.restore();
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
		nativeResult.navigatePayload,
		{
			askHistory: true,
			navigationIdentifier: "myTarget",
			level: 5,
		},
		"Native router matches the upstream TargetHandler.navigate payload",
	);
	assert.deepEqual(
		guardResult.navigatePayload,
		nativeResult.navigatePayload,
		"Guard router matches the native TargetHandler.navigate payload",
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
