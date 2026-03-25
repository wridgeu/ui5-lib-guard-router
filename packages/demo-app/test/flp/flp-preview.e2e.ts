import {
	expectAppHashToBe,
	expectControlText,
	getRuntimeSettlementRevisionInFlp,
	installDialogHandler,
	loginAndGoToProtectedInFlp,
	navigateToRouteInFlp,
	pressToggleLoginInFlp,
	resetFlpDemo,
	setDirtyStateInFlp,
	triggerFlpCrossAppNavigationAndExpectDirtyPrompt,
	waitForHomePageInFlp,
	waitForProtectedPageInFlp,
} from "./helpers";

describe("FLP preview integration", () => {
	beforeEach(async () => {
		await resetFlpDemo();
	});

	it("shows FLP runtime state on launch", async () => {
		await expectControlText("launchModeText", "FLP Preview");
		await expectControlText("ushellStatus", "sap.ushell.Container available");
		await expectControlText("flpDirtyProviderStatus", "FLP cross-app dirty protection active");
	});

	it("keeps app navigation working inside FLP preview", async () => {
		await loginAndGoToProtectedInFlp();
		await expectControlText("protectedFlpDirtyProviderStatus", "FLP cross-app dirty protection active");
		await expectControlText("protectedCurrentHashText", "#/protected");
		await expectControlText("settlementStatus", "Committed");
		await expectControlText("settlementRouteText", "protected");
		await expectControlText("settlementHashText", "protected");
		await expectControlText("settlementHashTechnicalText", 'Technical: "protected"');
	});

	it("triggers FLP dirty-state prompt on cross-app navigation and stays on page after cancel", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);

		await triggerFlpCrossAppNavigationAndExpectDirtyPrompt();
	});

	it("blocks dirty in-app navigation via leave guard without triggering FLP confirm", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);
		const settlementRevision = await getRuntimeSettlementRevisionInFlp();

		const { record, cleanup } = installDialogHandler(true);

		try {
			await navigateToRouteInFlp("home");

			await waitForProtectedPageInFlp({ afterRevision: settlementRevision });
			await expectAppHashToBe("protected", { afterRevision: settlementRevision });
			await expectControlText("protectedCurrentHashText", "#/protected");
			expect(record.called).toBe(false);
		} finally {
			cleanup();
		}
	});

	it("proves leave guard and FLP dirty provider operate independently on the same dirty state", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);

		// PART 1: In-app navigation. Leave guard blocks, no FLP confirm.
		const { record: inAppRecord, cleanup: inAppCleanup } = installDialogHandler(true);
		const settlementRevision = await getRuntimeSettlementRevisionInFlp();

		try {
			await navigateToRouteInFlp("home");

			await waitForProtectedPageInFlp({ afterRevision: settlementRevision });
			await expectAppHashToBe("protected", { afterRevision: settlementRevision });
			expect(inAppRecord.called).toBe(false);
		} finally {
			inAppCleanup();
		}

		// PART 2: Same dirty state, cross-app navigation. FLP confirm fires.
		await triggerFlpCrossAppNavigationAndExpectDirtyPrompt();
	});
});

describe("FLP route metadata and inheritance", () => {
	beforeEach(async () => {
		await resetFlpDemo();
	});

	it("getRouteMeta returns inherited metadata under FLP", async () => {
		await navigateToRouteInFlp("employees");

		const meta = (await browser.execute((routeName: string) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			const all = Component.registry.all() as Record<string, UIComponent>;
			const component = Object.values(all).find((c) => c.getManifestEntry("sap.app")?.id === "demo.app");
			if (!component) return null;
			type MetaRouter = { getRouteMeta(n: string): Record<string, unknown> };
			return (component.getRouter() as unknown as MetaRouter).getRouteMeta(routeName);
		}, "employee")) as Record<string, unknown> | null;

		expect(meta).not.toBeNull();
		expect(meta!.section).toBe("hr");
		expect(meta!.requiresAuth).toBe(true);
		expect(meta!.detail).toBe(true);
	});

	it("setRouteMeta invalidates cache and propagates under FLP", async () => {
		const childMeta = (await browser.execute(() => {
			const Component = sap.ui.require("sap/ui/core/Component");
			const all = Component.registry.all() as Record<string, UIComponent>;
			const component = Object.values(all).find((c) => c.getManifestEntry("sap.app")?.id === "demo.app");
			if (!component) return null;
			type MetaRouter = {
				setRouteMeta(n: string, m: Record<string, unknown>): unknown;
				getRouteMeta(n: string): Record<string, unknown>;
			};
			const router = component.getRouter() as unknown as MetaRouter;
			router.setRouteMeta("employees", { section: "engineering", requiresAuth: true });
			return router.getRouteMeta("employee");
		})) as Record<string, unknown> | null;

		expect(childMeta).not.toBeNull();
		expect(childMeta!.section).toBe("engineering");
		expect(childMeta!.detail).toBe(true);
	});
});

