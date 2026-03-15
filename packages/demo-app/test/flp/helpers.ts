import type { wdi5Selector } from "wdio-ui5-service";
import type UIComponent from "sap/ui/core/UIComponent";
import type JSONModel from "sap/ui/model/json/JSONModel";

const SELECTORS = {
	homePage: {
		selector: {
			id: /^homePage$/,
			viewName: "demo.app.view.Home",
			controlType: "sap.m.Page",
			interaction: "root",
		},
		forceSelect: true,
	},
	protectedPage: {
		selector: {
			id: /^protectedPage$/,
			viewName: "demo.app.view.Protected",
			controlType: "sap.m.Page",
			interaction: "root",
		},
		forceSelect: true,
	},
	toggleLoginButton: {
		selector: {
			id: /^toggleLoginBtn$/,
			viewName: "demo.app.view.Home",
			controlType: "sap.m.Button",
		},
		forceSelect: true,
	},
	navigateProtectedButton: {
		selector: {
			id: /^navProtectedBtn$/,
			viewName: "demo.app.view.Home",
			controlType: "sap.m.Button",
		},
		forceSelect: true,
	},
	authStatus: {
		selector: {
			id: /^authStatus$/,
			viewName: "demo.app.view.Home",
			controlType: "sap.m.ObjectStatus",
		},
		forceSelect: true,
	},
	dirtyCheckbox: {
		selector: {
			id: /^dirtyCheckbox$/,
			viewName: "demo.app.view.Protected",
			controlType: "sap.m.CheckBox",
		},
		forceSelect: true,
	},
	launchModeText: {
		selector: {
			id: /^launchModeText$/,
			viewName: "demo.app.view.Home",
			controlType: "sap.m.Text",
		},
		forceSelect: true,
	},
	ushellStatus: {
		selector: {
			id: /^ushellStatus$/,
			viewName: "demo.app.view.Home",
			controlType: "sap.m.ObjectStatus",
		},
		forceSelect: true,
	},
	flpDirtyProviderStatus: {
		selector: {
			id: /^flpDirtyProviderStatus$/,
			viewName: "demo.app.view.Home",
			controlType: "sap.m.ObjectStatus",
		},
		forceSelect: true,
	},
	protectedFlpDirtyProviderStatus: {
		selector: {
			id: /^protectedFlpDirtyProviderStatus$/,
			viewName: "demo.app.view.Protected",
			controlType: "sap.m.ObjectStatus",
		},
		forceSelect: true,
	},
	protectedCurrentHashText: {
		selector: {
			id: /^protectedCurrentHashText$/,
			viewName: "demo.app.view.Protected",
			controlType: "sap.m.Text",
		},
		forceSelect: true,
	},
} as const satisfies Record<string, wdi5Selector>;

type SelectorName = keyof typeof SELECTORS;

async function getControl(name: SelectorName) {
	return browser.asControl(SELECTORS[name]);
}

async function waitForControlText(name: SelectorName, expected: string, timeout = 5000): Promise<void> {
	await browser.waitUntil(
		async () => {
			try {
				const control = await getControl(name);
				return (await control.getProperty("text")) === expected;
			} catch {
				return false;
			}
		},
		{
			timeout,
			timeoutMsg: `Control "${name}" did not expose text "${expected}"`,
		},
	);
}

async function waitForPage(name: "homePage" | "protectedPage", expectedTitle: string, timeout = 30000): Promise<void> {
	await browser.waitUntil(
		async () => {
			try {
				const page = await getControl(name);
				return (await page.getProperty("title")) === expectedTitle;
			} catch {
				return false;
			}
		},
		{
			timeout,
			timeoutMsg: `Page "${name}" did not show title "${expectedTitle}"`,
		},
	);
}

async function navigateHomeWithinApp(): Promise<void> {
	const navigated = await browser.execute(() => {
		const Component = sap.ui.require("sap/ui/core/Component");
		const all = Component.registry.all() as Record<string, UIComponent>;
		const component = Object.values(all).find((c) => c.getManifestEntry("sap.app")?.id === "demo.app");
		if (!component) return false;

		component.getRouter().navTo("home", {}, undefined, true);
		return true;
	});

	if (!navigated) {
		throw new Error("Demo router was not available to navigate back to home");
	}
}

