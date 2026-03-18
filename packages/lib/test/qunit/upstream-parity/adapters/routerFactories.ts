import MobileRouter from "sap/m/routing/Router";
import Router from "ui5/guard/router/Router";
import type { GuardRouter } from "ui5/guard/router/types";
import { initHashChanger } from "../../testHelpers";

export type RouterArgs = ConstructorParameters<typeof MobileRouter>;
export type ComparableRouter = MobileRouter | GuardRouter;
export type RouterFlavor = "native" | "guard";

export function createNativeRouter(...args: RouterArgs): MobileRouter {
	initHashChanger();
	return new MobileRouter(...args);
}

export function createGuardRouter(...args: RouterArgs): GuardRouter {
	initHashChanger();
	return new Router(...args);
}

export function createRouterByFlavor(flavor: RouterFlavor, ...args: RouterArgs): ComparableRouter {
	return flavor === "native" ? createNativeRouter(...args) : createGuardRouter(...args);
}

export function destroyRouters(...routers: Array<{ destroy(): unknown } | null | undefined>): void {
	for (const router of routers) {
		router?.destroy();
	}
}
