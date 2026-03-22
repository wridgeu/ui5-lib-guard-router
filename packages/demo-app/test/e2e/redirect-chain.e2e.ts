import { waitForPage } from "./helpers";

const COMPONENT_ID = "container-demo.app";

describe("Redirect chain: admin -> protected -> home", () => {
	beforeEach(async () => {
		await browser.url("#");
		await waitForPage("container-demo.app---homeView--homePage", "Home");
	});

	it("should follow the full chain when logged out (admin -> protected -> home)", async () => {
		// Install a temporary guard on "protected" that tracks calls
		// and always redirects to "home" (simulating logged-out behavior)
		const result = await browser.executeAsync((componentId: string, done: (r: unknown) => void) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			const component = Component?.getComponentById(componentId);
			const router = component?.getRouter();

			let chainGuardCalled = false;
			const chainGuard = () => {
				chainGuardCalled = true;
				return "home";
			};

			// Add a second guard on "protected" that will also run
			router.addRouteGuard("protected", chainGuard);

			router.navTo("admin");
			router.navigationSettled().then(
				(r: unknown) => {
					router.removeRouteGuard("protected", chainGuard);
					done({ settlement: r, chainGuardCalled });
				},
				(e: unknown) => {
					router.removeRouteGuard("protected", chainGuard);
					done({ error: String(e), chainGuardCalled });
				},
			);
		}, COMPONENT_ID);

		console.log("CHAIN GUARD TEST:", JSON.stringify(result));
		const data = result as {
			settlement?: { status: string; route: string };
			chainGuardCalled?: boolean;
		};
		// Verify the guard on the redirect target was actually called
		expect(data.chainGuardCalled).toBe(true);
		expect(data.settlement?.status).toBe("redirected");
		expect(data.settlement?.route).toBe("home");
	});

	it("should stop at protected when logged in (admin -> protected)", async () => {
		const result = await browser.executeAsync((componentId: string, done: (r: unknown) => void) => {
			const Component = sap.ui.require("sap/ui/core/Component");
			const component = Component?.getComponentById(componentId);
			const router = component?.getRouter();
			component?.getModel("auth")?.setProperty("/isLoggedIn", true);

			router.navTo("admin");
			router.navigationSettled().then(
				(r: unknown) => done({ settlement: r }),
				(e: unknown) => done({ error: String(e) }),
			);
		}, COMPONENT_ID);

		const data = result as { settlement?: { status: string; route: string } };
		expect(data.settlement?.status).toBe("redirected");
		expect(data.settlement?.route).toBe("protected");
	});
});
