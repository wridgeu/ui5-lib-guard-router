import Service from "wdio-ui5-service";
import { getAppComponentId, waitForComponent } from "../shared/controls";
import { getDirtyState } from "../shared/models";
import {
	installDialogHandler,
	loginAndGoToProtectedInFlp,
	navigateCrossAppInFlp,
	resetFlpDemo,
	setDirtyStateInFlp,
	waitForRouterRunningInFlp,
} from "./helpers";

const PEER_APP_ID = "demo.peer";

/**
 * Navigate to another app, confirm the unsaved-data prompt if the launchpad shows one, and
 * wait until the launchpad has loaded the app. Returns whether the launchpad asked.
 */
async function navigateCrossApp(shellHash: string): Promise<boolean> {
	const { record, cleanup } = installDialogHandler(true);
	try {
		await navigateCrossAppInFlp(shellHash);
		return record.called;
	} finally {
		cleanup();
	}
}

/**
 * Keep-alive: with `sap-keep-alive=true` the launchpad hides the demo app and keeps its
 * component when the user navigates to another app. Isolated spec file: the page is loaded
 * again with that URL parameter, and the test ends on the launchpad home.
 */
describe("FLP keep-alive (isolated session)", () => {
	before(async () => {
		const url = new URL(await browser.getUrl());
		url.searchParams.set("sap-keep-alive", "true");
		await browser.url(url.href);
		// The page load has dropped the bridge of wdi5.
		await new Service().injectUI5();
		await resetFlpDemo();
	});

	it("asks about unsaved data of the demo app only when the demo app is the one that is left", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);
		const componentId = await getAppComponentId();

		expect(await navigateCrossApp("peer-display")).toBe(true);
		await waitForComponent(PEER_APP_ID);
		expect(await getAppComponentId()).toBe(componentId);
		expect(await getDirtyState()).toBe(true);

		// The demo app is hidden with unsaved data. Coming back to it loses nothing.
		expect(await navigateCrossApp("app-preview")).toBe(false);
		await waitForRouterRunningInFlp();
		expect(await getAppComponentId()).toBe(componentId);
		expect(await getDirtyState()).toBe(true);

		// It is shown again, so leaving it asks again.
		expect(await navigateCrossApp("peer-display")).toBe(true);

		// And navigating on from the other app, which has no unsaved data, does not.
		expect(await navigateCrossApp("Shell-home")).toBe(false);
	});
});
