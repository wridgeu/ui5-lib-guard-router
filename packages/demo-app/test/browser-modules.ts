import type Log from "sap/base/Log";
import type List from "sap/m/List";
import type NavContainer from "sap/m/NavContainer";
import type Page from "sap/m/Page";
import type StandardListItem from "sap/m/StandardListItem";
import type HashChanger from "sap/ui/core/routing/HashChanger";
import type UIComponent from "sap/ui/core/UIComponent";
import type View from "sap/ui/core/mvc/View";
import type JSONModel from "sap/ui/model/json/JSONModel";
import type Container from "sap/ushell/Container";
import type { GuardRouter } from "ui5/guard/router/types";

/**
 * A component the tests read in the browser: the demo app, its nested reporting component or
 * a parity fixture. All of them are UIComponents with a guard router API and JSON models,
 * and the controls they have an ID for are views. A component that is not fails the test
 * with a TypeError.
 */
interface TestedComponent extends UIComponent {
	getRouter(): GuardRouter;
	getModel(name: string): JSONModel;
	byId(id: string): View | undefined;
	/** What the router of a parity fixture did (test/flp/parity). */
	trace: string[];
}

/**
 * Types for the synchronous `sap.ui.require(name)`, which UI5 declares as `any`. Test code
 * that runs in the browser through `browser.execute()` reads modules with it, because it
 * cannot import them. The page under test has loaded the modules that are declared without
 * `undefined`; the others are missing while the page starts or on a page without a launchpad.
 */
declare global {
	namespace sap {
		namespace ui {
			function require(name: "sap/ui/core/Component"): { getComponentById(id: string): TestedComponent };
			function require(name: "sap/ui/core/routing/HashChanger"): typeof HashChanger;
			function require(name: "sap/base/Log"): typeof Log;
			function require(name: "sap/m/List"): typeof List;
			function require(name: "sap/m/StandardListItem"): typeof StandardListItem;
			function require(name: "sap/m/NavContainer"): typeof NavContainer | undefined;
			function require(name: "sap/m/Page"): typeof Page | undefined;
			function require(name: "sap/ushell/Container"): typeof Container | undefined;
		}
	}
}
