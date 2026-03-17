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
	Committed: "committed" as const,
	/** A guard blocked navigation; the previous route remains active. */
	Blocked: "blocked" as const,
	/** A guard redirected to a different route, which was then committed. */
	Redirected: "redirected" as const,
	/** Navigation was superseded by a newer navigation before settling. */
	Cancelled: "cancelled" as const,
});

type NavigationOutcome = (typeof NavigationOutcome)[keyof typeof NavigationOutcome];

export default NavigationOutcome;
