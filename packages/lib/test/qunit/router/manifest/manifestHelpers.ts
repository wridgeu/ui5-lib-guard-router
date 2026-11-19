import HashChanger from "sap/ui/core/routing/HashChanger";
import type { GuardFn, GuardRouter } from "ui5/guard/router/types";
import { GuardRouterClass, initHashChanger, loadModule } from "../../testHelpers";

export const FIXTURES = "ui5/guard/router/qunit/fixtures/guards";

export const ROUTES = [
	{ name: "home", pattern: "" },
	{ name: "protected", pattern: "protected" },
	{ name: "forbidden", pattern: "forbidden" },
];

export function createLazyRouter(guards: Record<string, string[]>): GuardRouter {
	return new GuardRouterClass(ROUTES, {
		async: true,
		guardRouter: { guardLoading: "lazy", unknownRouteRegistration: "ignore", guards },
	});
}

export interface LazyProbe {
	calls: string[];
	behaviors: GuardFn[];
}

export async function loadProbe(): Promise<LazyProbe> {
	const probe = await loadModule<LazyProbe>(`${FIXTURES}/lazyProbe`);
	probe.calls.length = 0;
	probe.behaviors = [];
	return probe;
}

/**
 * QUnit module hooks for tests that create their router themselves: the hash is reset before
 * each test, the router that `current` returns is destroyed after it.
 */
export function manifestHooks(current: () => GuardRouter): { beforeEach: () => void; afterEach: () => void } {
	return {
		beforeEach: initHashChanger,
		afterEach: () => {
			current().destroy();
			HashChanger.getInstance().setHash("");
		},
	};
}
