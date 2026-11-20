import type { wdi5Selector } from "wdio-ui5-service";
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

/** References to the controls of one view, by control ID. */
function inView(viewName: string, viewId: string, appId = APP_ID): (id: string) => ControlRef {
	return (id) => ({ appId, viewName, viewId, id });
}

/** The settlement panel that several views show. */
function settlementPanel(ref: (id: string) => ControlRef) {
	return {
		settlementStatus: ref("settlementStatus"),
		settlementRouteText: ref("settlementRouteText"),
		settlementHashText: ref("settlementHashText"),
		settlementHashTechnicalText: ref("settlementHashTechnicalText"),
	};
}

const homeView = inView("demo.app.view.Home", "homeView");
const protectedView = inView("demo.app.view.Protected", "protectedView");
const notFoundView = inView("demo.app.view.NotFound", "notFoundView");
const employeesView = inView("demo.app.view.Employees", "employeesView");
const employeeView = inView("demo.app.view.Employee", "employeeView");
const reportsOverviewView = inView("demo.app.reporting.view.Overview", "overviewView", REPORTS_APP_ID);
const reportsSalesView = inView("demo.app.reporting.view.Sales", "salesView", REPORTS_APP_ID);
const reportsNotFoundView = inView("demo.app.reporting.view.NotFound", "notFoundView", REPORTS_APP_ID);
const reportsConfidentialView = inView("demo.app.reporting.view.Confidential", "confidentialView", REPORTS_APP_ID);

export const CONTROLS = {
	home: {
		homePage: homeView("homePage"),
		authStatus: homeView("authStatus"),
		toggleLoginBtn: homeView("toggleLoginBtn"),
		launchModeText: homeView("launchModeText"),
		ushellStatus: homeView("ushellStatus"),
		flpDirtyProviderStatus: homeView("flpDirtyProviderStatus"),
		navProtectedBtn: homeView("navProtectedBtn"),
		navBlockedBtn: homeView("navBlockedBtn"),
		navForbiddenBtn: homeView("navForbiddenBtn"),
		navAdminBtn: homeView("navAdminBtn"),
		navToEmployees: homeView("navToEmployees"),
		navTeamBtn: homeView("navTeamBtn"),
		navReportsBtn: homeView("navReportsBtn"),
		...settlementPanel(homeView),
	},
	protected: {
		protectedPage: protectedView("protectedPage"),
		dirtyCheckbox: protectedView("dirtyCheckbox"),
		dirtyStatus: protectedView("dirtyStatus"),
		clearDirtyAndGoHomeBtn: protectedView("clearDirtyAndGoHomeBtn"),
		protectedFlpDirtyProviderStatus: protectedView("protectedFlpDirtyProviderStatus"),
		protectedCurrentHashText: protectedView("protectedCurrentHashText"),
		...settlementPanel(protectedView),
	},
	notFound: {
		notFoundPage: notFoundView("notFoundPage"),
		...settlementPanel(notFoundView),
	},
	employees: {
		employeesPage: employeesView("employeesPage"),
		employeesMeta: employeesView("employeesMeta"),
		navToEmployee: employeesView("navToEmployee"),
		updateMeta: employeesView("updateMeta"),
		...settlementPanel(employeesView),
	},
	employee: {
		employeePage: employeeView("employeePage"),
		employeeMeta: employeeView("employeeMeta"),
	},
	reportsOverview: {
		overviewPage: reportsOverviewView("overviewPage"),
		unlockCheckbox: reportsOverviewView("unlockCheckbox"),
		accessStatus: reportsOverviewView("accessStatus"),
		navSalesBtn: reportsOverviewView("navSalesBtn"),
		navConfidentialBtn: reportsOverviewView("navConfidentialBtn"),
	},
	reportsSales: {
		salesPage: reportsSalesView("salesPage"),
		salesList: reportsSalesView("salesList"),
	},
	reportsNotFound: {
		notFoundPage: reportsNotFoundView("notFoundPage"),
	},
	reportsConfidential: {
		confidentialPage: reportsConfidentialView("confidentialPage"),
	},
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
	await $(await control.getWebElement()).click();
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
			const Page = sap.ui.require("sap/m/Page");
			const NavContainer = sap.ui.require("sap/m/NavContainer");
			const view = Component.getComponentById(componentId).byId(viewId);
			const control = view?.byId(id);
			const container = view?.getParent();
			if (container instanceof NavContainer && container.getCurrentPage() !== view) return false;
			const domRef = control instanceof Page && control.getTitle() === title ? control.getDomRef() : null;
			return domRef ? domRef.checkVisibility({ visibilityProperty: true }) : false;
		},
		await getAppComponentId(page.appId),
		page.viewId,
		page.id,
		expectedTitle,
	);
}
