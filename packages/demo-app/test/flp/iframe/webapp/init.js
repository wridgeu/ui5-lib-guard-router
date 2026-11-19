sap.ui.define(["sap/ushell/Container"], async (Container) => {
	"use strict";

	await Container.init("cdm");
	(await Container.createRenderer(undefined, true)).placeAt("content");
});
