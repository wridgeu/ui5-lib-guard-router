import Lib from "sap/ui/core/Lib";
import "sap/ui/core/library";
import "sap/m/library";

const library = Lib.init({
	apiVersion: 2,
	name: "ui5.guard.router",
	version: "${version}",
	dependencies: ["sap.ui.core", "sap.m"],
	types: [],
	interfaces: [],
	controls: [],
	elements: [],
	noLibraryCSS: true,
});

export default library;
