import type { GuardRouter } from "ui5/guard/router/types";
import { getAppComponentId } from "../shared/controls";
import { resetFlpDemo } from "./helpers";

const EMPLOYEES_META = { section: "hr", requiresAuth: true };
const EMPLOYEE_META = { ...EMPLOYEES_META, detail: true };

async function getRouteMetaInFlp(routeName: string): Promise<Record<string, unknown>> {
	return browser.execute(
		(componentId: string, route: string) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			const router: GuardRouter = Component.getComponentById(componentId).getRouter();
			return { ...router.getRouteMeta(route) };
		},
		await getAppComponentId(),
		routeName,
	);
}

async function setRouteMetaInFlp(routeName: string, meta: Record<string, unknown>): Promise<void> {
	await browser.execute(
		(componentId: string, route: string, value: Record<string, unknown>) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			const router: GuardRouter = Component.getComponentById(componentId).getRouter();
			router.setRouteMeta(route, value);
		},
		await getAppComponentId(),
		routeName,
		meta,
	);
}

describe("FLP route metadata and inheritance", () => {
	beforeEach(async () => {
		await resetFlpDemo();
	});

	it("getRouteMeta returns inherited metadata under FLP", async () => {
		expect(await getRouteMetaInFlp("employees")).toEqual(EMPLOYEES_META);
		expect(await getRouteMetaInFlp("employee")).toEqual(EMPLOYEE_META);
	});

	it("setRouteMeta invalidates cache and propagates under FLP", async () => {
		// Resolve the inherited metadata before the update, so that the update has to
		// replace an already computed result.
		expect(await getRouteMetaInFlp("employee")).toEqual(EMPLOYEE_META);

		try {
			await setRouteMetaInFlp("employees", { section: "engineering", requiresAuth: true });

			expect(await getRouteMetaInFlp("employee")).toEqual({
				section: "engineering",
				requiresAuth: true,
				detail: true,
			});
		} finally {
			// The page is not reloaded between tests: put the manifest metadata back.
			await setRouteMetaInFlp("employees", EMPLOYEES_META);
		}
		expect(await getRouteMetaInFlp("employee")).toEqual(EMPLOYEE_META);
	});
});
