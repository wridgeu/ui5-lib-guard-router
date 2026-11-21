import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { computeSha256, isRecord, isValidUpstreamParityManifest } from "./upstream-parity-manifest-utils.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(repoRoot, "packages/lib/test/qunit/upstream-parity/vendor-manifest.json");

/** @param {string} name */
function getFlag(name) {
	return process.argv.includes(name);
}

/** @param {string} name */
function getOption(name) {
	const index = process.argv.indexOf(name);
	if (index === -1 || index + 1 >= process.argv.length) {
		return null;
	}
	return process.argv[index + 1];
}

/** @returns {Promise<unknown>} */
async function readManifest() {
	return JSON.parse(await readFile(manifestPath, "utf8"));
}

/**
 * The object a git ref or an annotated tag of the GitHub API points to.
 *
 * @param {string} url
 * @returns {Promise<{ type: string, sha: string, url: string }>}
 */
async function fetchGitObject(url) {
	const response = await fetch(url, {
		headers: {
			accept: "application/vnd.github+json",
			"user-agent": "ui5-lib-guard-router-vendor-script",
		},
		signal: AbortSignal.timeout(30_000),
	});

	if (!response.ok) {
		const hint = response.status === 403 ? " (GitHub API rate limit may be exceeded)" : "";
		throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}${hint}`);
	}

	/** @type {unknown} */
	const data = await response.json();
	const object = isRecord(data) ? data.object : undefined;
	if (!isRecord(object)) {
		throw new Error(`Unexpected response from ${url}: no object`);
	}
	const { type, sha, url: objectUrl } = object;
	if (typeof type !== "string" || typeof sha !== "string" || typeof objectUrl !== "string") {
		throw new Error(`Unexpected response from ${url}: object without type, sha or url`);
	}
	return { type, sha, url: objectUrl };
}

/** @param {string} url */
async function fetchText(url) {
	const response = await fetch(url, {
		headers: {
			"user-agent": "ui5-lib-guard-router-vendor-script",
		},
		signal: AbortSignal.timeout(30_000),
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
	}

	return response.text();
}

/**
 * @param {string} repo
 * @param {string} tag
 * @param {string | null} sha
 */
async function resolveCommitSha(repo, tag, sha) {
	if (sha) {
		return sha;
	}

	if (!tag) {
		throw new Error("Provide --tag or --sha");
	}

	const ref = await fetchGitObject(`https://api.github.com/repos/${repo}/git/ref/tags/${tag}`);
	if (ref.type === "commit") {
		return ref.sha;
	}

	const tagged = await fetchGitObject(ref.url);
	if (tagged.type !== "commit") {
		throw new Error(`Tag ${tag} did not resolve to a commit`);
	}

	return tagged.sha;
}

/**
 * @param {string} tag
 * @param {string} sourcePath
 */
function buildRawFilePath(tag, sourcePath) {
	return path.join(repoRoot, "packages/lib/test/qunit/upstream-parity/vendor/openui5", tag, "raw", sourcePath);
}

/**
 * @param {string} tag
 * @param {string} sourcePath
 */
function buildRawFilePathForManifest(tag, sourcePath) {
	return path.posix.join(
		"packages/lib/test/qunit/upstream-parity/vendor/openui5",
		tag,
		"raw",
		...sourcePath.split("/"),
	);
}

async function main() {
	const manifest = await readManifest();
	/** @type {string[]} */
	const manifestErrors = [];
	if (!isValidUpstreamParityManifest(manifest, manifestErrors)) {
		throw new Error(`Manifest is invalid before vendoring: ${manifestErrors.join("; ")}`);
	}

	const requestedTag = getOption("--tag");
	const sha = getOption("--sha");
	const targetVersion = requestedTag ?? sha ?? manifest.upstream.tag;
	const dryRun = getFlag("--dry-run");
	const writeManifest = getFlag("--write-manifest");
	const repo = manifest.upstream.repo;

	if (writeManifest && !requestedTag) {
		throw new Error(
			"--write-manifest requires an explicit --tag so manifest.upstream.tag stays a semantic version.",
		);
	}

	const commitSha = await resolveCommitSha(repo, targetVersion, sha);
	const isVersionChange = targetVersion !== manifest.upstream.tag;

	if (writeManifest && isVersionChange) {
		const unmigratedPortEntry = manifest.files.find((file) => !file.portFilePath.includes(`/${targetVersion}/`));

		if (unmigratedPortEntry) {
			throw new Error(
				`Refusing to update manifest to ${targetVersion} because portFilePath still points at a different version: ${unmigratedPortEntry.portFilePath}. Migrate the versioned ports first, then rerun with --write-manifest.`,
			);
		}
	}

	for (const file of manifest.files) {
		const targetPath = buildRawFilePath(targetVersion, file.sourcePath);
		const sourceUrl = `https://raw.githubusercontent.com/${repo}/${commitSha}/${file.sourcePath}`;
		if (dryRun) {
			console.log(`[dry-run] ${sourceUrl} -> ${targetPath}`);
			continue;
		}

		const contents = await fetchText(sourceUrl);
		await mkdir(path.dirname(targetPath), { recursive: true });
		await writeFile(targetPath, contents, "utf8");
		const contentSha256 = computeSha256(contents);

		if (writeManifest) {
			file.contentSha256 = contentSha256;
		}

		console.log(`Fetched ${file.sourcePath}`);
	}

	if (!dryRun && writeManifest) {
		manifest.upstream.tag = targetVersion;
		manifest.upstream.commitSha = commitSha;
		for (const file of manifest.files) {
			file.rawFilePath = buildRawFilePathForManifest(targetVersion, file.sourcePath);
		}

		/** @type {string[]} */
		const updatedManifestErrors = [];
		if (!isValidUpstreamParityManifest(manifest, updatedManifestErrors)) {
			throw new Error(`Generated manifest is invalid: ${updatedManifestErrors.join("; ")}`);
		}

		await writeFile(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`, "utf8");
		console.log(`Updated manifest to ${targetVersion} (${commitSha})`);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
