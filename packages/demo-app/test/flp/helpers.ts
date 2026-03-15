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
	await browser.goTo({ sHash: "" });
	try {
		await waitForPage("homePage", "Home", 5000);
	} catch {
		await navigateHomeWithinApp();
		await waitForPage("homePage", "Home");
	}
}

export async function resetFlpDemo(): Promise<void> {
	await launchFlpApp();
	await resetDirtyState();

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
 * Intercept window.confirm so the dirty-state prompt is captured
 * synchronously, then trigger FLP cross-app navigation.
 *
 * Headless Chrome auto-answers confirm() before WebDriver can see the
 * alert, so polling isAlertOpen() is unreliable. Monkey-patching
 * confirm() captures the call in the same JS tick and returns false
 * (simulating "Cancel" / stay on the page).
 */
export async function triggerFlpCrossAppNavigationAndExpectDirtyPrompt(): Promise<void> {
	const result = await browser.execute(() => {
		let confirmCalled = false;
		const originalConfirm = window.confirm;
		window.confirm = (_message?: string): boolean => {
			confirmCalled = true;
			window.confirm = originalConfirm;
			return false;
		};

		const Container = sap.ui.require("sap/ushell/Container");
		const navService = Container?.getService("CrossApplicationNavigation");

		if (!navService?.toExternal) {
			window.confirm = originalConfirm;
			return { triggered: false, confirmCalled: false };
		}

		navService.toExternal({ target: { shellHash: "Shell-home" } });
		return { triggered: true, confirmCalled };
	});

	if (!result.triggered) {
		throw new Error("FLP CrossApplicationNavigation service was not available");
	}
	if (!result.confirmCalled) {
		throw new Error(
			"FLP dirty-state provider did not call window.confirm — registerDirtyStateProvider may not have fired",
		);
	}
}

export async function waitForProtectedPageInFlp(): Promise<void> {
	await waitForPage("protectedPage", "Protected Page");
}
