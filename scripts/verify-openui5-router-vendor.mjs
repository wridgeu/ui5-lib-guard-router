import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(repoRoot, "packages/lib/test/qunit/upstream-parity/manifest.json");

function computeSha256(contents) {
	return createHash("sha256").update(contents).digest("hex");
}

async function main() {
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	const errors = [];
	const currentEntryPointPath = path.join(repoRoot, "packages/lib/test/qunit/upstream-parity/Current.qunit.ts");
	const filesById = new Map(manifest.files.map((file) => [file.id, file]));

	if (!manifest.upstream?.tag || !manifest.upstream?.commitSha || !manifest.upstream?.repo) {
		errors.push("Manifest upstream metadata is incomplete");
	}

	try {
		const currentEntryPoint = await readFile(currentEntryPointPath, "utf8");
		const currentImports = new Set(
			[...currentEntryPoint.matchAll(/import\s+"([^"]+)";/g)].map((match) => match[1]),
		);
		const expectedImports = manifest.files
			.filter((file) => file.portFilePath)
			.map((file) => {
				const relativePath = path.posix.relative(
					"packages/lib/test/qunit/upstream-parity",
					String(file.portFilePath).replaceAll("\\", "/"),
				);
				return `./${relativePath.replace(/\.ts$/, "")}`;
			});

		for (const expectedImport of expectedImports) {
			if (!currentImports.has(expectedImport)) {
				errors.push(
					`Current upstream parity entrypoint is missing expected import ${expectedImport}: packages/lib/test/qunit/upstream-parity/Current.qunit.ts`,
				);
			}
		}

		for (const currentImport of currentImports) {
			if (currentImport.startsWith("./ports/openui5/") && !expectedImports.includes(currentImport)) {
				errors.push(
					`Current upstream parity entrypoint contains an unexpected versioned import ${currentImport}: packages/lib/test/qunit/upstream-parity/Current.qunit.ts`,
				);
			}
		}
	} catch {
		errors.push(
			"Missing current upstream parity entrypoint: packages/lib/test/qunit/upstream-parity/Current.qunit.ts",
		);
	}

	for (const file of manifest.files) {
		if (!file.id || !file.kind || !file.sourcePath || !file.rawFilePath || !file.status || !file.contentSha256) {
			errors.push(`Manifest entry is incomplete: ${JSON.stringify(file)}`);
			continue;
		}

		if (file.kind === "test-entrypoint") {
			if (!file.portFilePath) {
				errors.push(`Test entrypoint is missing portFilePath: ${file.id}`);
			}

			for (const dependencyId of file.dependsOnIds ?? []) {
				const dependency = filesById.get(dependencyId);
				if (!dependency) {
					errors.push(`Entry point ${file.id} references unknown dependency ${dependencyId}`);
					continue;
				}

				if (dependency.kind !== "support-module") {
					errors.push(`Entry point ${file.id} depends on non-support file ${dependencyId}`);
				}
			}
		}

		if (file.kind === "support-module") {
			if (!file.usedByPortFilePath) {
				errors.push(`Support module is missing usedByPortFilePath: ${file.id}`);
			} else {
				const usedByPortFilePath = path.join(repoRoot, file.usedByPortFilePath);
				try {
					await access(usedByPortFilePath);
				} catch {
					errors.push(`Support module references missing executable port: ${file.usedByPortFilePath}`);
				}
			}
		}

		if (
			!file.rawFilePath.includes(`/${manifest.upstream.tag}/`) &&
			!file.rawFilePath.includes(`\\${manifest.upstream.tag}\\`)
		) {
			errors.push(
				`Raw file path does not match active upstream version ${manifest.upstream.tag}: ${file.rawFilePath}`,
			);
		}

		const normalizedRawPath = file.rawFilePath.replaceAll("\\", "/");
		if (!normalizedRawPath.endsWith(file.sourcePath)) {
			errors.push(`Raw file path does not align with source path ${file.sourcePath}: ${file.rawFilePath}`);
		}

		const rawFilePath = path.join(repoRoot, file.rawFilePath);
		try {
			await access(rawFilePath);
			const rawContents = await readFile(rawFilePath);
			const actualSha256 = computeSha256(rawContents);
			if (actualSha256 !== file.contentSha256) {
				errors.push(
					`Raw vendored file checksum does not match manifest for ${file.rawFilePath}: expected ${file.contentSha256}, got ${actualSha256}`,
				);
			}
		} catch {
			errors.push(`Missing raw vendored file: ${file.rawFilePath}`);
		}

		if (file.portFilePath) {
			const portFilePath = path.join(repoRoot, file.portFilePath);
			try {
				await access(portFilePath);
			} catch {
				errors.push(`Missing executable port file: ${file.portFilePath}`);
			}

			if (
				!file.portFilePath.includes(`/${manifest.upstream.tag}/`) &&
				!file.portFilePath.includes(`\\${manifest.upstream.tag}\\`)
			) {
				errors.push(
					`Port file path does not match active upstream version ${manifest.upstream.tag}: ${file.portFilePath}`,
				);
			}
		}
	}

	if (errors.length > 0) {
		for (const error of errors) {
			console.error(error);
		}
		process.exitCode = 1;
		return;
	}

	console.log(
		`Verified ${manifest.files.length} vendored OpenUI5 router file entries for ${manifest.upstream.tag} (${manifest.upstream.commitSha})`,
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
