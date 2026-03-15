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

/**
 * Find the demo app component instance by manifest ID.
 * Runs in browser context via sap.ui.require — used inside browser.execute() callbacks.
 */
function findDemoComponent(): UIComponent | undefined {
	const Component = sap.ui.require("sap/ui/core/Component");
	const all = Component.registry.all() as Record<string, UIComponent>;
	return Object.values(all).find((c) => c.getManifestEntry("sap.app")?.id === "demo.app");
}

async function navigateHomeWithinApp(): Promise<void> {
	const navigated = await browser.execute(() => {
		const component = findDemoComponent();
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
		const component = findDemoComponent();
		(component?.getModel("form") as JSONModel | undefined)?.setProperty("/isDirty", false);
	});
}

export async function triggerHomeNavigationThroughFlp(): Promise<void> {
	const triggered = await browser.execute(() => {
		const Container = sap.ui.require("sap/ushell/Container");
		const navService = Container?.getService("CrossApplicationNavigation");

		if (!navService?.toExternal) {
			return false;
		}

		navService.toExternal({ target: { shellHash: "Shell-home" } });
		return true;
	});

	if (!triggered) {
		throw new Error("FLP CrossApplicationNavigation service was not available");
	}
}

export async function waitForAndDismissDirtyStatePrompt(): Promise<void> {
	let alertSeen = false;

	await browser.waitUntil(
		async () => {
			try {
				if (await browser.isAlertOpen()) {
					alertSeen = true;
					await browser.dismissAlert();
					return true;
				}
			} catch {
				// isAlertOpen saw the alert but dismissAlert found it already gone.
				// Headless Chrome auto-dismisses confirm() dialogs before WebDriver
				// can act on them. The alert was present, so the provider fired.
				if (alertSeen) return true;
			}
			return alertSeen;
		},
		{
			timeout: 5000,
			timeoutMsg:
				"FLP dirty-state confirmation dialog did not appear — registerDirtyStateProvider may not have fired",
		},
	);
}

export async function waitForProtectedPageInFlp(): Promise<void> {
	await waitForPage("protectedPage", "Protected Page");
}
