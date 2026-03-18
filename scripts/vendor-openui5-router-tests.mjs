import Ajv2020 from "ajv/dist/2020.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(repoRoot, "packages/lib/test/qunit/upstream-parity/manifest.json");
const manifestSchemaPath = path.join(repoRoot, "packages/lib/test/qunit/upstream-parity/manifest.schema.json");

function getFlag(name) {
	return process.argv.includes(name);
}

function getOption(name) {
	const index = process.argv.indexOf(name);
	if (index === -1 || index + 1 >= process.argv.length) {
		return null;
	}
	return process.argv[index + 1];
}

async function readManifest() {
	return JSON.parse(await readFile(manifestPath, "utf8"));
}

async function readManifestSchema() {
	return JSON.parse(await readFile(manifestSchemaPath, "utf8"));
}

async function fetchJson(url) {
	const response = await fetch(url, {
		headers: {
			accept: "application/vnd.github+json",
			"user-agent": "ui5-lib-guard-router-vendor-script",
		},
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
	}

	return response.json();
}

async function fetchText(url) {
	const response = await fetch(url, {
		headers: {
			"user-agent": "ui5-lib-guard-router-vendor-script",
		},
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
	}

	return response.text();
}

async function resolveCommitSha(repo, tag, sha) {
	if (sha) {
		return sha;
	}

	if (!tag) {
		throw new Error("Provide --tag or --sha");
	}

	const refData = await fetchJson(`https://api.github.com/repos/${repo}/git/ref/tags/${tag}`);
	if (refData.object.type === "commit") {
		return refData.object.sha;
	}

	const tagData = await fetchJson(refData.object.url);
	if (tagData.object.type !== "commit") {
		throw new Error(`Tag ${tag} did not resolve to a commit`);
	}

	return tagData.object.sha;
}

function buildRawFilePath(tag, sourcePath) {
	return path.join(repoRoot, "packages/lib/test/qunit/upstream-parity/vendor/openui5", tag, "raw", sourcePath);
}

function buildRawFilePathForManifest(tag, sourcePath) {
	return path.posix.join(
		"packages/lib/test/qunit/upstream-parity/vendor/openui5",
		tag,
		"raw",
		...sourcePath.split("/"),
	);
}

function computeSha256(contents) {
	return createHash("sha256").update(contents).digest("hex");
}

async function main() {
	const manifest = await readManifest();
	const manifestSchema = await readManifestSchema();
	const requestedTag = getOption("--tag");
	const sha = getOption("--sha");
	const targetVersion = requestedTag ?? sha ?? manifest.upstream.tag;
	const dryRun = getFlag("--dry-run");
	const writeManifest = getFlag("--write-manifest");
	const repo = manifest.upstream.repo;
	const ajv = new Ajv2020({ allErrors: true, strict: false });
	const validateManifest = ajv.compile(manifestSchema);

	if (writeManifest && !requestedTag) {
		throw new Error(
			"--write-manifest requires an explicit --tag so manifest.upstream.tag stays a semantic version.",
		);
	}

	const commitSha = await resolveCommitSha(repo, requestedTag ?? targetVersion, sha);
	const isVersionChange = targetVersion !== manifest.upstream.tag;

	if (writeManifest && isVersionChange) {
		const unmigratedPortEntry = manifest.files.find((file) => {
			return (
				file.portFilePath &&
				!file.portFilePath.includes(`/${targetVersion}/`) &&
				!file.portFilePath.includes(`\\${targetVersion}\\`)
			);
		});

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

		if (!validateManifest(manifest)) {
			const issues = (validateManifest.errors ?? [])
				.map((issue) => `${issue.instancePath || "/"}: ${issue.message ?? "invalid value"}`)
				.join("; ");
			throw new Error(`Generated manifest does not satisfy manifest.schema.json: ${issues}`);
		}

		await writeFile(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`, "utf8");
		console.log(`Updated manifest to ${targetVersion} (${commitSha})`);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
