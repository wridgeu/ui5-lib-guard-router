import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROFILE_ROOT_ENV = "UI5_GUARD_CHROME_PROFILES";

/**
 * wdio hooks that give every browser session a fresh Chrome profile folder, inside one folder
 * per run that is deleted when the run completes. On Windows wdio puts profiles in %TEMP% and
 * never deletes them (about 30 MB each), and names them by the millisecond, so two workers can
 * share one.
 *
 * @param parentDir - Folder the run's folder is created in.
 * @param extraArgs - Further Chrome arguments to add to every capability.
 */
export function chromeProfileHooks(
	parentDir = tmpdir(),
	extraArgs: string[] = [],
): Pick<WebdriverIO.Config, "onPrepare" | "beforeSession" | "onComplete"> {
	let profileRoot: string | undefined;

	return {
		onPrepare: () => {
			profileRoot = mkdtempSync(join(parentDir, "ui5-guard-chrome-"));
			// Workers are forked after onPrepare and inherit the environment.
			process.env[PROFILE_ROOT_ENV] = profileRoot;
		},
		// Runs in the worker: one profile per session, so no spec sees state another left behind.
		beforeSession: (_config, capabilities) => {
			const root = process.env[PROFILE_ROOT_ENV];
			if (!root) throw new Error("onPrepare has not created the folder for the Chrome profiles");
			const profileDir = mkdtempSync(join(root, "session-"));
			const options = ((capabilities as WebdriverIO.Capabilities)["goog:chromeOptions"] ??= {});
			(options.args ??= []).push(`--user-data-dir=${profileDir}`, ...extraArgs);
		},
		onComplete: () => {
			if (profileRoot) rmSync(profileRoot, { recursive: true, force: true, maxRetries: 5 });
		},
	};
}
