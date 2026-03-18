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
	settlementStatus: {
		selector: {
			id: /^settlementStatus$/,
			viewName: "demo.app.view.Protected",
			controlType: "sap.m.ObjectStatus",
		},
		forceSelect: true,
	},
	settlementRouteText: {
		selector: {
			id: /^settlementRouteText$/,
			viewName: "demo.app.view.Protected",
			controlType: "sap.m.Text",
		},
		forceSelect: true,
	},
	settlementHashText: {
		selector: {
			id: /^settlementHashText$/,
			viewName: "demo.app.view.Protected",
			controlType: "sap.m.Text",
		},
		forceSelect: true,
	},
	settlementHashTechnicalText: {
		selector: {
			id: /^settlementHashTechnicalText$/,
			viewName: "demo.app.view.Protected",
			controlType: "sap.m.Text",
		},
		forceSelect: true,
	},
} as const satisfies Record<string, wdi5Selector>;

type SelectorName = keyof typeof SELECTORS;

type PageWaitOptions = {
	timeout?: number;
	afterRevision?: number;
};

type AppHashWaitOptions = {
	timeout?: number;
	afterRevision?: number;
};

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

export async function getRuntimeSettlementRevisionInFlp(): Promise<number> {
	return browser.execute(() => {
		const Component = sap.ui.require("sap/ui/core/Component");
		const all = Component.registry.all() as Record<string, UIComponent>;
		const component = Object.values(all).find((c) => c.getManifestEntry("sap.app")?.id === "demo.app");
		return Number(component?.getModel("runtime")?.getProperty("/lastSettlementRevision") ?? 0);
	});
}

