import type UIComponent from "sap/ui/core/UIComponent";

/**
 * Hook of the parity fixture components: each calls `created` in init(), after its router exists
 * and before the router is initialized, so a test can record the first events of that router.
 */
const probe = {
	created: undefined as ((component: UIComponent) => void) | undefined,
};
export default probe;
