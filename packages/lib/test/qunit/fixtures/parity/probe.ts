import type UIComponent from "sap/ui/core/UIComponent";

/**
 * Hook of the parity fixture components: each calls `created` in init(), after its router exists
 * and before the router is initialized, so a test can record the first events of that router.
 * `guardOwners` are the IDs of the components whose router ran the fixture's allowing guard.
 */
const probe = {
	created: undefined as ((component: UIComponent) => void) | undefined,
	guardOwners: [] as (string | undefined)[],
};
export default probe;
