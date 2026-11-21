import { CONTROLS, expectControlText, press } from "../shared/controls";
import { getHistoryEntryIndex, getHistoryLength } from "../shared/history";
import { getRuntimeSettlementRevision } from "../shared/models";
import {
	expectAppHashToBe,
	expectInAppNavigationBlocked,
	loginAndGoToProtectedInFlp,
	navigateToRouteInFlp,
	resetFlpDemo,
	setDirtyStateInFlp,
	waitForHomePageInFlp,
	waitForPageInFlp,
	waitForProtectedPageInFlp,
} from "./helpers";

/** On Protected: navigate to "home" through the router and assert that the navigation committed. */
async function expectInAppNavigationToHome(): Promise<void> {
	const settlementRevision = await getRuntimeSettlementRevision();

	await navigateToRouteInFlp("home");

	await waitForHomePageInFlp({ afterRevision: settlementRevision });
	await expectAppHashToBe("");
	await expectControlText(CONTROLS.home.settlementStatus, "Committed");
}

/** On Protected: go back in the browser history and assert that the navigation to Home committed. */
async function browserBackToHome(): Promise<void> {
	const settlementRevision = await getRuntimeSettlementRevision();

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

describe("FLP guard router hardening", () => {
	beforeEach(async () => {
		await resetFlpDemo();
	});

	it("redirects navigation to protected route to home when logged out", async () => {
		// Logged out: resetFlpDemo asserts it.
		const settlementRevision = await getRuntimeSettlementRevision();
		await navigateToRouteInFlp("protected");

		await expectRedirectedHome(settlementRevision);
	});

	it("redirects forbidden route to home", async () => {
		const settlementRevision = await getRuntimeSettlementRevision();
		await navigateToRouteInFlp("forbidden");

		await expectRedirectedHome(settlementRevision);
	});

	it("settles a redirect to the alias route 'staff' on 'employees', the route that matches the hash", async () => {
		const settlementRevision = await getRuntimeSettlementRevision();
		await press(CONTROLS.home.navTeamBtn);

		await waitForPageInFlp(CONTROLS.employees.employeesPage, "Employees", { afterRevision: settlementRevision });
		await expectAppHashToBe("employees");
		await expectControlText(CONTROLS.employees.settlementStatus, "Redirected");
		await expectControlText(CONTROLS.employees.settlementRouteText, "employees");
	});

	it("allows navigation to protected route when logged in", async () => {
		await loginAndGoToProtectedInFlp();
		await expectControlText(CONTROLS.protected.settlementStatus, "Committed");
		await expectControlText(CONTROLS.protected.settlementRouteText, "protected");
	});

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

	it("handles browser back from protected to home", async () => {
		await loginAndGoToProtectedInFlp();

		await browserBackToHome();
	});

	it("blocks browser back when form is dirty", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);
		const settlementRevision = await getRuntimeSettlementRevision();

		await browser.back();

		await waitForProtectedPageInFlp({ afterRevision: settlementRevision });
		await expectAppHashToBe("protected", { afterRevision: settlementRevision });
		await expectControlText(CONTROLS.protected.settlementStatus, "Blocked");
	});

	it("leaves the browser history as it was after a blocked browser back", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);
		const historyLength = await getHistoryLength();
		const entryIndex = await getHistoryEntryIndex();
		const blockedRevision = await getRuntimeSettlementRevision();
		await browser.back();
		await waitForProtectedPageInFlp({ afterRevision: blockedRevision });
		await expectAppHashToBe("protected", { afterRevision: blockedRevision });
		await expectControlText(CONTROLS.protected.settlementStatus, "Blocked");
		// The browser is on the entry it left, not on the one before it with the hash replaced.
		expect(await getHistoryEntryIndex()).toBe(entryIndex);
		expect(await getHistoryLength()).toBe(historyLength);

		// The entry of Home is still behind Protected: one step back arrives there.
		await setDirtyStateInFlp(false);
		await browserBackToHome();

		// And the entry of Protected is still ahead of it.
		const forwardRevision = await getRuntimeSettlementRevision();
		await browser.forward();
		await waitForProtectedPageInFlp({ afterRevision: forwardRevision });
		await expectAppHashToBe("protected");
	});

	it("returns to Home with browser back after a redirected navTo()", async () => {
		const entryIndex = await getHistoryEntryIndex();
		const redirectRevision = await getRuntimeSettlementRevision();
		await press(CONTROLS.home.navTeamBtn);
		await waitForPageInFlp(CONTROLS.employees.employeesPage, "Employees", { afterRevision: redirectRevision });
		await expectAppHashToBe("employees");
		await expectControlText(CONTROLS.employees.settlementStatus, "Redirected");

		// The redirect target is a history entry of its own: Home is the entry before it.
		expect(await getHistoryEntryIndex()).toBe(entryIndex + 1);
		await browserBackToHome();

		// The guarded hash "team" was never written: forward arrives on the redirect target.
		const forwardRevision = await getRuntimeSettlementRevision();
		await browser.forward();
		await waitForPageInFlp(CONTROLS.employees.employeesPage, "Employees", { afterRevision: forwardRevision });
		await expectAppHashToBe("employees");
	});

	it("re-evaluates enter guard on browser forward after logout", async () => {
		await loginAndGoToProtectedInFlp();
		await browserBackToHome();

		await press(CONTROLS.home.toggleLoginBtn);
		await expectControlText(CONTROLS.home.authStatus, "Logged Out");

		// Browser forward toward previously visited #/protected.
		const settlementRevision = await getRuntimeSettlementRevision();
		await browser.forward();

		await expectRedirectedHome(settlementRevision);
	});

	it("handles back/forward cycles with guards", async () => {
		await loginAndGoToProtectedInFlp();
		await browserBackToHome();

		// Forward to protected (still logged in, guard allows)
		const settlementRevision = await getRuntimeSettlementRevision();
		await browser.forward();
		await waitForProtectedPageInFlp({ afterRevision: settlementRevision });
		await expectAppHashToBe("protected");

		await browserBackToHome();
	});
});
