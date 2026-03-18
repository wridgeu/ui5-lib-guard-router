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

type SettlementSnapshot = {
	status?: string;
	route?: string;
	hash?: string;
} | null;

type RuntimeSettlementSnapshot = {
	status: string;
	route: string;
	hash: string;
	revision: number;
};

type RuntimeSettlementExpectation = {
	status: string;
	route?: string;
	hash?: string;
};

type RuntimeSettlementWaitOptions = {
	timeout?: number;
	afterRevision?: number;
};

type SettlementWaitResult = {
	ok: boolean;
	result: SettlementSnapshot;
	message: string | null;
};

/**
 * Wait for a UI5 Page control to be available, have the expected title,
 * AND be currently visible with navigation fully settled.
 *
 * Uses browser.execute with Element.getElementById() directly to avoid
 * wdi5's control resolution incorrectly picking up sub-elements (e.g. navButton).
 *
 * Runs in two phases:
 * 1. Settlement: calls `router.navigationSettled()` to wait for the guard
 *    pipeline to finish.
 * 2. DOM visibility: polls until the page control is rendered and visible
 *    (not hidden by NavContainer's display:none on inactive pages).
 */
export async function waitForPage(controlId: string, expectedTitle: string, timeout = 10000): Promise<void> {
	// Phase 1: Wait for the guard pipeline to settle.
	const settlement = (await browser.executeAsync(
		(componentId: string, timeoutMs: number, done: (result: SettlementWaitResult) => void) => {
			let finished = false;

			const finish = (result: SettlementWaitResult) => {
				if (finished) {
					return;
				}
				finished = true;
				window.clearTimeout(timer);
				done(result);
			};

			const formatError = (error: unknown): string => {
				if (error instanceof Error) {
					return error.message;
				}
				return String(error);
			};

			const timer = window.setTimeout(() => {
				finish({
					ok: false,
					result: null,
					message: `Timed out after ${timeoutMs}ms waiting for router.navigationSettled()`,
				});
			}, timeoutMs);

			try {
				const Component = sap.ui.require("sap/ui/core/Component");
				if (!Component?.getComponentById) {
					finish({
						ok: false,
						result: null,
						message: "sap/ui/core/Component is unavailable in the browser context",
					});
					return;
				}

				const component = Component.getComponentById(componentId);
				if (!component?.getRouter) {
					finish({
						ok: false,
						result: null,
						message: `Component "${componentId}" was not found or does not expose getRouter()`,
					});
					return;
				}

				const router = component.getRouter();
				if (!router) {
					finish({
						ok: false,
						result: null,
						message: `Router was not found for component "${componentId}"`,
					});
					return;
				}

				if (typeof router.navigationSettled !== "function") {
					finish({
						ok: false,
						result: null,
						message: "Router does not expose navigationSettled(); the public settlement API is unavailable",
					});
					return;
				}

				router.navigationSettled().then(
					(result: SettlementSnapshot) => finish({ ok: true, result, message: null }),
					(error: unknown) => {
						finish({
							ok: false,
							result: null,
							message: `router.navigationSettled() rejected: ${formatError(error)}`,
						});
					},
				);
			} catch (error: unknown) {
				finish({
					ok: false,
					result: null,
					message: `Failed to wait for router settlement: ${formatError(error)}`,
				});
			}
		},
		COMPONENT_ID,
		timeout,
	)) as SettlementWaitResult;

	if (!settlement.ok) {
		throw new Error(
			`waitForPage(${controlId}) could not confirm navigation settlement before checking "${expectedTitle}": ${settlement.message}`,
		);
	}

	// Phase 2: Poll until the page control is rendered and visible.
	await browser.waitUntil(
		async () => {
			return browser.execute(
				(id: string, title: string) => {
					const Element = sap.ui.require("sap/ui/core/Element");
					const control = Element?.getElementById(id);
					if (control?.getTitle?.() !== title) {
						return false;
					}

					const domRef = control?.getDomRef?.();
					if (!domRef) {
						return false;
					}

					// NavContainer hides non-current pages with display:none.
					const style = window.getComputedStyle(domRef);
					if (style.display === "none" || style.visibility === "hidden") {
						return false;
					}

					return true;
				},
				controlId,
				expectedTitle,
			);
		},
		{
			timeout,
			timeoutMsg: `Page "${controlId}" did not show title "${expectedTitle}" within ${timeout}ms after navigation settled to ${settlement.result?.status ?? "unknown"} (route: ${settlement.result?.route ?? "unknown"}, hash: ${settlement.result?.hash ?? "unknown"})`,
		},
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

async function getRuntimeSettlement(): Promise<RuntimeSettlementSnapshot> {
	return browser.execute((componentId: string) => {
		const Component = sap.ui.require("sap/ui/core/Component");
		const runtimeModel = Component?.getComponentById(componentId)?.getModel("runtime");

		return {
			status: String(runtimeModel?.getProperty("/lastSettlementStatus") ?? ""),
			route: String(runtimeModel?.getProperty("/lastSettlementRoute") ?? ""),
			hash: String(runtimeModel?.getProperty("/lastSettlementHash") ?? ""),
			revision: Number(runtimeModel?.getProperty("/lastSettlementRevision") ?? 0),
		};
	}, COMPONENT_ID) as Promise<RuntimeSettlementSnapshot>;
}

export async function getRuntimeSettlementRevision(): Promise<number> {
	const settlement = await getRuntimeSettlement();
	return settlement.revision;
}

function formatRuntimeSettlementExpectation(expected: RuntimeSettlementExpectation): string {
	return Object.entries(expected)
		.map(([key, value]) => `${key}=${String(value)}`)
		.join(", ");
}

export async function waitForRuntimeSettlement(
	expected: RuntimeSettlementExpectation,
	options: RuntimeSettlementWaitOptions = {},
): Promise<RuntimeSettlementSnapshot> {
	const { timeout = 3000, afterRevision } = options;

	await browser.waitUntil(
		async () => {
			const settlement = await getRuntimeSettlement();
			const matchesExpected = Object.entries(expected).every(([key, value]) => {
				return settlement[key as keyof RuntimeSettlementSnapshot] === value;
			});

			if (!matchesExpected) {
				return false;
			}

			return afterRevision === undefined || settlement.revision > afterRevision;
		},
		{
			timeout,
			timeoutMsg: `Runtime settlement did not reach ${formatRuntimeSettlementExpectation(expected)} within ${timeout}ms${afterRevision === undefined ? "" : ` after revision ${afterRevision}`}`,
		},
	);

	return getRuntimeSettlement();
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