async function waitForPage(
	name: "homePage" | "protectedPage",
	expectedTitle: string,
	options: PageWaitOptions = {},
): Promise<void> {
	const { timeout = 30000, afterRevision } = options;

	if (afterRevision !== undefined) {
		await browser.waitUntil(async () => (await getRuntimeSettlementRevisionInFlp()) > afterRevision, {
			timeout,
			timeoutMsg: `Page "${name}" did not observe a fresh settlement after revision ${afterRevision}`,
		});
	}

	await browser.waitUntil(
		async () => {
			try {
				const page = await getControl(name);
				if ((await page.getProperty("title")) !== expectedTitle) {
					return false;
				}

				return browser.execute((selectorName: string) => {
					const Element = sap.ui.require("sap/ui/core/Element");
					const controlId =
						selectorName === "homePage"
							? "application-app-preview-component---homeView--homePage"
							: "application-app-preview-component---protectedView--protectedPage";
					const control = Element?.getElementById(controlId);
					const domRef = control?.getDomRef?.();
					if (!domRef) {
						return false;
					}

					const style = window.getComputedStyle(domRef);
					return style.display !== "none" && style.visibility !== "hidden";
				}, name);
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

async function isDemoAppMounted(): Promise<boolean> {
	return browser.execute(() => {
		const Component = sap.ui.require("sap/ui/core/Component");
		const all = Component?.registry?.all?.() as Record<string, UIComponent> | undefined;
		return Object.values(all ?? {}).some((component) => component.getManifestEntry("sap.app")?.id === "demo.app");
	});
}

export async function launchFlpApp(): Promise<void> {
	// CDM-based FLP preview (enhancedHomePage) takes longer to bootstrap
	// than sandbox.js mode. Wait for the demo component to mount before
	// proceeding. If it never mounts, the test is likely running after a
	// cross-app navigation that left the sandbox unrecoverable.
	await browser.waitUntil(() => isDemoAppMounted(), {
		timeout: 15000,
		timeoutMsg:
			"Demo component did not mount. If this follows a cross-app navigation (toExternal), " +
			"move the test to a separate spec file so it gets its own browser session.",
	});

	// We're in the app context: clear dirty state to unblock leave guards, then navigate home
	await resetDirtyState();
	await navigateToRouteInFlp("home");
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

	const settlementRevision = await getRuntimeSettlementRevisionInFlp();
	const navigateProtectedButton = await getControl("navigateProtectedButton");
	await navigateProtectedButton.press();
	await waitForPage("protectedPage", "Protected Page", { afterRevision: settlementRevision });
}

export async function setDirtyStateInFlp(isDirty: boolean): Promise<void> {
	const dirtyCheckbox = await getControl("dirtyCheckbox");
	const selected = (await dirtyCheckbox.getProperty("selected")) === true;

	if (selected !== isDirty) {
		await dirtyCheckbox.press();
	}
}

export async function pressToggleLoginInFlp(): Promise<void> {
	const toggleLoginButton = await getControl("toggleLoginButton");
	await toggleLoginButton.press();
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

// ---------------------------------------------------------------------------
// Dialog helpers: WDIO v9 native dialog API (browser.on('dialog'))
//
// WDIO v9 auto-dismisses native dialogs (confirm/alert/prompt) unless a
// listener is registered. The dialog API intercepts at the WebDriver BiDi
// protocol level, before the browser auto-resolves the dialog.
// ---------------------------------------------------------------------------

type DialogRecord = {
	called: boolean;
	handled: boolean;
	message: string;
	type: string;
};

/**
 * Register a dialog handler that records whether a dialog was shown and
 * responds with the given value. Returns a cleanup function and a record
 * object that tracks dialog calls.
 *
 * Call before the action that triggers the dialog.
 */
export function installDialogHandler(accept: boolean): { record: DialogRecord; cleanup: () => void } {
	const record: DialogRecord = { called: false, handled: false, message: "", type: "" };

	const handler = async (dialog: WebdriverIO.Dialog): Promise<void> => {
		record.called = true;
		record.message = dialog.message();
		record.type = dialog.type();

		if (accept) {
			await dialog.accept();
		} else {
			await dialog.dismiss();
		}

		record.handled = true;
	};

	browser.on("dialog", handler);

	return {
		record,
		cleanup: () => {
			browser.off("dialog", handler);
		},
	};
}

/**
 * Trigger cross-app navigation via FLP's CrossApplicationNavigation service.
 * Does not install a dialog handler. Callers handle dialogs separately.
 */
export async function triggerFlpCrossAppNavigation(): Promise<void> {
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
}

/**
 * Trigger cross-app navigation and assert that the FLP dirty-state provider
 * fires a confirm dialog. The dialog is dismissed (user cancels), so the
 * app stays on the current page.
 */
export async function triggerFlpCrossAppNavigationAndExpectDirtyPrompt(): Promise<void> {
	const { record, cleanup } = installDialogHandler(false);
	const appHashBefore = await browser.execute(() => {
		const HashChanger = sap.ui.require("sap/ui/core/routing/HashChanger");
		return String(HashChanger?.getInstance()?.getHash() ?? "");
	});

	try {
		await triggerFlpCrossAppNavigation();

		await browser.waitUntil(() => record.called && record.handled, {
			timeout: 5000,
			timeoutMsg:
				"FLP dirty-state provider did not trigger and resolve a confirm dialog - registerDirtyStateProvider may not have fired",
		});

		await expectAppHashToBe(appHashBefore);
	} finally {
		cleanup();
	}
}

export async function waitForProtectedPageInFlp(options?: PageWaitOptions): Promise<void> {
	await waitForPage("protectedPage", "Protected Page", options);
}

export async function waitForHomePageInFlp(options?: PageWaitOptions): Promise<void> {
	await waitForPage("homePage", "Home", options);
}

/**
 * Navigate to a route programmatically via the demo app's router.
 */
export async function navigateToRouteInFlp(routeName: string): Promise<void> {
	const navigated = await browser.execute((route: string) => {
		const Component = sap.ui.require("sap/ui/core/Component");
		const all = Component.registry.all() as Record<string, UIComponent>;
		const component = Object.values(all).find((c) => c.getManifestEntry("sap.app")?.id === "demo.app");
		if (!component) return false;

		component.getRouter().navTo(route, {}, undefined, true);
		return true;
	}, routeName);

	if (!navigated) {
		throw new Error(`Demo router was not available to navigate to "${routeName}"`);
	}
}

/**
 * Wait for the app-specific hash fragment to settle to the expected value.
 *
 * In FLP, `window.location.hash` includes the shell intent (e.g.
 * "#app-preview&/protected"). `HashChanger.getInstance().getHash()` is the
 * public UI5 API that returns only the app-specific portion ("protected").
 * The ShellNavigationHashChanger overrides this method to split shell hash
 * from app hash automatically.
 */
export async function expectAppHashToBe(expected: string, options: AppHashWaitOptions = {}): Promise<void> {
	const { timeout = 5000, afterRevision } = options;

	await browser.waitUntil(
		async () => {
			const hashMatches = await browser.execute((exp: string) => {
				const HashChanger = sap.ui.require("sap/ui/core/routing/HashChanger");
				const hash = HashChanger?.getInstance()?.getHash() ?? "";
				return hash === exp;
			}, expected);

			if (!hashMatches) {
				return false;
			}

			return afterRevision === undefined || (await getRuntimeSettlementRevisionInFlp()) > afterRevision;
		},
		{
			timeout,
			timeoutMsg: `App hash did not settle to "${expected}"${afterRevision === undefined ? "" : ` after revision ${afterRevision}`}`,
		},
	);
}
