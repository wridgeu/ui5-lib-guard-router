import { createHash } from "node:crypto";

const allowedManifestKeys = new Set(["schemaVersion", "upstream", "files"]);
const allowedUpstreamKeys = new Set(["repo", "tag", "commitSha"]);
const allowedFileKeys = new Set([
	"id",
	"sourcePath",
	"rawFilePath",
	"contentSha256",
	"portFilePath",
	"status",
	"adaptations",
]);
const allowedStatuses = new Set(["ported", "ported-subset"]);

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function computeSha256(contents) {
	return createHash("sha256").update(contents).digest("hex");
}

export function validateUpstreamParityManifest(manifest) {
	const errors = [];
	const validFiles = [];
	const manifestFiles = Array.isArray(manifest?.files) ? manifest.files : [];

	if (!isRecord(manifest)) {
		errors.push("Manifest root must be an object");
		return { errors, files: validFiles };
	}

	for (const key of Object.keys(manifest)) {
		if (!allowedManifestKeys.has(key)) {
			errors.push(`Manifest contains unsupported top-level key '${key}'`);
		}
	}

	if (manifest.schemaVersion !== 1) {
		errors.push(`Unsupported upstream parity manifest schemaVersion: ${String(manifest.schemaVersion)}`);
	}

	if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
		errors.push("Manifest files array is missing or empty");
	}

	if (!isRecord(manifest.upstream)) {
		errors.push("Manifest upstream metadata is missing or invalid");
	} else {
		for (const key of Object.keys(manifest.upstream)) {
			if (!allowedUpstreamKeys.has(key)) {
				errors.push(`Manifest upstream contains unsupported key '${key}'`);
			}
		}

		if (typeof manifest.upstream.repo !== "string" || !/^[^\s]+\/[^\s]+$/.test(manifest.upstream.repo)) {
			errors.push(`Manifest upstream repo is invalid: ${String(manifest.upstream.repo)}`);
		}

		if (typeof manifest.upstream.tag !== "string" || manifest.upstream.tag.length === 0) {
			errors.push("Manifest upstream tag is missing or invalid");
		}

		if (typeof manifest.upstream.commitSha !== "string" || !/^[a-f0-9]{40}$/.test(manifest.upstream.commitSha)) {
			errors.push(`Manifest upstream commitSha is invalid: ${String(manifest.upstream.commitSha)}`);
		}
	}

	for (const [index, file] of manifestFiles.entries()) {
		if (!isRecord(file)) {
			errors.push(`Manifest file entry at index ${index} must be an object`);
			continue;
		}

		for (const key of Object.keys(file)) {
			if (!allowedFileKeys.has(key)) {
				errors.push(`Manifest file entry '${String(file.id ?? index)}' contains unsupported key '${key}'`);
			}
		}

		if (
			typeof file.id !== "string" ||
			file.id.length === 0 ||
			typeof file.sourcePath !== "string" ||
			file.sourcePath.length === 0 ||
			typeof file.rawFilePath !== "string" ||
			file.rawFilePath.length === 0 ||
			!file.status ||
			!file.contentSha256 ||
			typeof file.portFilePath !== "string" ||
			file.portFilePath.length === 0
		) {
			errors.push(`Manifest entry is incomplete: ${JSON.stringify(file)}`);
			continue;
		}

		if (!Array.isArray(file.adaptations) || file.adaptations.some((item) => typeof item !== "string")) {
			errors.push(`Manifest entry has invalid adaptations array: ${file.id}`);
			continue;
		}

		if (!/^([a-f0-9]{64})$/.test(String(file.contentSha256))) {
			errors.push(`Manifest entry has invalid contentSha256: ${file.id}`);
			continue;
		}

		if (!allowedStatuses.has(String(file.status))) {
			errors.push(`Manifest entry has unsupported status '${String(file.status)}': ${file.id}`);
			continue;
		}

		validFiles.push(file);
	}

	return { errors, files: validFiles };
}
