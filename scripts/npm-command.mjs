import process from "node:process";

/** The command and base arguments that run the npm which started this script, without a .cmd wrapper or a shell. */
export function npmArgs() {
	if (!process.env.npm_execpath) {
		throw new Error("npm_execpath is not set. Run this script via npm.");
	}

	return [process.execPath, [process.env.npm_execpath]];
}
