import type { GuardResult } from "ui5/guard/router/types";

export default {
	allowFirst(): GuardResult {
		return true;
	},
	explode(): GuardResult {
		throw new Error("object guard failed");
	},
};
