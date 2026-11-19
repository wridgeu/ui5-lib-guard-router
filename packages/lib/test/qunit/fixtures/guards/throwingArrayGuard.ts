import type { GuardResult } from "ui5/guard/router/types";

export default [
	(): GuardResult => true,
	(): GuardResult => {
		throw new Error("second guard failed");
	},
];
