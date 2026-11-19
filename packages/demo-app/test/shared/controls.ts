import type { wdi5Selector } from "wdio-ui5-service";
import type NavContainer from "sap/m/NavContainer";
import type Page from "sap/m/Page";
import type ComponentRegistry from "sap/ui/core/ComponentRegistry";

/**
 * Control references shared by the standalone and FLP suites. Only app-declared IDs
 * (manifest target view ID + XML control ID) are used; the host-assigned component
 * prefix of the DOM ID never appears in tests.
 */

/** `sap.app/id` of the demo app: the component's canonical, host-independent ID. */
const APP_ID = "demo.app";

/** `sap.app/id` of the nested reporting component that the "reports" route displays. */
export const REPORTS_APP_ID = "demo.app.reporting";

export type ControlRef = {
	/** `sap.app/id` of the component that owns the view. */
	readonly appId: string;
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
	appId = APP_ID,
): ViewControls<Ids> {
	return Object.fromEntries(ids.map((id) => [id, { appId, viewName, viewId, id }])) as ViewControls<Ids>;
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
		"navTeamBtn",
		"navReportsBtn",
		...SETTLEMENT_PANEL,
	]),
	protected: viewControls("demo.app.view.Protected", "protectedView", [
		"protectedPage",
		"dirtyCheckbox",
		"dirtyStatus",
		"clearDirtyAndGoHomeBtn",
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
		...SETTLEMENT_PANEL,
	]),
	employee: viewControls("demo.app.view.Employee", "employeeView", ["employeePage", "employeeMeta"]),
	reportsOverview: viewControls(
		"demo.app.reporting.view.Overview",
		"overviewView",
		["overviewPage", "unlockCheckbox", "accessStatus", "navSalesBtn", "navConfidentialBtn"],
		REPORTS_APP_ID,
	),
	reportsSales: viewControls(
		"demo.app.reporting.view.Sales",
		"salesView",
		["salesPage", "salesList"],
		REPORTS_APP_ID,
	),
	reportsNotFound: viewControls("demo.app.reporting.view.NotFound", "notFoundView", ["notFoundPage"], REPORTS_APP_ID),
	reportsConfidential: viewControls(
		"demo.app.reporting.view.Confidential",
		"confidentialView",
		["confidentialPage"],
		REPORTS_APP_ID,
	),
} as const;

/**
 * wdi5 selector for a control. The anchored ID is matched within the view, so
 * sub-elements such as `homePage-navButton` are never picked up.
 */
function selectorFor(ref: ControlRef, extra: Partial<wdi5Selector["selector"]> = {}): wdi5Selector {
	return {
		selector: { viewName: ref.viewName, id: new RegExp(`^${ref.id}$`), ...extra },
		forceSelect: true,
	};
}

/**
 * Resolve a control through wdi5, or fail. wdi5 itself only logs an error when it
 * finds no control and returns a control object without the UI5 methods.
 */
export async function getControl(ref: ControlRef, extra: Partial<wdi5Selector["selector"]> = {}) {
	const control = await browser.asControl(selectorFor(ref, extra));
	if (!control.isInitialized()) {
		throw new Error(`Control "${ref.viewId}/${ref.id}" was not found`);
	}
	return control;
}

/**
 * Click a control, or fail. This is the click that wdi5's `press()` performs, without
 * its error handling: `press()` only logs when the control is missing or not clickable.
 */
export async function press(ref: ControlRef): Promise<void> {
	const control = await getControl(ref);
	const element = (await control.getWebElement()) as WebdriverIO.Element;
	await element.click();
}

/** Wait until a control shows the expected text. Fails with the text (or lookup error) seen last. */
export async function expectControlText(ref: ControlRef, expected: string, timeout = 5000): Promise<void> {
	let seen = "(not read)";
	try {
		await browser.waitUntil(
			async () => {
				try {
					seen = JSON.stringify(await (await getControl(ref)).getProperty("text"));
				} catch (error) {
					seen = `(${String(error)})`;
				}
				return seen === JSON.stringify(expected);
			},
			{ timeout },
		);
	} catch {
		throw new Error(`Control "${ref.viewId}/${ref.id}" did not show text "${expected}"; last seen: ${seen}`);
	}
}

/**
 * Resolve the runtime ID of a component by its `sap.app/id` (the demo app by default).
 * Fails if the component is not mounted or mounted more than once, instead of
 * silently picking one instance.
 */
export async function getAppComponentId(appId = APP_ID): Promise<string> {
	const ids = await browser.execute(
		(id: string) =>
			new Promise<string[]>((resolve, reject) => {
				sap.ui.require(
					["sap/ui/core/ComponentRegistry"],
					(registry: typeof ComponentRegistry) => {
						resolve(
							registry
								.filter((component) => component.getManifestEntry("/sap.app/id") === id)
								.map((component) => component.getId()),
						);
					},
					reject,
				);
			}),
		appId,
	);

	if (ids.length !== 1) {
		throw new Error(`Expected exactly one "${appId}" component, found ${ids.length}`);
	}
	return ids[0];
}

/**
 * Wait until exactly one component with the `sap.app/id` is mounted: after a page load,
 * or for a component that is loaded lazily.
 */
export async function waitForComponent(appId = APP_ID, hint = ""): Promise<void> {
	await browser.waitUntil(
		() =>
			getAppComponentId(appId).then(
				() => true,
				() => false,
			),
		{ timeout: 15000, timeoutMsg: `Component "${appId}" was not mounted within 15s.${hint}` },
	);
}

/**
 * Whether the page has the title and is visible. A NavContainer hides the pages that are
 * not current with display:none; checkVisibility() also sees a hidden ancestor: the page
 * of a nested component whose container is hidden. During a transition the page that is
 * left is visible as well, so the view also has to be the current page of its container.
 */
export async function isPageDisplayed(page: ControlRef, expectedTitle: string): Promise<boolean> {
	return browser.execute(
		(componentId: string, viewId: string, id: string, title: string) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			const view = Component.getComponentById(componentId).byId(viewId);
			const control = view?.byId(id) as Page | undefined;
			const container = view?.getParent() as NavContainer | null | undefined;
			if (container && container.getCurrentPage() !== view) return false;
			const domRef = control?.getTitle() === title ? control.getDomRef() : null;
			return domRef ? domRef.checkVisibility({ visibilityProperty: true }) : false;
		},
		await getAppComponentId(page.appId),
		page.viewId,
		page.id,
		expectedTitle,
	);
}
