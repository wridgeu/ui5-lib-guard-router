import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { npmArgs } from "./npm-command.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const repoUrl = "https://github.com/wridgeu/ui5-lib-guard-router";

function getGitHubToken() {
	const token = process.env.RELEASE_PLEASE_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
	if (token) {
		return token;
	}

	try {
		return execFileSync("gh", ["auth", "token"], {
			cwd: repoRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		throw new Error(
			"No GitHub token available. Set RELEASE_PLEASE_TOKEN/GITHUB_TOKEN/GH_TOKEN or log in with `gh auth login`.",
		);
	}
}

function main() {
	const token = getGitHubToken();
	const extraArgs = process.argv.slice(2);

	const [npm, npmBase] = npmArgs();

	execFileSync(
		npm,
		[
			...npmBase,
			"exec",
			"release-please",
			"--",
			"release-pr",
			"--dry-run",
			`--repo-url=${repoUrl}`,
			"--target-branch=main",
			"--config-file=release-please-config.json",
			"--manifest-file=.release-please-manifest.json",
			`--token=${token}`,
			...extraArgs,
		],
		{
			cwd: repoRoot,
			stdio: "inherit",
		},
	);
}

main();
