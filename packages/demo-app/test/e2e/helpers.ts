/**
 * E2E test helpers for the demo app.
 *
 * These helpers run in the browser context via wdi5's browser.execute().
 * They access UI5 internals directly because:
 * 1. wdi5's control resolution has quirks (e.g., picking up sub-elements)
 * 2. We need to check router state that isn't exposed through the DOM
 * 3. We need to manipulate model state without UI interaction
 */

import {
	CONTROLS,
	type ControlRef,
	expectControlText,
	getAppComponentId,
	isPageDisplayed,
	press,
} from "../shared/controls";
import { getRuntimeSettlementRevision, setDirtyState } from "../shared/models";

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

type HashWaitOptions = {
	timeout?: number;
	timeoutMsg?: string;
	afterRevision?: number;
};

type PageWaitOptions = {
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
 * Resolves the page through the component (`component.byId(viewId).byId(id)`)
 * in browser.execute, so only app-declared IDs are used and wdi5's control
 * resolution cannot pick up sub-elements (e.g. navButton).
 *
 * Runs in two phases:
 * 1. Settlement: calls `router.navigationSettled()` to wait for the guard
 *    pipeline to finish.
 * 2. DOM visibility: polls until the page control is rendered and visible
 *    (not hidden by NavContainer's display:none on inactive pages).
 */
export async function waitForPage(
	page: ControlRef,
	expectedTitle: string,
	timeoutOrOptions: number | PageWaitOptions = 10000,
): Promise<void> {
	const timeout = typeof timeoutOrOptions === "number" ? timeoutOrOptions : (timeoutOrOptions.timeout ?? 10000);
	const afterRevision = typeof timeoutOrOptions === "number" ? undefined : timeoutOrOptions.afterRevision;
	const pageName = `${page.viewId}/${page.id}`;
	const componentId = await getAppComponentId(page.appId);

	// Phase 1: Wait for the guard pipeline to settle.
	const settlement = (await browser.executeAsync(
		(compId: string, timeoutMs: number, done: (result: SettlementWaitResult) => void) => {
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

				const component = Component.getComponentById(compId);
				if (!component?.getRouter) {
					finish({
						ok: false,
						result: null,
						message: `Component "${compId}" was not found or does not expose getRouter()`,
					});
					return;
				}

				const router = component.getRouter();
				if (!router) {
					finish({
						ok: false,
						result: null,
						message: `Router was not found for component "${compId}"`,
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
		componentId,
		timeout,
	)) as SettlementWaitResult;

	if (!settlement.ok) {
		throw new Error(
			`waitForPage(${pageName}) could not confirm navigation settlement before checking "${expectedTitle}": ${settlement.message}`,
		);
	}

	if (afterRevision !== undefined) {
		await browser.waitUntil(async () => (await getRuntimeSettlementRevision()) > afterRevision, {
			timeout,
			timeoutMsg: `Page "${pageName}" did not observe a fresh settlement after revision ${afterRevision} within ${timeout}ms`,
		});
	}

	// Phase 2: Poll until the page control is rendered and visible.
	await browser.waitUntil(() => isPageDisplayed(page, expectedTitle), {
		timeout,
		timeoutMsg: `Page "${pageName}" did not show title "${expectedTitle}" within ${timeout}ms after navigation settled to ${settlement.result?.status ?? "unknown"} (route: ${settlement.result?.route ?? "unknown"}, hash: ${settlement.result?.hash ?? "unknown"})`,
	});
}

/**
 * Fire an event on a UI5 control, bypassing wdi5's control resolution. Used for the
 * Page nav button, which is a sub-element without an app-declared ID.
 *
 * Fails if the control does not exist or nothing listens to the event: firing an
 * event without a handler would otherwise be a silent no-op.
 */
export async function fireEvent(control: ControlRef, eventName: string): Promise<void> {
	await browser.execute(
		(compId: string, viewId: string, id: string, evt: string) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			const target = Component.getComponentById(compId).byId(viewId).byId(id);
			if (!target.hasListeners(evt)) {
				throw new Error(`Control "${viewId}/${id}" has no listener for the event "${evt}"`);
			}
			target.fireEvent(evt);
		},
		await getAppComponentId(control.appId),
		control.viewId,
		control.id,
		eventName,
	);
}

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
 * Wait for the URL hash to settle to an expected value, then assert it.
 */
export async function expectHashToBe(expected: string, timeoutMsgOrOptions?: string | HashWaitOptions): Promise<void> {
	const options: HashWaitOptions =
		typeof timeoutMsgOrOptions === "string" ? { timeoutMsg: timeoutMsgOrOptions } : (timeoutMsgOrOptions ?? {});
	const timeout = options.timeout ?? 3000;

	await browser.waitUntil(
		async () => {
			const hash = await browser.execute(() => window.location.hash);
			if (hash !== expected) {
				return false;
			}

			return (
				options.afterRevision === undefined || (await getRuntimeSettlementRevision()) > options.afterRevision
			);
		},
		{
			timeout,
			timeoutMsg:
				options.timeoutMsg ??
				`Hash did not settle to ${expected}${options.afterRevision === undefined ? "" : ` after revision ${options.afterRevision}`}`,
		},
	);
}

async function getRuntimeSettlement(): Promise<RuntimeSettlementSnapshot> {
	return browser.execute(
		(componentId: string) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			const runtimeModel = Component.getComponentById(componentId).getModel("runtime");

			return {
				status: String(runtimeModel.getProperty("/lastSettlementStatus")),
				route: String(runtimeModel.getProperty("/lastSettlementRoute")),
				hash: String(runtimeModel.getProperty("/lastSettlementHash")),
				revision: Number(runtimeModel.getProperty("/lastSettlementRevision")),
			};
		},
		await getAppComponentId(),
	) as Promise<RuntimeSettlementSnapshot>;
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
	let matchedSettlement: RuntimeSettlementSnapshot | null = null;

	await browser.waitUntil(
		async () => {
			const settlement = await getRuntimeSettlement();
			const matchesExpected = Object.entries(expected).every(([key, value]) => {
				return settlement[key as keyof RuntimeSettlementSnapshot] === value;
			});

			if (!matchesExpected) {
				return false;
			}

			if (afterRevision !== undefined && settlement.revision <= afterRevision) {
				return false;
			}

			matchedSettlement = settlement;
			return true;
		},
		{
			timeout,
			timeoutMsg: `Runtime settlement did not reach ${formatRuntimeSettlementExpectation(expected)} within ${timeout}ms${afterRevision === undefined ? "" : ` after revision ${afterRevision}`}`,
		},
	);

	return matchedSettlement ?? getRuntimeSettlement();
}

/**
 * Return current window.history.length from the browser. Chrome caps it at 50 entries:
 * at the cap a new entry no longer changes the length, so the comparison would prove nothing.
 */
export async function getHistoryLength(): Promise<number> {
	const length = await browser.execute(() => window.history.length);
	if (length >= 50) {
		throw new Error(`window.history.length is ${length}: at the browser cap, new entries cannot be observed`);
	}
	return length;
}

/** The position of the current entry in the browser history. */
export function getHistoryEntryIndex(): Promise<number> {
	return browser.execute(() => window.navigation.currentEntry?.index ?? -1);
}

/** Set the browser hash like a user who edits the address bar. */
export async function setBrowserHash(hash: string): Promise<void> {
	await browser.execute((value: string) => {
		window.location.hash = value;
	}, hash);
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
	await waitForRuntimeSettlement({ status: "Committed", route: "protected", hash: "protected" }, { afterRevision });
	await expectHashToBe("#/protected");
}

/**
 * Assert that the navigation started after `afterRevision` did not leave Home: the guard
 * settled it with `status`, and the hash is empty. Home and the empty hash are also the
 * starting state, so the fresh settlement is what proves that the navigation ran.
 */
export async function expectKeptOnHome(
	status: "Redirected" | "Blocked",
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
		{ status: "Committed", route: "home", hash: "" },
		{ afterRevision: settlementRevision },
	);
	await expectHashToBe("");
}
