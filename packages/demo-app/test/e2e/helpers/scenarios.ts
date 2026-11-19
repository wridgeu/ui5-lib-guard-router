import { CONTROLS, expectControlText, getAppComponentId, press } from "../../shared/controls";
import { getRuntimeSettlementRevision, setDirtyState } from "../../shared/models";
import { waitForPage, expectHashToBe, waitForRuntimeSettlement } from "./wait";
import { fireEvent } from "./browser";

/**
 * Reset the auth model to logged-out state.
 */
async function resetAuth(): Promise<void> {
	await browser.execute(
		(componentId: string) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			Component.getComponentById(componentId).getModel("auth").setProperty("/isLoggedIn", false);
		},
		await getAppComponentId(),
	);
}

/**
 * Start a test from a known, asserted state: clean form, logged out, Home page at the
 * empty hash. The page is not reloaded between the tests of a spec file, so model state
 * and the current route of the previous test would otherwise leak into the next one.
 */
export async function startAtHome(): Promise<void> {
	// A dirty form would make the leave guard block the navigation away from Protected.
	await setDirtyState(false);
	await resetAuth();
	// Not from the empty hash: the browser would add an entry without a hash change. UI5's History
	// has no state for such an entry and misreads the direction of later steps through it.
	if ((await browser.execute(() => window.location.hash)) !== "") {
		await browser.url("#");
	}
	await expectHashToBe("", "Hash should be empty after navigating home");
	await waitForPage(CONTROLS.home.homePage, "Home");
	await expectControlText(CONTROLS.home.authStatus, "Logged Out");
}

/** Press the login toggle on Home and assert the auth state it has to lead to. */
export async function toggleLogin(expected: "Logged In" | "Logged Out"): Promise<void> {
	await press(CONTROLS.home.toggleLoginBtn);
	await expectControlText(CONTROLS.home.authStatus, expected);
}

/** From Home, logged out: log in, press "Go to Protected Page" and assert that the navigation committed. */
export async function loginAndGoToProtected(): Promise<void> {
	await toggleLogin("Logged In");
	const afterRevision = await getRuntimeSettlementRevision();
	await press(CONTROLS.home.navProtectedBtn);
	await waitForPage(CONTROLS.protected.protectedPage, "Protected Page", { afterRevision });
	await waitForRuntimeSettlement({ status: "committed", route: "protected", hash: "protected" }, { afterRevision });
	await expectHashToBe("#/protected");
}

/**
 * Assert that the navigation started after `afterRevision` did not leave Home: the guard
 * settled it with `status`, and the hash is empty. Home and the empty hash are also the
 * starting state, so the fresh settlement is what proves that the navigation ran.
 */
export async function expectKeptOnHome(
	status: "redirected" | "blocked",
	afterRevision: number,
	timeout?: number,
): Promise<void> {
	await waitForRuntimeSettlement({ status, route: "home", hash: "" }, { afterRevision, timeout });
	await expectHashToBe("", `Hash should be empty after the navigation settled as ${status}`);
	await waitForPage(CONTROLS.home.homePage, "Home");
}

/** On Protected: press the Page nav button and assert that the navigation to Home committed. */
export async function navBackToHome(): Promise<void> {
	const settlementRevision = await getRuntimeSettlementRevision();
	await fireEvent(CONTROLS.protected.protectedPage, "navButtonPress");

	await waitForPage(CONTROLS.home.homePage, "Home", { afterRevision: settlementRevision });
	await waitForRuntimeSettlement(
		{ status: "committed", route: "home", hash: "" },
		{ afterRevision: settlementRevision },
	);
	await expectHashToBe("");
}
