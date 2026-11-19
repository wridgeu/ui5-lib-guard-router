/**
 * Waits of the standalone suite: for a page to be displayed, for the URL hash, and for a
 * settlement that the demo app's runtime model recorded.
 */

import type { GuardRouter, NavigationResult } from "ui5/guard/router/types";
import { type ControlRef, getAppComponentId, isPageDisplayed } from "../../shared/controls";
import { getRuntimeSettlementRevision, type SettlementWaitOptions } from "../../shared/models";

type RuntimeSettlementSnapshot = {
	status: string;
	route: string;
	hash: string;
	revision: number;
};

type RuntimeSettlementExpectation = {
	status: NavigationResult["status"];
	route?: string;
	hash?: string;
};

type HashWaitOptions = SettlementWaitOptions & {
	timeoutMsg?: string;
};

/**
 * Wait for a UI5 Page control to be available, have the expected title,
 * AND be currently visible with navigation fully settled.
 *
 * Resolves the page through the component (`component.byId(viewId).byId(id)`)
 * in browser.execute, so only app-declared IDs are used and wdi5's control
 * resolution cannot pick up sub-elements (e.g. navButton).
 *
 * Runs in three steps:
 * 1. Settlement: awaits `router.navigationSettled()` until the guard pipeline is done.
 * 2. With `afterRevision`: waits until the runtime model recorded a newer settlement,
 *    so that a settlement from before the action does not count.
 * 3. DOM visibility: polls until the page control is rendered and visible
 *    (not hidden by NavContainer's display:none on inactive pages).
 */
export async function waitForPage(
	page: ControlRef,
	expectedTitle: string,
	timeoutOrOptions: number | SettlementWaitOptions = 10000,
): Promise<void> {
	const timeout = typeof timeoutOrOptions === "number" ? timeoutOrOptions : (timeoutOrOptions.timeout ?? 10000);
	const afterRevision = typeof timeoutOrOptions === "number" ? undefined : timeoutOrOptions.afterRevision;
	const pageName = `${page.viewId}/${page.id}`;

	const settlement = await browser.execute(
		async (componentId: string, timeoutMs: number) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			const router: GuardRouter = Component.getComponentById(componentId).getRouter();
			const timedOut = new Promise<never>((_resolve, reject) => {
				setTimeout(() => {
					reject(new Error(`Timed out after ${timeoutMs}ms waiting for router.navigationSettled()`));
				}, timeoutMs);
			});
			const { status, route, hash } = await Promise.race([router.navigationSettled(), timedOut]);
			return { status, route, hash };
		},
		await getAppComponentId(page.appId),
		timeout,
	);

	if (afterRevision !== undefined) {
		await browser.waitUntil(async () => (await getRuntimeSettlementRevision()) > afterRevision, {
			timeout,
			timeoutMsg: `Page "${pageName}" did not observe a fresh settlement after revision ${afterRevision} within ${timeout}ms`,
		});
	}

	await browser.waitUntil(() => isPageDisplayed(page, expectedTitle), {
		timeout,
		timeoutMsg: `Page "${pageName}" did not show title "${expectedTitle}" within ${timeout}ms after navigation settled to ${settlement.status} (route: ${settlement.route}, hash: ${settlement.hash})`,
	});
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
		.map(([key, value]) => `${key}=${value}`)
		.join(", ");
}

export async function waitForRuntimeSettlement(
	expected: RuntimeSettlementExpectation,
	options: SettlementWaitOptions = {},
): Promise<void> {
	const { timeout = 3000, afterRevision } = options;

	await browser.waitUntil(
		async () => {
			const settlement = await getRuntimeSettlement();
			const matchesExpected = Object.entries(expected).every(([key, value]) => {
				return settlement[key as keyof RuntimeSettlementSnapshot] === value;
			});

			return matchesExpected && (afterRevision === undefined || settlement.revision > afterRevision);
		},
		{
			timeout,
			timeoutMsg: `Runtime settlement did not reach ${formatRuntimeSettlementExpectation(expected)} within ${timeout}ms${afterRevision === undefined ? "" : ` after revision ${afterRevision}`}`,
		},
	);
}
