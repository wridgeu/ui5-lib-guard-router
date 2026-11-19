import type UshellContainer from "sap/ushell/Container";
import Service from "wdio-ui5-service";
import { getAppComponentId, waitForComponent } from "../shared/controls";
import { installDialogHandler, triggerFlpCrossAppNavigation } from "./helpers";

const PEER_APP_ID = "demo.peer";

/** The same app (test/flp/parity/) with the native router and with the guard router. */
const APPS = {
	native: { id: "demo.parity.native", intent: "paritynative-display" },
	guard: { id: "demo.parity.guard", intent: "parityguard-display" },
};
type App = (typeof APPS)[keyof typeof APPS];

/** What is observable of an app after a step. */
interface Snapshot {
	step: string;
	/** The browser hash, with the intent of the app replaced. */
	url: string;
	/** The routing events of the app's router so far. */
	trace: string[];
	initialized: boolean;
	stopped: boolean;
}

async function observe(app: App, step: string): Promise<Snapshot> {
	return browser.execute(
		(componentId: string, intent: string, label: string) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			const component = Component.getComponentById(componentId);
			const router = component.getRouter();
			return {
				step: label,
				url: window.location.hash.replace(intent, "<app>"),
				trace: [...component.trace],
				initialized: router.isInitialized(),
				stopped: router.isStopped(),
			};
		},
		await getAppComponentId(app.id),
		app.intent,
		step,
	);
}

/** Observe the app once `done` holds for what is observable of it. */
async function observeWhen(app: App, step: string, done: (snapshot: Snapshot) => boolean): Promise<Snapshot> {
	let snapshot = await observe(app, step);
	await browser.waitUntil(
		async () => {
			snapshot = await observe(app, step);
			return done(snapshot);
		},
		{ timeout: 10000, timeoutMsg: `${app.id}, ${step}: not reached. Last observed: ${JSON.stringify(snapshot)}` },
	);
	return snapshot;
}

const lastEvent =
	(event: string, count: number) =>
	(snapshot: Snapshot): boolean =>
		snapshot.trace.length === count && snapshot.trace.at(-1) === event;

async function navTo(app: App, route: string, parameters: Record<string, string> = {}): Promise<void> {
	await browser.execute(
		(componentId: string, name: string, routeParameters: Record<string, string>) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			Component.getComponentById(componentId).getRouter().navTo(name, routeParameters);
		},
		await getAppComponentId(app.id),
		route,
		parameters,
	);
}

async function setDirtyFlag(dirty: boolean): Promise<void> {
	await browser.execute((flag: boolean) => {
		const Container: typeof UshellContainer = sap.ui.require("sap/ushell/Container");
		Container.setDirtyFlag(flag);
	}, dirty);
}

/**
 * Run the app through what the launchpad does with the router of an app: start on a deep link,
 * navigate in the app, cancel a cross-app navigation, hide the app (keep-alive) and show it
 * again. `refusedHashChange` is what the app does after the cancelled cross-app navigation.
 */
async function runInLaunchpad(app: App, refusedHashChange: () => Promise<void>): Promise<Snapshot[]> {
	const url = new URL(await browser.getUrl());
	url.searchParams.set("sap-keep-alive", "true");
	url.hash = `${app.intent}&/detail/1`;
	// From another page: a change of the hash alone would not load the launchpad again.
	await browser.url("about:blank");
	await browser.url(url.href);
	// The page load has dropped the bridge of wdi5.
	await new Service().injectUI5();
	await waitForComponent(app.id);
	const snapshots = [
		await observeWhen(app, "start on a deep link", lastEvent('routePatternMatched detail {"id":"1"}', 3)),
	];

	await navTo(app, "page1");
	snapshots.push(await observeWhen(app, "navTo page1", lastEvent("routePatternMatched page1 {}", 6)));

	await navTo(app, "detail", { id: "2" });
	snapshots.push(await observeWhen(app, "navTo detail/2", lastEvent('routePatternMatched detail {"id":"2"}', 9)));

	await browser.back();
	snapshots.push(await observeWhen(app, "browser back", lastEvent("routePatternMatched page1 {}", 12)));

	await setDirtyFlag(true);
	const { record, cleanup } = installDialogHandler(false);
	try {
		await triggerFlpCrossAppNavigation("peer-display");
		await browser.waitUntil(() => record.handled, {
			timeout: 5000,
			timeoutMsg: "The launchpad did not ask about unsaved data",
		});
	} finally {
		cleanup();
	}
	const running = (snapshot: Snapshot): boolean => snapshot.initialized && !snapshot.stopped;
	snapshots.push(await observeWhen(app, "cancelled cross-app navigation", running));

	// With the flag, the launchpad would ask about unsaved data for a hash change inside the app as well.
	await setDirtyFlag(false);
	await refusedHashChange();
	snapshots.push(await observe(app, "after what the app refused"));

	await triggerFlpCrossAppNavigation("peer-display");
	await waitForComponent(PEER_APP_ID);
	snapshots.push(await observeWhen(app, "hidden behind another app", (snapshot) => snapshot.stopped));

	await triggerFlpCrossAppNavigation(app.intent);
	snapshots.push(await observeWhen(app, "shown again", running));

	await navTo(app, "detail", { id: "3" });
	snapshots.push(
		await observeWhen(
			app,
			"navTo detail/3",
			(snapshot) => snapshot.trace.at(-1) === 'routePatternMatched detail {"id":"3"}',
		),
	);
	return snapshots;
}

/** The guard router blocks a hash change to its "blocked" route; resolves once the URL is back. */
async function blockHashChange(): Promise<void> {
	const status = await browser.execute(
		async (componentId: string) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			const HashChanger = sap.ui.require("sap/ui/core/routing/HashChanger");
			const router = Component.getComponentById(componentId).getRouter();
			const block = (): boolean => false;
			router.addRouteGuard("blocked", block);
			const settled = new Promise<string>((resolve) => {
				router.attachEventOnce("navigationSettled", (event: { getParameter(name: string): string }) =>
					resolve(event.getParameter("status")),
				);
			});
			HashChanger.getInstance().setHash("blocked");
			const outcome = await settled;
			router.removeRouteGuard("blocked", block);
			return outcome;
		},
		await getAppComponentId(APPS.guard.id),
	);
	expect(status).toBe("blocked");
}

/**
 * The launchpad stops and initializes the router of an app around a cross-app navigation. The
 * guard router must go through that as the native router does. Isolated spec file: each run
 * loads the page with `sap-keep-alive=true`.
 */
describe("FLP parity with the native router (isolated session)", () => {
	let native: Snapshot[] = [];

	it("the native router goes through a deep link, a cancelled cross-app navigation and keep-alive", async () => {
		native = await runInLaunchpad(APPS.native, () => Promise.resolve());

		expect(native[0].url).toBe("#<app>&/detail/1");
		expect(native[4]).toEqual({ ...native[3], step: "cancelled cross-app navigation" });
		expect(native[6].stopped).toBe(true);
		expect(native[8].url).toContain("&/detail/3");
	});

	it("the guard router goes through the same as the native router, a blocked hash change counting as no navigation", async () => {
		const guard = await runInLaunchpad(APPS.guard, blockHashChange);

		expect(guard).toEqual(native);
	});
});
