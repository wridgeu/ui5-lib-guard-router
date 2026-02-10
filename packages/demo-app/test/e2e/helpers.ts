/**
 * Wait for a UI5 Page control to be available, have the expected title,
 * AND be the currently displayed page in the App container.
 *
 * Uses browser.execute with Element.getElementById() directly to avoid
 * wdi5's control resolution incorrectly picking up sub-elements (e.g. navButton).
 *
 * Also verifies that the Router's navigation has completed (pendingHash is null)
 * to avoid race conditions with cached views from previous navigations.
 */
export async function waitForPage(controlId: string, expectedTitle: string, timeout = 10000): Promise<void> {
	await browser.waitUntil(
		async () => {
			return browser.execute(
				(id: string, title: string) => {
					const Element = sap.ui.require("sap/ui/core/Element");
					const control = Element?.getElementById(id);
					if ((control as any)?.getTitle?.() !== title) {
						return false;
					}

					// Also check that the Router's navigation has completed
					const Component = sap.ui.require("sap/ui/core/Component");
					const component = Component?.registry?.get("container-demo.app");
					const router = component?.getRouter() as any;

					// pendingHash being null means the navigation has settled
					// (either committed or blocked - but the page title check ensures committed)
					if (router?._pendingHash !== null) {
						return false;
					}

					return true;
				},
				controlId,
				expectedTitle,
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
 * browser.goTo({ sHash: "" }) only performs a hash navigation and does NOT
 * reload the page, so in-memory JSONModel state persists across tests within
 * the same spec file. Call this at the start of any test that requires a
 * known auth state.
 */
export async function resetAuth(): Promise<void> {
	await browser.execute(() => {
		const Component = sap.ui.require("sap/ui/core/Component");
		const component = Component?.registry?.get("container-demo.app");
		if (component) {
			const model = component.getModel("auth") as any;
			if (model) {
				model.setProperty("/isLoggedIn", false);
			}
		}
	});
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
	const hash = await browser.execute(() => window.location.hash);
	expect(hash).toBe(expected);
}

/**
 * Set the dirty state by updating the form model property directly.
 * The form model is owned by the Component (not the view) and inherited by views.
 * Avoids relying on CheckBox internals or two-way binding propagation.
 */
export async function setDirtyState(isDirty: boolean): Promise<void> {
	await browser.execute((dirty: boolean) => {
		const Component = sap.ui.require("sap/ui/core/Component");
		const component = Component?.registry?.get("container-demo.app");
		if (component) {
			const model = component.getModel("form") as any;
			if (model) {
				model.setProperty("/isDirty", dirty);
			}
		}
	}, isDirty);
}

