import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

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

/**
 * Resolve the npm CLI entry point bundled with Node.
 *
 * npm is installed alongside the node binary but outside the normal
 * module resolution paths. We locate it relative to `process.execPath`.
 */
function resolveNpmCli() {
	const nodeDir = path.dirname(process.execPath);
	const candidates = [
		path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
		path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	throw new Error(`Could not find npm CLI relative to node at ${process.execPath}`);
}

function main() {
	const token = getGitHubToken();
	const extraArgs = process.argv.slice(2);

	// Always invoke via `node <npm-cli> exec release-please --` to avoid
	// platform-specific .cmd wrappers and shell: true (DEP0190).
	const npmCli = process.env.npm_execpath ?? resolveNpmCli();

	execFileSync(
		process.execPath,
		[
			npmCli,
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
