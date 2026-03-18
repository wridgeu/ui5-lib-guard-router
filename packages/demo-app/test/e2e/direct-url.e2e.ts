import {
	getRuntimeSettlementRevision,
	waitForPage,
	resetAuth,
	expectHashToBe,
	waitForRuntimeSettlement,
} from "./helpers";

describe("Direct URL navigation with guards", () => {
	it("should redirect to Home when accessing #/protected directly while logged out", async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();
		await waitForPage("container-demo.app---homeView--homePage", "Home");
		const settlementRevision = await getRuntimeSettlementRevision();
		await browser.execute(() => {
			window.location.hash = "#/protected";
		});

		// Wait for hash to settle after async guard redirects
		await expectHashToBe("", {
			timeoutMsg: "Hash should settle to home after guard redirect",
			afterRevision: settlementRevision,
		});
		await waitForPage("container-demo.app---homeView--homePage", "Home");

		const settlement = await waitForRuntimeSettlement(
			{
				status: "Redirected",
				route: "home",
				hash: "(empty hash)",
			},
			{
				afterRevision: settlementRevision,
			},
		);
		expect(settlement.route).toBe("home");
		expect(settlement.hash).toBe("(empty hash)");
	});

	it("should redirect to Home when accessing #/forbidden directly", async () => {
		await browser.goTo({ sHash: "" });
		await waitForPage("container-demo.app---homeView--homePage", "Home");
		const settlementRevision = await getRuntimeSettlementRevision();
		await browser.execute(() => {
			window.location.hash = "#/forbidden";
		});

		// Wait for hash to settle after sync guard redirects
		await expectHashToBe("", {
			timeoutMsg: "Hash should settle to home after guard redirect",
			afterRevision: settlementRevision,
		});
		await waitForPage("container-demo.app---homeView--homePage", "Home", { afterRevision: settlementRevision });

		const settlement = await waitForRuntimeSettlement(
			{
				status: "Redirected",
				route: "home",
				hash: "(empty hash)",
			},
			{
				afterRevision: settlementRevision,
			},
		);
		expect(settlement.route).toBe("home");
		expect(settlement.hash).toBe("(empty hash)");
	});

	it("should stay on Home and report Blocked when accessing #/blocked directly", async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();
		await waitForPage("container-demo.app---homeView--homePage", "Home");
		const settlementRevision = await getRuntimeSettlementRevision();

		await browser.execute(() => {
			window.location.hash = "#/blocked";
		});

		await expectHashToBe("", {
			timeoutMsg: "Hash should settle to home after enter guard blocks",
			afterRevision: settlementRevision,
		});
		await waitForPage("container-demo.app---homeView--homePage", "Home", { afterRevision: settlementRevision });

		const settlement = await waitForRuntimeSettlement(
			{
				status: "Blocked",
				route: "home",
				hash: "(empty hash)",
			},
			{
				afterRevision: settlementRevision,
			},
		);
		expect(settlement.route).toBe("home");
		expect(settlement.hash).toBe("(empty hash)");
	});

	it("should load Protected page when accessing #/protected directly while logged in", async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();

		const toggleBtn = await browser.asControl({
			selector: { id: "container-demo.app---homeView--toggleLoginBtn" },
		});
		await toggleBtn.press();

		await browser.execute(() => {
			window.location.hash = "#/protected";
		});

		// Wait for view to load - confirms async guard completed
		await waitForPage("container-demo.app---protectedView--protectedPage", "Protected Page");
	});

	it("should show Not Found page for a nonexistent route hash", async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();
		await waitForPage("container-demo.app---homeView--homePage", "Home");

		await browser.execute(() => {
			window.location.hash = "#/this/does/not/exist";
		});

		await browser.waitUntil(
			async () => {
				const url = await browser.getUrl();
				return url.includes("#/this/does/not/exist");
			},
			{ timeout: 5000, timeoutMsg: "Hash did not settle to nonexistent route" },
		);

		// Verify the Not Found page is displayed
		await waitForPage("container-demo.app---notFoundView--notFoundPage", "Not Found");

		const settlementStatus = await browser.asControl({
			selector: { id: "container-demo.app---notFoundView--settlementStatus" },
		});
		expect(await settlementStatus.getProperty("text")).toBe("Bypassed");

		const settlementRoute = await browser.asControl({
			selector: { id: "container-demo.app---notFoundView--settlementRouteText" },
		});
		expect(await settlementRoute.getProperty("text")).toBe("(no match)");

		const settlementHash = await browser.asControl({
			selector: { id: "container-demo.app---notFoundView--settlementHashText" },
		});
		expect(await settlementHash.getProperty("text")).toBe("this/does/not/exist");

		// Verify the app recovers by navigating back to a known route
		await browser.execute(() => {
			window.location.hash = "#/";
		});
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});

	it("should handle rapid hash changes in the address bar", async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();
		await waitForPage("container-demo.app---homeView--homePage", "Home");
		const settlementRevision = await getRuntimeSettlementRevision();

		// Rapidly change the hash multiple times
		await browser.execute(() => {
			window.location.hash = "#/protected";
		});
		await browser.execute(() => {
			window.location.hash = "#/forbidden";
		});
		await browser.execute(() => {
			window.location.hash = "#/protected";
		});

		// Should end up on Home (all guarded while logged out).
		// waitForPage calls navigationSettled() then checks DOM visibility.
		await waitForPage("container-demo.app---homeView--homePage", "Home");
		await waitForRuntimeSettlement(
			{
				status: "Redirected",
				route: "home",
				hash: "(empty hash)",
			},
			{ afterRevision: settlementRevision },
		);

		// Verify hash settled to a home-route value (not stuck on a guarded route)
		const hash = await browser.execute(() => window.location.hash);
		expect(["", "#", "#/"].includes(hash)).toBe(true);
	});
});
