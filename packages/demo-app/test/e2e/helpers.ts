/**
 * E2E test helpers for the demo app.
 *
 * These helpers run in the browser context via wdi5's browser.execute().
 * They access UI5 internals directly because:
 * 1. wdi5's control resolution has quirks (e.g., picking up sub-elements)
 * 2. We need to check router state that isn't exposed through the DOM
 * 3. We need to manipulate model state without UI interaction
 */

/** Component ID used throughout the demo app */
const COMPONENT_ID = "container-demo.app";

/**
 * Wait for a UI5 Page control to be available, have the expected title,
 * AND be currently visible with navigation fully settled.
 *
 * Uses browser.execute with Element.getElementById() directly to avoid
 * wdi5's control resolution incorrectly picking up sub-elements (e.g. navButton).
 *
 * Combines two checks to handle all edge cases:
 * 1. DOM visibility - ensures page is rendered and not hidden by NavContainer
 * 2. Router state - ensures async guards have completed and navigation is settled
 *
 * Note: The router state check uses an internal property (_pendingHash) because
 * there's no public API to detect when async guard evaluation completes. This is
 * acceptable for E2E tests and is documented here for maintainability.
 */
export async function waitForPage(controlId: string, expectedTitle: string, timeout = 10000): Promise<void> {
	await browser.waitUntil(
		async () => {
			return browser.execute(
				(id: string, title: string, componentId: string) => {
					const Element = sap.ui.require("sap/ui/core/Element");
					const control = Element?.getElementById(id);
					if (control?.getTitle?.() !== title) {
						return false;
					}

					// Check 1: Verify the control is rendered and visible in the DOM.
					// This prevents false positives from cached views that are hidden.
					const domRef = control?.getDomRef?.();
					if (!domRef) {
						return false;
					}

					// NavContainer hides non-current pages with display:none.
					// Check computed style as a reliable visibility test.
					const style = window.getComputedStyle(domRef);
					if (style.display === "none" || style.visibility === "hidden") {
						return false;
					}

					// Check 2: Verify the router's navigation has fully settled.
					// This ensures async guards have completed, preventing race conditions
					// where the page is visible but subsequent operations fail because
					// navigation is still in progress internally.
					// Note: _pendingHash is internal to GuardRouter. No public API exists
					// to check if async guards are still evaluating.
					const Component = sap.ui.require("sap/ui/core/Component");
					const router = Component?.getComponentById(componentId)?.getRouter();
					if (router?._pendingHash !== null) {
						return false;
					}

					return true;
				},
				controlId,
				expectedTitle,
				COMPONENT_ID,
			);
		},
		{ timeout, timeoutMsg: `Page "${controlId}" did not show title "${expectedTitle}" within ${timeout}ms` },
	);
}

/**
 * Fire an event on a UI5 control by ID, bypassing wdi5's control resolution.
 */
export async function fireEvent(controlId: string, eventName: string): Promise<void> {
	await browser.execute(
		(id: string, evt: string) => {
			const Element = sap.ui.require("sap/ui/core/Element");
			Element?.getElementById(id)?.fireEvent(evt);
		},
		controlId,
		eventName,
	);
}

/**
 * Reset the auth model to logged-out state.
 *
 * browser.goTo({ sHash: "" }) only performs a hash navigation and does NOT
 * reload the page, so in-memory JSONModel state persists across tests within
 * the same spec file. Call this at the start of any test that requires a
 * known auth state.
 */
export async function resetAuth(): Promise<void> {
	await browser.execute((componentId: string) => {
		const Component = sap.ui.require("sap/ui/core/Component");
		Component?.getComponentById(componentId)?.getModel("auth")?.setProperty("/isLoggedIn", false);
	}, COMPONENT_ID);
}

/**
 * Wait for the URL hash to settle to an expected value, then assert it.
 */
export async function expectHashToBe(expected: string, timeoutMsg?: string): Promise<void> {
	await browser.waitUntil(
		async () => {
			const hash = await browser.execute(() => window.location.hash);
			return hash === expected;
		},
		{ timeout: 3000, timeoutMsg: timeoutMsg ?? `Hash did not settle to ${expected}` },
	);
}

/**
 * Set the dirty state by updating the form model property directly.
 *
 * The form model is owned by the Component (not the view) and inherited by views.
 * Avoids relying on CheckBox internals or two-way binding propagation.
 */
export async function setDirtyState(isDirty: boolean): Promise<void> {
	await browser.execute(
		(dirty: boolean, componentId: string) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			Component?.getComponentById(componentId)?.getModel("form")?.setProperty("/isDirty", dirty);
		},
		isDirty,
		COMPONENT_ID,
	);
}
