import type { GuardRouter } from "ui5/guard/router/types";
import { CONTROLS, expectControlText, getAppComponentId, press } from "../shared/controls";
import {
	expectAppHashToBe,
	getRuntimeSettlementRevisionInFlp,
	installDialogHandler,
	loginAndGoToProtectedInFlp,
	navigateToRouteInFlp,
	resetFlpDemo,
	setDirtyStateInFlp,
	triggerFlpCrossAppNavigationAndExpectDirtyPrompt,
	waitForHomePageInFlp,
	waitForProtectedPageInFlp,
} from "./helpers";

const EMPLOYEES_META = { section: "hr", requiresAuth: true };
const EMPLOYEE_META = { ...EMPLOYEES_META, detail: true };

/**
 * On Protected with a dirty form: navigate to "home" through the router and assert that the
 * leave guard blocked it without an FLP confirm dialog.
 */
async function expectInAppNavigationBlocked(): Promise<void> {
	const settlementRevision = await getRuntimeSettlementRevisionInFlp();
	const { record, cleanup } = installDialogHandler(true);

	try {
		await navigateToRouteInFlp("home");

		await waitForProtectedPageInFlp({ afterRevision: settlementRevision });
		await expectAppHashToBe("protected", { afterRevision: settlementRevision });
		await expectControlText(CONTROLS.protected.settlementStatus, "Blocked");
		await expectControlText(CONTROLS.protected.protectedCurrentHashText, "#/protected");
		expect(record.called).toBe(false);
	} finally {
		cleanup();
	}
}

/** On Protected: navigate to "home" through the router and assert that the navigation committed. */
async function expectInAppNavigationToHome(): Promise<void> {
	const settlementRevision = await getRuntimeSettlementRevisionInFlp();

	await navigateToRouteInFlp("home");

	await waitForHomePageInFlp({ afterRevision: settlementRevision });
	await expectAppHashToBe("");
	await expectControlText(CONTROLS.home.settlementStatus, "Committed");
}

/** On Protected: go back in the browser history and assert that the navigation to Home committed. */
async function browserBackToHome(): Promise<void> {
	const settlementRevision = await getRuntimeSettlementRevisionInFlp();

	await browser.back();

	await waitForHomePageInFlp({ afterRevision: settlementRevision });
	await expectAppHashToBe("");
	await expectControlText(CONTROLS.home.settlementStatus, "Committed");
}

/** Assert that the navigation started after `afterRevision` was redirected to Home, where the test started. */
async function expectRedirectedHome(afterRevision: number): Promise<void> {
	await waitForHomePageInFlp({ afterRevision });
	await expectAppHashToBe("", { afterRevision });
	await expectControlText(CONTROLS.home.settlementStatus, "Redirected");
	await expectControlText(CONTROLS.home.settlementRouteText, "home");
}

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

describe("FLP preview integration", () => {
	beforeEach(async () => {
		await resetFlpDemo();
	});

	it("shows FLP runtime state on launch", async () => {
		await expectControlText(CONTROLS.home.launchModeText, "FLP Preview");
		await expectControlText(CONTROLS.home.ushellStatus, "sap.ushell.Container available");
		await expectControlText(CONTROLS.home.flpDirtyProviderStatus, "FLP cross-app dirty protection active");
	});

	it("keeps app navigation working inside FLP preview", async () => {
		await loginAndGoToProtectedInFlp();
		await expectControlText(
			CONTROLS.protected.protectedFlpDirtyProviderStatus,
			"FLP cross-app dirty protection active",
		);
		await expectControlText(CONTROLS.protected.protectedCurrentHashText, "#/protected");
		await expectControlText(CONTROLS.protected.settlementStatus, "Committed");
		await expectControlText(CONTROLS.protected.settlementRouteText, "protected");
		await expectControlText(CONTROLS.protected.settlementHashText, "protected");
		await expectControlText(CONTROLS.protected.settlementHashTechnicalText, 'Technical: "protected"');
	});

	it("triggers FLP dirty-state prompt on cross-app navigation and stays on page after cancel", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);

		await triggerFlpCrossAppNavigationAndExpectDirtyPrompt();
		await waitForProtectedPageInFlp();
	});

	it("blocks dirty in-app navigation via leave guard without triggering FLP confirm", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);

		await expectInAppNavigationBlocked();
	});

	it("proves leave guard and FLP dirty provider operate independently on the same dirty state", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);

		// PART 1: In-app navigation. Leave guard blocks, no FLP confirm.
		await expectInAppNavigationBlocked();

		// PART 2: Same dirty state, cross-app navigation. FLP confirm fires.
		await triggerFlpCrossAppNavigationAndExpectDirtyPrompt();
		await waitForProtectedPageInFlp();
	});
});

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

