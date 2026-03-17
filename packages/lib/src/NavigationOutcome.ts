/**
 * Outcome of a navigation after the guard pipeline settles.
 *
 * Registered as a UI5 enum via `library.ts` so that it is discoverable
 * through `sap.ui.base.DataType.getType()`. Application code can import
 * the value object directly.
 *
 * @enum {string}
 * @namespace ui5.guard.router
 */
const NavigationOutcome = Object.freeze({
	/** Navigation was allowed and the target route activated. */
	Committed: "committed",
	/** A guard blocked navigation; the previous route remains active. */
	Blocked: "blocked",
	/** A guard redirected navigation to a different route. */
	Redirected: "redirected",
	/** Navigation was cancelled before settling (superseded, stopped, or destroyed). */
	Cancelled: "cancelled",
});

type NavigationOutcome = (typeof NavigationOutcome)[keyof typeof NavigationOutcome];

export default NavigationOutcome;
