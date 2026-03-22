import UIComponent from "sap/ui/core/UIComponent";

/**
 * Minimal test component for manifest-driven router instantiation.
 * @namespace ui5.guard.router.qunit.fixtures.manifest
 */
export default class Component extends UIComponent {
	static readonly metadata = {
		manifest: "json",
	};
}
