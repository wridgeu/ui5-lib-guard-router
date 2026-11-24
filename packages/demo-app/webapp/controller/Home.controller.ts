import type JSONModel from "sap/ui/model/json/JSONModel";
import type { LeaveGuardFn } from "ui5/guard/router/types";
import BaseController from "./BaseController";
import { createHomeLeaveLogger } from "../guards";
import { runHashSequence, setHash } from "../routing/hashNavigation";

const RAPID_HASH_SEQUENCE = ["#/protected", "#/forbidden", "#/protected"];

/**
 * Controller for the Home view.
 *
 * Demonstrates controller-level guard registration as an alternative to
 * the component-level guards shown in Component.ts. This pattern is useful when:
 * - The guard logic is specific to one view or controller.
 * - The controller manages state that needs protection.
 * - You want the guard lifecycle tied to the controller lifecycle.
 *
 * @namespace demo.app.controller
 */
export default class HomeController extends BaseController {
	private _leaveGuard: LeaveGuardFn | null = null;

	override onInit(): void {
		const router = this.getRouter();
		this._leaveGuard = createHomeLeaveLogger();
		router.addLeaveGuard("home", this._leaveGuard);
	}

	onToggleLogin(): void {
		const model = this.getModel("auth") as JSONModel;
		const isLoggedIn: unknown = model.getProperty("/isLoggedIn");
		model.setProperty("/isLoggedIn", !isLoggedIn);
		this.recordAction(isLoggedIn ? "actionLoggedOut" : "actionLoggedIn");
	}

	onNavToProtected(): void {
		this._navTo("protected");
	}

	onNavToBlocked(): void {
		this._navTo("blocked");
	}

	onNavToForbidden(): void {
		this._navTo("forbidden");
	}

	onNavToAdmin(): void {
		this._navTo("admin");
	}

	onNavToEmployees(): void {
		this._navTo("employees");
	}

	/** "team" is a retired page, see guards/retiredPageGuard.ts. */
	onNavToTeam(): void {
		this._navTo("team");
	}

	/** "reports" displays the nested reporting component, which has its own guard router. */
	onNavToReports(): void {
		this._navTo("reports");
	}

	onDirectHashToProtected(): void {
		this._setHash("#/protected", "actionHashTo", ["protected"]);
	}

	onDirectHashToBlocked(): void {
		this._setHash("#/blocked", "actionHashTo", ["blocked"]);
	}

	onDirectHashToForbidden(): void {
		this._setHash("#/forbidden", "actionHashTo", ["forbidden"]);
	}

	onDirectHashToMissing(): void {
		this._setHash("#/this/does/not/exist", "actionHashMissing");
	}

	onRapidHashSequence(): void {
		this.recordAction("actionRapidHash", [RAPID_HASH_SEQUENCE.map((hash) => hash.replace("#/", "")).join(" -> ")]);
		runHashSequence(RAPID_HASH_SEQUENCE);
	}

	private _navTo(route: string): void {
		this.recordAction("actionNavTo", [route]);
		this.getRouter().navTo(route);
	}

	private _setHash(hash: string, key: string, args?: string[]): void {
		this.recordAction(key, args);
		setHash(hash);
	}

	/**
	 * Clean up the leave guard when the controller is destroyed.
	 *
	 * Important for controller-level guards to prevent:
	 * - Memory leaks from orphaned guard references.
	 * - Guards executing after their controller is gone.
	 *
	 * The router caches its target views, so this runs when the component is destroyed.
	 */
	override onExit(): void {
		if (this._leaveGuard) {
			const router = this.getRouter();
			router.removeLeaveGuard("home", this._leaveGuard);
			this._leaveGuard = null;
		}
	}
}