export async function launchFlpApp(): Promise<void> {
	const currentHash = await browser.execute(() => window.location.hash);

	if (!currentHash.includes("app-preview")) {
		// We're outside the app (e.g. at Shell-home after cross-app navigation).
		// The FLP preview sandbox and wdi5 do not reliably recover from a
		// mid-session page reload. Tests that navigate away from the app
		// must live in their own spec file (see flp-cross-app.e2e.ts).
		throw new Error(
			`Cannot reset FLP app from hash "${currentHash}". ` +
				"Move this test to a separate spec file (like flp-cross-app.e2e.ts) so it gets its own browser session.",
		);
	}

	// We're in the app context: clear dirty state to unblock leave guards, then navigate home
	await resetDirtyState();
	await navigateHomeWithinApp();
	await waitForPage("homePage", "Home");
}

export async function resetFlpDemo(): Promise<void> {
	await launchFlpApp();

	const authStatus = await getControl("authStatus");
	if ((await authStatus.getProperty("text")) === "Logged In") {
		const toggleLoginButton = await getControl("toggleLoginButton");
		await toggleLoginButton.press();
		await waitForControlText("authStatus", "Logged Out");
	}
}

export async function loginAndGoToProtectedInFlp(): Promise<void> {
	const toggleLoginButton = await getControl("toggleLoginButton");
	await toggleLoginButton.press();
	await waitForControlText("authStatus", "Logged In");

	const navigateProtectedButton = await getControl("navigateProtectedButton");
	await navigateProtectedButton.press();
	await waitForPage("protectedPage", "Protected Page");
}

export async function setDirtyStateInFlp(isDirty: boolean): Promise<void> {
	const dirtyCheckbox = await getControl("dirtyCheckbox");
	const selected = (await dirtyCheckbox.getProperty("selected")) === true;

	if (selected !== isDirty) {
		await dirtyCheckbox.press();
	}
}

export async function expectControlText(name: SelectorName, expected: string): Promise<void> {
	await waitForControlText(name, expected);
}

async function resetDirtyState(): Promise<void> {
	await browser.execute(() => {
		const Component = sap.ui.require("sap/ui/core/Component");
		const all = Component.registry.all() as Record<string, UIComponent>;
		const component = Object.values(all).find((c) => c.getManifestEntry("sap.app")?.id === "demo.app");
		(component?.getModel("form") as JSONModel | undefined)?.setProperty("/isDirty", false);
	});
}

/**
 * Intercept window.confirm, trigger FLP cross-app navigation, then
 * verify the dirty-state provider fired.
 *
 * Headless Chrome returns false for confirm() by default, so the
 * navigation would be cancelled without an intercept. The monkey-patch
 * captures the call (proving the provider fired) and returns false
 * (same as headless default, but now we can assert it was called).
 *
 * toExternal() schedules navigation asynchronously: the FLP's
 * _handleDataLoss filter runs on the next hash change, not in the
 * same tick. So we install the intercept, trigger navigation, then
 * poll for the flag in a separate execute.
 */
export async function triggerFlpCrossAppNavigationAndExpectDirtyPrompt(): Promise<void> {
	// Step 1: install the confirm intercept (stays active until explicitly restored)
	await browser.execute(() => {
		const w = window as Window & { __flpConfirmCalled?: boolean; __flpOriginalConfirm?: typeof confirm };
		w.__flpConfirmCalled = false;
		w.__flpOriginalConfirm = window.confirm;
		window.confirm = (_message?: string): boolean => {
			w.__flpConfirmCalled = true;
			return false;
		};
	});

	try {
		// Step 2: trigger cross-app navigation
		const triggered = await browser.execute(() => {
			const Container = sap.ui.require("sap/ushell/Container");
			const navService = Container?.getService("CrossApplicationNavigation");
			if (!navService?.toExternal) return false;

			navService.toExternal({ target: { shellHash: "Shell-home" } });
			return true;
		});

		if (!triggered) {
			throw new Error("FLP CrossApplicationNavigation service was not available");
		}

		// Step 3: wait for the dirty-state provider to call confirm()
		await browser.waitUntil(
			async () => {
				return browser.execute(() => {
					return (window as Window & { __flpConfirmCalled?: boolean }).__flpConfirmCalled === true;
				});
			},
			{
				timeout: 5000,
				timeoutMsg:
					"FLP dirty-state provider did not call window.confirm - registerDirtyStateProvider may not have fired",
			},
		);
	} finally {
		// Always restore original confirm, even if steps 2-3 fail
		await browser.execute(() => {
			const w = window as Window & { __flpOriginalConfirm?: typeof confirm };
			if (w.__flpOriginalConfirm) {
				window.confirm = w.__flpOriginalConfirm;
				delete w.__flpOriginalConfirm;
			}
		});
	}
}

export async function waitForProtectedPageInFlp(): Promise<void> {
	await waitForPage("protectedPage", "Protected Page");
}
