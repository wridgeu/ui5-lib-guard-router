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

/** @typedef {{ upstream: ManifestUpstream, files: ManifestFile[] }} Manifest */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject(value) {
	if (typeof value !== "object" || value === null) return false;
	/** @type {unknown} */
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/** @param {string} contents */
export function computeSha256(contents) {
	return createHash("sha256").update(contents).digest("hex");
}

/**
 * Validates the upstream entry of the manifest, adding an error for each problem.
 *
 * @param {Record<string, unknown>} upstream
 * @param {string[]} errors
 */
function validateUpstream(upstream, errors) {
	for (const key of Object.keys(upstream)) {
		if (!allowedUpstreamKeys.has(key)) {
			errors.push(`Manifest upstream contains unsupported key '${key}'`);
		}
	}

	if (typeof upstream.repo !== "string" || !/^[^\s/]+\/[^\s/]+$/.test(upstream.repo)) {
		errors.push(`Manifest upstream repo is invalid: ${String(upstream.repo)}`);
	}

	if (typeof upstream.tag !== "string" || upstream.tag.length === 0) {
		errors.push("Manifest upstream tag is missing or invalid");
	}

	if (typeof upstream.commitSha !== "string" || !/^[a-f0-9]{40}$/.test(upstream.commitSha)) {
		errors.push(`Manifest upstream commitSha is invalid: ${String(upstream.commitSha)}`);
	}
}

/**
 * Validates one file entry of the manifest, adding an error for each unsupported key and
 * one for the first other problem.
 *
 * @param {unknown} file
 * @param {number} index
 * @param {string[]} errors
 */
function validateFile(file, index, errors) {
	if (!isPlainObject(file)) {
		errors.push(`Manifest file entry at index ${index} must be an object`);
		return;
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
		return;
	}

	if (!Array.isArray(file.adaptations) || file.adaptations.some((item) => typeof item !== "string")) {
		errors.push(`Manifest entry has invalid adaptations array: ${file.id}`);
		return;
	}

	if (typeof file.contentSha256 !== "string" || !/^([a-f0-9]{64})$/.test(file.contentSha256)) {
		errors.push(`Manifest entry has invalid contentSha256: ${file.id}`);
		return;
	}

	if (typeof file.status !== "string" || !allowedStatuses.has(file.status)) {
		errors.push(`Manifest entry has unsupported status ${JSON.stringify(file.status)}: ${file.id}`);
	}
}

/**
 * Validates the parsed vendor manifest.
 *
 * @param {unknown} manifest
 * @param {string[]} errors empty array; receives one message per problem
 * @returns {manifest is Manifest}
 */
export function isValidUpstreamParityManifest(manifest, errors) {
	if (!isPlainObject(manifest)) {
		errors.push("Manifest root must be an object");
		return false;
	}

	for (const key of Object.keys(manifest)) {
		if (!allowedManifestKeys.has(key)) {
			errors.push(`Manifest contains unsupported top-level key '${key}'`);
		}
	}

	if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
		errors.push("Manifest files array is missing or empty");
	}

	if (!isPlainObject(manifest.upstream)) {
		errors.push("Manifest upstream metadata is missing or invalid");
	} else {
		validateUpstream(manifest.upstream, errors);
	}

	/** @type {unknown[]} */
	const files = Array.isArray(manifest.files) ? manifest.files : [];
	for (const [index, file] of files.entries()) {
		validateFile(file, index, errors);
	}
	return errors.length === 0;
}