describe("FLP guard router hardening", () => {
	beforeEach(async () => {
		await resetFlpDemo();
	});

	// --- Enter guard tests ---

	it("redirects navigation to protected route to home when logged out", async () => {
		// Logged out (resetFlpDemo asserts this). Try to navigate to protected.
		const settlementRevision = await getRuntimeSettlementRevisionInFlp();
		await navigateToRouteInFlp("protected");

		await expectRedirectedHome(settlementRevision);
	});

	it("redirects forbidden route to home", async () => {
		const settlementRevision = await getRuntimeSettlementRevisionInFlp();
		await navigateToRouteInFlp("forbidden");

		await expectRedirectedHome(settlementRevision);
	});

	it("allows navigation to protected route when logged in", async () => {
		await loginAndGoToProtectedInFlp();
		await expectControlText(CONTROLS.protected.settlementStatus, "Committed");
		await expectControlText(CONTROLS.protected.settlementRouteText, "protected");
	});

	// --- Leave guard tests ---

	it("allows leaving protected page when form is clean", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(false);

		await expectInAppNavigationToHome();
	});

	it("allows leaving after clearing dirty state", async () => {
		await loginAndGoToProtectedInFlp();

		// The dirty state has to be in effect first: the same navigation is blocked.
		await setDirtyStateInFlp(true);
		await expectInAppNavigationBlocked();

		await setDirtyStateInFlp(false);

		await expectInAppNavigationToHome();
	});

	// --- Browser history tests ---

	it("handles browser back from protected to home", async () => {
		await loginAndGoToProtectedInFlp();

		await browserBackToHome();
	});

	it("blocks browser back when form is dirty", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);
		const settlementRevision = await getRuntimeSettlementRevisionInFlp();

		await browser.back();

		// Leave guard blocks. Page stays on protected.
		await waitForProtectedPageInFlp({ afterRevision: settlementRevision });
		await expectAppHashToBe("protected", { afterRevision: settlementRevision });
		await expectControlText(CONTROLS.protected.settlementStatus, "Blocked");
	});

	it("re-evaluates enter guard on browser forward after logout", async () => {
		await loginAndGoToProtectedInFlp();
		await browserBackToHome();

		// Logout.
		await press(CONTROLS.home.toggleLoginBtn);
		await expectControlText(CONTROLS.home.authStatus, "Logged Out");

		// Browser forward toward previously visited #/protected.
		const settlementRevision = await getRuntimeSettlementRevisionInFlp();
		await browser.forward();

		// Enter guard redirects back to home.
		await expectRedirectedHome(settlementRevision);
	});

	it("handles back/forward cycles with guards", async () => {
		await loginAndGoToProtectedInFlp();
		await browserBackToHome();

		// Forward to protected (still logged in, guard allows)
		const settlementRevision = await getRuntimeSettlementRevisionInFlp();
		await browser.forward();
		await waitForProtectedPageInFlp({ afterRevision: settlementRevision });
		await expectAppHashToBe("protected");

		await browserBackToHome();
	});
});
