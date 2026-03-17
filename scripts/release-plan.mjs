import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

function getReleasePleaseCommand() {
	if (process.env.npm_execpath) {
		return {
			command: process.execPath,
			args: [process.env.npm_execpath, "exec", "release-please", "--"],
		};
	}

	return process.platform === "win32"
		? { command: "npx.cmd", args: ["--no-install", "release-please"] }
		: { command: "npx", args: ["--no-install", "release-please"] };
}

function main() {
	const token = getGitHubToken();
	const extraArgs = process.argv.slice(2);
	const { command, args } = getReleasePleaseCommand();
	const childEnv = {
		...process.env,
		GITHUB_TOKEN: token,
		GH_TOKEN: token,
	};

	execFileSync(
		command,
		[
			...args,
			"release-pr",
			"--dry-run",
			`--repo-url=${repoUrl}`,
			"--target-branch=main",
			"--config-file=release-please-config.json",
			"--manifest-file=.release-please-manifest.json",
			...extraArgs,
		],
		{
			cwd: repoRoot,
			env: childEnv,
			stdio: "inherit",
			shell: false,
		},
	);
}

main();