describe("FLP guard router hardening", () => {
	beforeEach(async () => {
		await resetFlpDemo();
	});

	// --- Enter guard tests ---

	it("blocks navigation to protected route when logged out", async () => {
		// Logged out (resetFlpDemo ensures this). Try to navigate to protected.
		const settlementRevision = await getRuntimeSettlementRevisionInFlp();
		await navigateToRouteInFlp("protected");

		// Guard should redirect back to home.
		await waitForHomePageInFlp({ afterRevision: settlementRevision });
		await expectAppHashToBe("", { afterRevision: settlementRevision });
	});

	it("redirects forbidden route to home", async () => {
		const settlementRevision = await getRuntimeSettlementRevisionInFlp();
		await navigateToRouteInFlp("forbidden");

		await waitForHomePageInFlp({ afterRevision: settlementRevision });
		await expectAppHashToBe("", { afterRevision: settlementRevision });
	});

	it("allows navigation to protected route when logged in", async () => {
		await loginAndGoToProtectedInFlp();
		await expectAppHashToBe("protected");
	});

	// --- Leave guard tests ---

	it("allows leaving protected page when form is clean", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(false);

		await navigateToRouteInFlp("home");

		await waitForHomePageInFlp();
		await expectAppHashToBe("");
	});

	it("allows leaving after clearing dirty state", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);
		await setDirtyStateInFlp(false);

		await navigateToRouteInFlp("home");

		await waitForHomePageInFlp();
		await expectAppHashToBe("");
	});

	// --- Browser history tests ---

	it("handles browser back from protected to home", async () => {
		await loginAndGoToProtectedInFlp();

		await browser.back();

		await waitForHomePageInFlp();
	});

	it("blocks browser back when form is dirty", async () => {
		await loginAndGoToProtectedInFlp();
		await setDirtyStateInFlp(true);
		const settlementRevision = await getRuntimeSettlementRevisionInFlp();

		await browser.back();

		// Leave guard blocks. Page stays on protected.
		await waitForProtectedPageInFlp({ afterRevision: settlementRevision });
		await expectAppHashToBe("protected", { afterRevision: settlementRevision });
	});

	it("re-evaluates enter guard on browser forward after logout", async () => {
		// Login and navigate to protected.
		await loginAndGoToProtectedInFlp();

		// Go back to home.
		await browser.back();
		await waitForHomePageInFlp();

		// Logout.
		await pressToggleLoginInFlp();
		await expectControlText("authStatus", "Logged Out");

		// Browser forward toward previously visited #/protected.
		const settlementRevision = await getRuntimeSettlementRevisionInFlp();
		await browser.forward();

		// Enter guard should block and redirect back to home.
		await waitForHomePageInFlp({ afterRevision: settlementRevision });
		await expectAppHashToBe("", { afterRevision: settlementRevision });
	});

	it("handles back/forward cycles with guards", async () => {
		await loginAndGoToProtectedInFlp();

		// Back to home
		await browser.back();
		await waitForHomePageInFlp();

		// Forward to protected (still logged in, guard allows)
		await browser.forward();
		await waitForProtectedPageInFlp();

		// Back to home again
		await browser.back();
		await waitForHomePageInFlp();
	});
});
