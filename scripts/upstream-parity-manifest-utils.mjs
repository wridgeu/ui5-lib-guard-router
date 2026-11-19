import { createHash } from "node:crypto";

const allowedManifestKeys = new Set(["upstream", "files"]);
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

/**
 * The upstream version the vendored files are taken from.
 *
 * @typedef {{ repo: string, tag: string, commitSha: string }} ManifestUpstream
 */

/**
 * One vendored upstream file and its port.
 *
 * @typedef {object} ManifestFile
 * @property {string} id
 * @property {string} sourcePath
 * @property {string} rawFilePath
 * @property {string} contentSha256
 * @property {string} portFilePath
 * @property {string} status
 * @property {string[]} adaptations
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} upstream
 * @returns {upstream is ManifestUpstream}
 */
function isManifestUpstream(upstream) {
	return [upstream.repo, upstream.tag, upstream.commitSha].every((value) => typeof value === "string");
}

/**
 * @param {Record<string, unknown>} file
 * @returns {file is ManifestFile}
 */
function isManifestFile(file) {
	const { id, sourcePath, rawFilePath, contentSha256, portFilePath, status, adaptations } = file;
	return (
		[id, sourcePath, rawFilePath, contentSha256, portFilePath, status].every(
			(value) => typeof value === "string",
		) && Array.isArray(adaptations)
	);
}

/** @param {string} contents */
export function computeSha256(contents) {
	return createHash("sha256").update(contents).digest("hex");
}

/**
 * Validates the parsed vendor manifest. `files` and `upstream` are the entries of `manifest`
 * itself, so a caller can change them and write the manifest back.
 *
 * @param {unknown} manifest
 * @returns {{ errors: string[], files: ManifestFile[], upstream: ManifestUpstream | undefined }}
 */
export function validateUpstreamParityManifest(manifest) {
	/** @type {string[]} */
	const errors = [];
	/** @type {ManifestFile[]} */
	const validFiles = [];
	/** @type {ManifestUpstream | undefined} */
	let upstream;

	if (!isRecord(manifest)) {
		errors.push("Manifest root must be an object");
		return { errors, files: validFiles, upstream };
	}
	/** @type {unknown[]} */
	const manifestFiles = Array.isArray(manifest.files) ? manifest.files : [];

	for (const key of Object.keys(manifest)) {
		if (!allowedManifestKeys.has(key)) {
			errors.push(`Manifest contains unsupported top-level key '${key}'`);
		}
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

		if (typeof manifest.upstream.repo !== "string" || !/^[^\s/]+\/[^\s/]+$/.test(manifest.upstream.repo)) {
			errors.push(`Manifest upstream repo is invalid: ${String(manifest.upstream.repo)}`);
		}

		if (typeof manifest.upstream.tag !== "string" || manifest.upstream.tag.length === 0) {
			errors.push("Manifest upstream tag is missing or invalid");
		}

		if (typeof manifest.upstream.commitSha !== "string" || !/^[a-f0-9]{40}$/.test(manifest.upstream.commitSha)) {
			errors.push(`Manifest upstream commitSha is invalid: ${String(manifest.upstream.commitSha)}`);
		}

		if (isManifestUpstream(manifest.upstream)) upstream = manifest.upstream;
	}

	for (const [index, file] of manifestFiles.entries()) {
		if (!isRecord(file)) {
			errors.push(`Manifest file entry at index ${index} must be an object`);
			continue;
		}

		for (const key of Object.keys(file)) {
			if (!allowedFileKeys.has(key)) {
				const entry = typeof file.id === "string" ? file.id : index;
				errors.push(`Manifest file entry '${entry}' contains unsupported key '${key}'`);
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

		/** @type {unknown} */
		const adaptations = file.adaptations;
		if (!Array.isArray(adaptations) || adaptations.some((item) => typeof item !== "string")) {
			errors.push(`Manifest entry has invalid adaptations array: ${file.id}`);
			continue;
		}

		if (typeof file.contentSha256 !== "string" || !/^([a-f0-9]{64})$/.test(file.contentSha256)) {
			errors.push(`Manifest entry has invalid contentSha256: ${file.id}`);
			continue;
		}

		if (typeof file.status !== "string" || !allowedStatuses.has(file.status)) {
			const status = typeof file.status === "string" ? file.status : JSON.stringify(file.status);
			errors.push(`Manifest entry has unsupported status '${status}': ${file.id}`);
			continue;
		}

		if (isManifestFile(file)) validFiles.push(file);
	}

	return { errors, files: validFiles, upstream };
}
