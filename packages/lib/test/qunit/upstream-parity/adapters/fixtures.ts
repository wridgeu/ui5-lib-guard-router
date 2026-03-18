import MobileRouter from "sap/m/routing/Router";

type RouterArgs = ConstructorParameters<typeof MobileRouter>;

export function createForwardNavigationFixture(controlId: string): RouterArgs {
	return [
		{
			myRoute: {
				pattern: "some/{eventData}",
				target: "myTarget",
			},
		},
		{
			async: true,
			controlAggregation: "pages",
		},
		undefined,
		{
			myTarget: {
				controlId,
				transition: "flip",
				viewName: "AnyThingToPassValidation",
				viewLevel: 5,
				transitionParameters: { some: "parameter" },
			},
		},
	] as unknown as RouterArgs;
}

export function createViewLevelFixture(controlId: string): RouterArgs {
	return [
		{
			route: {
				pattern: "anyPattern",
				target: ["first", "second"],
			},
		},
		{
			async: true,
			viewType: "XML",
			path: "m.test.views",
			controlAggregation: "pages",
			controlId,
		},
		undefined,
		{
			first: {
				viewName: "first",
				path: "m.test.views",
			},
			second: {
				viewName: "second",
				path: "m.test.views",
				viewLevel: 0,
			},
			initial: {
				viewName: "initial",
				path: "m.test.views",
				viewLevel: 1,
			},
		},
	] as unknown as RouterArgs;
}
