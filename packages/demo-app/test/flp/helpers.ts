/// <reference types="@wdio/globals/types" />

import { fireEvent, resetAuth, setDirtyState, waitForPage } from "../e2e/helpers";

const HOME_PAGE_ID = "container-demo.app---homeView--homePage";
const PROTECTED_PAGE_ID = "container-demo.app---protectedView--protectedPage";

export async function launchFlpApp(): Promise<void> {
	await browser.url(browser.options.baseUrl as string);
	await waitForPage(HOME_PAGE_ID, "Home", 30000);
}

export async function resetFlpDemo(): Promise<void> {
	await launchFlpApp();
	await resetAuth();
	await setDirtyState(false);
}

export async function loginAndGoToProtectedInFlp(): Promise<void> {
	await fireEvent("container-demo.app---homeView--toggleLoginBtn", "press");
	await fireEvent("container-demo.app---homeView--navProtectedBtn", "press");
	await waitForPage(PROTECTED_PAGE_ID, "Protected Page");
}

export async function expectControlText(controlId: string, expected: string): Promise<void> {
	const control = await browser.asControl({
		selector: { id: controlId },
		forceSelect: true,
	});

	expect(await control.getProperty("text")).toBe(expected);
}

export async function clickFlpHomeButton(): Promise<void> {
	const result = await browser.execute(() => {
		const candidates = Array.from(document.querySelectorAll<HTMLElement>("button,[role='button']"));
		const labels = candidates.map((candidate) => {
			return [
				candidate.getAttribute("aria-label"),
				candidate.getAttribute("aria-description"),
				candidate.getAttribute("title"),
				candidate.textContent,
			]
				.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
				.join(" | ");
		});

		const match = candidates.find((candidate, index) => {
			return /navigate to home|sap logo/i.test(labels[index]);
		});

		if (!match) {
			return { clicked: false, labels };
		}

		match.click();
		return { clicked: true, labels };
	});

	if (!result.clicked) {
		throw new Error(`FLP home button not found. Candidates: ${result.labels.join(" || ")}`);
	}
}

export async function waitForDirtyStatePrompt(): Promise<void> {
	await browser.waitUntil(
		async () => {
			return browser.isAlertOpen();
		},
		{
			timeout: 5000,
			timeoutMsg: "FLP dirty-state confirmation dialog did not open",
		},
	);
}

export async function waitForProtectedPageInFlp(): Promise<void> {
	await waitForPage(PROTECTED_PAGE_ID, "Protected Page");
}
