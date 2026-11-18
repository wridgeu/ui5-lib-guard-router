import type UshellContainer from "sap/ushell/Container";
import { CONTROLS, type ControlRef, expectControlText, getAppComponentId, getControl, press } from "../shared/controls";

type PageWaitOptions = {
	timeout?: number;
	afterRevision?: number;
};

type AppHashWaitOptions = {
	timeout?: number;
	afterRevision?: number;
};

export async function getRuntimeSettlementRevisionInFlp(): Promise<number> {
	return browser.execute(
		(componentId: string) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			return Number(
				Component.getComponentById(componentId).getModel("runtime").getProperty("/lastSettlementRevision"),
			);
		},
		await getAppComponentId(),
	);
}

export async function waitForPageInFlp(
	page: ControlRef,
	expectedTitle: string,
	options: PageWaitOptions = {},
): Promise<void> {
	const { timeout = 30000, afterRevision } = options;
	const name = `${page.viewId}/${page.id}`;

	if (afterRevision !== undefined) {
		await browser.waitUntil(async () => (await getRuntimeSettlementRevisionInFlp()) > afterRevision, {
			timeout,
			timeoutMsg: `Page "${name}" did not observe a fresh settlement after revision ${afterRevision}`,
		});
	}

	await browser.waitUntil(
		async () => {
			try {
				const control = await getControl(page, { interaction: "root" });
				if ((await control.getProperty("title")) !== expectedTitle) {
					return false;
				}

				return browser.execute(
					(componentId: string, viewId: string, id: string) => {
						const Component = sap.ui.require("sap/ui/core/Component");
						const domRef = Component.getComponentById(componentId).byId(viewId).byId(id).getDomRef();
						if (!domRef) {
							return false;
						}

						// Also false for a hidden ancestor: the page of a nested component whose container is hidden.
						return domRef.checkVisibility({ visibilityProperty: true });
					},
					await getAppComponentId(page.appId),
					page.viewId,
					page.id,
				);
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
	return getAppComponentId().then(
		() => true,
		() => false,
	);
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
	await waitForPageInFlp(CONTROLS.home.homePage, "Home");
	await expectAppHashToBe("");
}

/**
 * Start a test from a known, asserted state: clean form, Home page at the empty app
 * hash, logged out. The page is not reloaded between the tests of a spec file.
 */
export async function resetFlpDemo(): Promise<void> {
	await launchFlpApp();

	const authStatus = await getControl(CONTROLS.home.authStatus);
	if ((await authStatus.getProperty("text")) === "Logged In") {
		await press(CONTROLS.home.toggleLoginBtn);
	}
	await expectControlText(CONTROLS.home.authStatus, "Logged Out");
}

/** From Home, logged out: log in, press "Go to Protected Page" and assert that the navigation committed. */
export async function loginAndGoToProtectedInFlp(): Promise<void> {
	await press(CONTROLS.home.toggleLoginBtn);
	await expectControlText(CONTROLS.home.authStatus, "Logged In");

	const settlementRevision = await getRuntimeSettlementRevisionInFlp();
	await press(CONTROLS.home.navProtectedBtn);
	await waitForPageInFlp(CONTROLS.protected.protectedPage, "Protected Page", { afterRevision: settlementRevision });
	await expectAppHashToBe("protected");
}

/** On Protected: set the form state through the checkbox and assert that the page shows it. */
export async function setDirtyStateInFlp(isDirty: boolean): Promise<void> {
	const dirtyCheckbox = await getControl(CONTROLS.protected.dirtyCheckbox);
	const selected = (await dirtyCheckbox.getProperty("selected")) === true;

	if (selected !== isDirty) {
		await press(CONTROLS.protected.dirtyCheckbox);
	}
	await expectControlText(CONTROLS.protected.dirtyStatus, isDirty ? "Form has unsaved changes" : "Form is clean");
}

async function resetDirtyState(): Promise<void> {
	await browser.execute(
		(componentId: string) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			Component.getComponentById(componentId).getModel("form").setProperty("/isDirty", false);
		},
		await getAppComponentId(),
	);
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
 * Trigger cross-app navigation via the FLP Navigation service.
 * Does not install a dialog handler. Callers handle dialogs separately.
 */
export async function triggerFlpCrossAppNavigation(): Promise<void> {
	await browser.execute(async () => {
		const Container: typeof UshellContainer | undefined = sap.ui.require("sap/ushell/Container");
		if (!Container) {
			throw new Error("FLP container is not available");
		}
		const navigation = await Container.getServiceAsync("Navigation");
		// Not awaited: a dirty-state confirm() blocks the page until the caller handles the dialog.
		void navigation.navigate({ target: { shellHash: "Shell-home" } });
	});
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
		return String(HashChanger.getInstance().getHash());
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
	await waitForPageInFlp(CONTROLS.protected.protectedPage, "Protected Page", options);
}

export async function waitForHomePageInFlp(options?: PageWaitOptions): Promise<void> {
	await waitForPageInFlp(CONTROLS.home.homePage, "Home", options);
}

/**
 * Navigate to a route programmatically via the demo app's router.
 */
export async function navigateToRouteInFlp(routeName: string): Promise<void> {
	await browser.execute(
		(componentId: string, route: string) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			const router = Component.getComponentById(componentId).getRouter();
			if (!router.getRoute(route)) {
				throw new Error(`The demo router has no route "${route}"`);
			}
			router.navTo(route, {}, undefined, true);
		},
		await getAppComponentId(),
		routeName,
	);
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
				return HashChanger.getInstance().getHash() === exp;
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
