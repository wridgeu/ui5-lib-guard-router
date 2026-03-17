import Lib from "sap/ui/core/Lib";
import DataType from "sap/ui/base/DataType";
import "sap/ui/core/library";
import "sap/m/library";
import NavigationOutcome from "./NavigationOutcome";

const library = Lib.init({
	apiVersion: 2,
	name: "ui5.guard.router",
	version: "${version}",
	dependencies: ["sap.ui.core", "sap.m"],
	types: ["ui5.guard.router.NavigationOutcome"],
	interfaces: [],
	controls: [],
	elements: [],
	noLibraryCSS: true,
});

DataType.registerEnum("ui5.guard.router.NavigationOutcome", NavigationOutcome);

export default library;
