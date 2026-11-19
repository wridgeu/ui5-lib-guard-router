import type BaseLog from "sap/base/Log";
import Service from "wdio-ui5-service";
import { CONTROLS, getAppComponentId, press, waitForComponent } from "../shared/controls";
import { getDirtyState, getRuntimeSettlementRevision, setDirtyState } from "../shared/models";
import {
	expectInAppNavigationBlocked,
	loginAndGoToProtectedInFlp,
	resetFlpDemo,
	setDirtyStateInFlp,
	triggerFlpCrossAppNavigation,
	waitForHomePageInFlp,
	waitForProtectedPageInFlp,
	waitForRouterRunningInFlp,
} from "./helpers";

const PEER_APP_ID = "demo.peer";
/** The intent of the demo app in the site of test/flp/iframe/, which runs it in an iframe. */
const IFRAME_INTENT = "guardiframe-display";

/** Run `steps` in the iframe of the demo app; the launchpad page is the context again afterwards. */
async function inDemoApp<T>(steps: () => Promise<T>): Promise<T> {
	await browser.switchFrame($("iframe"));
	try {
		return await steps();
	} finally {
		await browser.switchFrame(null);
	}
}

async function isRouterStopped(): Promise<boolean> {
	return browser.execute(
		(componentId: string) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			return Component.getComponentById(componentId).getRouter().isStopped();
		},
		await getAppComponentId(),
	);
}

/** How often the global guard of the demo app (`guards/navigationLogger.ts`) has logged a navigation to the route. */
async function countLoggedNavigations(toRoute: string): Promise<number> {
	return browser.execute((route: string): number => {
		const Log: typeof BaseLog = sap.ui.require("sap/base/Log");
		return Log.getLogEntries().filter(
			(entry) => entry.component === "demo.app.guards" && entry.message.includes(`→ ${route}`),
		).length;
	}, toRoute);
}

/**
 * Keep-alive of an app that the launchpad runs in an iframe: the UI5 app runtime in the iframe
 * hides and shows the app on the messages of the shell (`appLifeCycle.store` and `restore`).
 * The launchpad page is `test/flp/iframe/webapp/flp.html`, because the preview of the demo
 * embeds every app in the launchpad page. Isolated spec file: it loads that page.
 */
describe("FLP keep-alive of an app in an iframe (isolated session)", () => {
	before(async () => {
		const url = new URL("/iframe/flp.html", await browser.getUrl());
		url.searchParams.set("sap-keep-alive", "true");
		url.hash = IFRAME_INTENT;
		await browser.url(url.href);
		await inDemoApp(async () => {
			await waitForComponent();
			// wdi5 finds the controls of the document it is injected into.
			await new Service().injectUI5();
			await resetFlpDemo();
		});
	});

	it("keeps the component, its unsaved data and its guards when the app is hidden and shown again", async () => {
		const settledBefore = await inDemoApp(async () => {
			await browser.execute(() => {
				const Log: typeof BaseLog = sap.ui.require("sap/base/Log");
				Log.setLevel(Log.Level.INFO, "demo.app.guards");
			});
			await loginAndGoToProtectedInFlp();
			await setDirtyStateInFlp(true);
			return getRuntimeSettlementRevision();
		});

		// The shell hides the app behind another one and does not ask about the unsaved data (the
		// app runtime does not report the provider of the app to the shell). The app runtime
		// stops the router.
		await triggerFlpCrossAppNavigation("peer-display");
		await waitForComponent(PEER_APP_ID);
		await inDemoApp(async () => {
			await browser.waitUntil(isRouterStopped, { timeoutMsg: "The router of the hidden app was not stopped" });
			expect(await getDirtyState()).toBe(true);
		});

		// Shown again, the kept component starts on its default route: one navigation, and the
		// leave guard of the route that was displayed does not run for it.
		await triggerFlpCrossAppNavigation(IFRAME_INTENT);
		await inDemoApp(async () => {
			await waitForRouterRunningInFlp();
			await waitForHomePageInFlp({ afterRevision: settledBefore });
			expect(await getRuntimeSettlementRevision()).toBe(settledBefore + 1);
			// A new component would be clean and logged out.
			expect(await getDirtyState()).toBe(true);

			// The enter guards run once for a navigation: the permission check allows it for
			// the user who is still logged in, and the global guard logs it.
			await setDirtyState(false);
			const logged = await countLoggedNavigations("protected");
			await press(CONTROLS.home.navProtectedBtn);
			await waitForProtectedPageInFlp({ afterRevision: settledBefore + 1 });
			expect(await getRuntimeSettlementRevision()).toBe(settledBefore + 2);
			expect(await countLoggedNavigations("protected")).toBe(logged + 1);

			// And the leave guard blocks.
			await setDirtyStateInFlp(true);
			await expectInAppNavigationBlocked();
		});
	});
});
