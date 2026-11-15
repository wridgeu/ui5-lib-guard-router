import type { wdi5Selector } from "wdio-ui5-service";
import type ComponentRegistry from "sap/ui/core/ComponentRegistry";

/**
 * Control references shared by the standalone and FLP suites. Only app-declared IDs
 * (manifest target view ID + XML control ID) are used; the host-assigned component
 * prefix of the DOM ID never appears in tests.
 */

/** `sap.app/id` of the demo app: the component's canonical, host-independent ID. */
const APP_ID = "demo.app";

export type ControlRef = {
	/** Full view name, used by wdi5 selectors. */
	readonly viewName: string;
	/** View ID declared in the manifest routing target. */
	readonly viewId: string;
	/** Control ID declared in the XML view. */
	readonly id: string;
};

type ViewControls<Ids extends readonly string[]> = { readonly [K in Ids[number]]: ControlRef };

function viewControls<const Ids extends readonly string[]>(
	viewName: string,
	viewId: string,
	ids: Ids,
): ViewControls<Ids> {
	return Object.fromEntries(ids.map((id) => [id, { viewName, viewId, id }])) as ViewControls<Ids>;
}

const SETTLEMENT_PANEL = [
	"settlementStatus",
	"settlementRouteText",
	"settlementHashText",
	"settlementHashTechnicalText",
] as const;

export const CONTROLS = {
	home: viewControls("demo.app.view.Home", "homeView", [
		"homePage",
		"authStatus",
		"toggleLoginBtn",
		"launchModeText",
		"ushellStatus",
		"flpDirtyProviderStatus",
		"navProtectedBtn",
		"navBlockedBtn",
		"navForbiddenBtn",
		"navAdminBtn",
		"navToEmployees",
		...SETTLEMENT_PANEL,
	]),
	protected: viewControls("demo.app.view.Protected", "protectedView", [
		"protectedPage",
		"dirtyCheckbox",
		"protectedFlpDirtyProviderStatus",
		"protectedCurrentHashText",
		...SETTLEMENT_PANEL,
	]),
	notFound: viewControls("demo.app.view.NotFound", "notFoundView", ["notFoundPage", ...SETTLEMENT_PANEL]),
	employees: viewControls("demo.app.view.Employees", "employeesView", [
		"employeesPage",
		"employeesMeta",
		"navToEmployee",
		"updateMeta",
	]),
	employee: viewControls("demo.app.view.Employee", "employeeView", ["employeePage", "employeeMeta"]),
} as const;

/**
 * wdi5 selector for a control. The anchored ID is matched within the view, so
 * sub-elements such as `homePage-navButton` are never picked up.
 */
export function selectorFor(ref: ControlRef, extra: Partial<wdi5Selector["selector"]> = {}): wdi5Selector {
	return {
		selector: { viewName: ref.viewName, id: new RegExp(`^${ref.id}$`), ...extra },
		forceSelect: true,
	};
}

/**
 * Resolve the runtime ID of the demo component by its `sap.app/id`.
 * Fails if the app is not mounted or mounted more than once, instead of
 * silently picking one instance.
 */
export async function getAppComponentId(): Promise<string> {
	const ids = await browser.execute(
		(appId: string) =>
			new Promise<string[]>((resolve, reject) => {
				sap.ui.require(
					["sap/ui/core/ComponentRegistry"],
					(registry: typeof ComponentRegistry) => {
						resolve(
							registry
								.filter((component) => component.getManifestEntry("/sap.app/id") === appId)
								.map((component) => component.getId()),
						);
					},
					reject,
				);
			}),
		APP_ID,
	);

	if (ids.length !== 1) {
		throw new Error(`Expected exactly one "${APP_ID}" component, found ${ids.length}`);
	}
	return ids[0];
}
